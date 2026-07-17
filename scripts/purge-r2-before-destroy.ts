import { createHash, randomBytes } from "node:crypto";

const DEFAULT_API_BASE_URL = "https://api.cloudflare.com/client/v4";
const MAX_PURGE_PAGES = 1_000_000;

export interface PurgeR2Environment {
  readonly [name: string]: string | undefined;
  readonly CLOUDFLARE_API_TOKEN?: string;
  readonly CF_API_TOKEN?: string;
  readonly CLOUDFLARE_ACCOUNT_ID?: string;
  readonly CLOUDFLARE_API_BASE_URL?: string;
  readonly TAKOS_STORAGE_CLOUDFLARE_ACCOUNT_ID?: string;
  readonly TAKOS_STORAGE_R2_BUCKET_NAME?: string;
  readonly TAKOS_STORAGE_PURGE_API_BASE_URL?: string;
  readonly TAKOSUMI_OUTPUTS_JSON?: string;
}

export type PurgeFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface PurgeR2Result {
  readonly kind: "takos-storage.r2-pre-destroy@v1";
  readonly status: "succeeded";
  readonly bucketName: string;
  readonly deleted: number;
  readonly cleanerRemoved: true;
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function outputString(
  raw: string | undefined,
  name: string,
): string | undefined {
  if (!raw?.trim()) return undefined;
  let outputs: unknown;
  try {
    outputs = JSON.parse(raw);
  } catch {
    throw new Error("TAKOSUMI_OUTPUTS_JSON must contain valid JSON");
  }
  if (!isRecord(outputs)) {
    throw new Error("TAKOSUMI_OUTPUTS_JSON must contain a JSON object");
  }
  const output = outputs[name];
  if (typeof output === "string") return output.trim() || undefined;
  // Accept `tofu output -json` too for safe direct/self-host invocation.
  if (isRecord(output) && typeof output.value === "string") {
    return output.value.trim() || undefined;
  }
  return undefined;
}

function apiPayloadError(payload: unknown): string {
  if (!isRecord(payload)) return "unknown error";
  return JSON.stringify(payload.errors ?? payload);
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : { raw: "invalid JSON object" };
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

function cleanerSource(tokenSha256: string): string {
  return `const EXPECTED_TOKEN_SHA256=${JSON.stringify(tokenSha256)};
async function authorized(request){
  const match=/^Bearer\\s+(.+)$/.exec(request.headers.get("authorization")||"");
  const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(match?.[1]||"")));
  const actual=[...digest].map((byte)=>byte.toString(16).padStart(2,"0")).join("");
  return actual===EXPECTED_TOKEN_SHA256;
}
export default {async fetch(request,env){
  if(request.method!=="POST"||new URL(request.url).pathname!=="/purge"||!(await authorized(request))){
    return new Response("Not found",{status:404});
  }
  const page=await env.BUCKET.list({limit:1000});
  const keys=page.objects.map((object)=>object.key);
  if(keys.length>0)await env.BUCKET.delete(keys);
  return Response.json({ok:true,deleted:keys.length,done:keys.length===0});
}};`;
}

async function cloudflareRequest(
  fetchImpl: PurgeFetch,
  url: string,
  apiToken: string,
  init: RequestInit,
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(url, {
    ...init,
    headers: {
      authorization: `Bearer ${apiToken}`,
      ...(init.headers ?? {}),
    },
  });
  const payload = await readJson(response);
  if (!response.ok || payload.success === false) {
    throw new Error(
      `Cloudflare API ${init.method ?? "GET"} ${new URL(url).pathname} failed: ${response.status} ${apiPayloadError(payload)}`,
    );
  }
  return payload;
}

async function workersSubdomain(
  fetchImpl: PurgeFetch,
  apiBase: string,
  accountId: string,
  apiToken: string,
): Promise<string> {
  const payload = await cloudflareRequest(
    fetchImpl,
    `${apiBase}/accounts/${encodeURIComponent(accountId)}/workers/subdomain`,
    apiToken,
    { method: "GET" },
  );
  const result = payload.result;
  if (!isRecord(result) || typeof result.subdomain !== "string") {
    throw new Error("Cloudflare account has no readable workers.dev subdomain");
  }
  return required(result.subdomain, "Cloudflare workers.dev subdomain");
}

async function removeCleaner(
  fetchImpl: PurgeFetch,
  scriptUrl: string,
  apiToken: string,
): Promise<void> {
  const response = await fetchImpl(scriptUrl, {
    method: "DELETE",
    headers: { authorization: `Bearer ${apiToken}` },
  });
  if (response.status === 404) return;
  const payload = await readJson(response);
  if (!response.ok || payload.success === false) {
    throw new Error(
      `temporary R2 cleaner removal failed: ${response.status} ${apiPayloadError(payload)}`,
    );
  }
}

async function invokeCleaner(
  fetchImpl: PurgeFetch,
  url: string,
  purgeToken: string,
  attempts: number,
  sleep: (milliseconds: number) => Promise<unknown>,
): Promise<{ readonly deleted: number; readonly done: boolean }> {
  let lastStatus = 0;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { authorization: `Bearer ${purgeToken}` },
    });
    lastStatus = response.status;
    if (response.ok) {
      const payload = await readJson(response);
      if (
        payload.ok !== true ||
        typeof payload.deleted !== "number" ||
        !Number.isSafeInteger(payload.deleted) ||
        payload.deleted < 0 ||
        payload.deleted > 1000 ||
        typeof payload.done !== "boolean"
      ) {
        throw new Error("temporary R2 cleaner returned an invalid result");
      }
      return { deleted: payload.deleted, done: payload.done };
    }
    if (attempt < attempts) await sleep(1_000);
  }
  throw new Error(`temporary R2 cleaner request failed: ${lastStatus}`);
}

export async function purgeR2BucketBeforeDestroy(
  env: PurgeR2Environment,
  fetchImpl: PurgeFetch = fetch,
  sleep: (milliseconds: number) => Promise<unknown> = Bun.sleep,
): Promise<PurgeR2Result> {
  const apiToken = required(
    env.CLOUDFLARE_API_TOKEN ?? env.CF_API_TOKEN,
    "CLOUDFLARE_API_TOKEN or CF_API_TOKEN",
  );
  const accountId = required(
    env.TAKOS_STORAGE_CLOUDFLARE_ACCOUNT_ID ?? env.CLOUDFLARE_ACCOUNT_ID,
    "CLOUDFLARE_ACCOUNT_ID",
  );
  const bucketName = required(
    env.TAKOS_STORAGE_R2_BUCKET_NAME ??
      outputString(env.TAKOSUMI_OUTPUTS_JSON, "object_bucket_name"),
    "TAKOS_STORAGE_R2_BUCKET_NAME or TAKOSUMI_OUTPUTS_JSON.object_bucket_name",
  );
  const apiBase = (
    env.TAKOS_STORAGE_PURGE_API_BASE_URL ??
    env.CLOUDFLARE_API_BASE_URL ??
    DEFAULT_API_BASE_URL
  ).replace(/\/+$/u, "");
  const cleanerName = `takos-storage-clean-${createHash("sha256")
    .update(bucketName)
    .digest("hex")
    .slice(0, 16)}`;
  const purgeToken = randomBytes(32).toString("hex");
  const purgeTokenHash = createHash("sha256").update(purgeToken).digest("hex");
  const scriptUrl = `${apiBase}/accounts/${encodeURIComponent(
    accountId,
  )}/workers/scripts/${encodeURIComponent(cleanerName)}`;

  const form = new FormData();
  form.set(
    "metadata",
    new Blob(
      [
        JSON.stringify({
          main_module: "worker.mjs",
          compatibility_date: "2026-07-14",
          bindings: [
            { type: "r2_bucket", name: "BUCKET", bucket_name: bucketName },
          ],
        }),
      ],
      { type: "application/json" },
    ),
  );
  form.set(
    "worker.mjs",
    new Blob([cleanerSource(purgeTokenHash)], {
      type: "application/javascript+module",
    }),
    "worker.mjs",
  );

  let result: Omit<PurgeR2Result, "cleanerRemoved"> | undefined;
  let operationError: Error | undefined;
  try {
    const subdomain = await workersSubdomain(
      fetchImpl,
      apiBase,
      accountId,
      apiToken,
    );
    const workerUrl = `https://${cleanerName}.${subdomain}.workers.dev/purge`;
    await cloudflareRequest(fetchImpl, scriptUrl, apiToken, {
      method: "PUT",
      body: form,
    });
    await cloudflareRequest(fetchImpl, `${scriptUrl}/subdomain`, apiToken, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true, previews_enabled: false }),
    });

    let deleted = 0;
    for (let page = 0; page < MAX_PURGE_PAGES; page += 1) {
      const response = await invokeCleaner(
        fetchImpl,
        workerUrl,
        purgeToken,
        page === 0 ? 10 : 3,
        sleep,
      );
      deleted += response.deleted;
      if (response.done) {
        result = {
          kind: "takos-storage.r2-pre-destroy@v1",
          status: "succeeded",
          bucketName,
          deleted,
        };
        break;
      }
    }
    if (!result) throw new Error("R2 purge exceeded the maximum page count");
  } catch (error) {
    operationError =
      error instanceof Error
        ? error
        : new Error("R2 purge failed", { cause: error });
  }

  let cleanupError: Error | undefined;
  // The deterministic script may have been committed even when the upload
  // response was lost. Always attempt deletion; Cloudflare 404 is success.
  try {
    await removeCleaner(fetchImpl, scriptUrl, apiToken);
  } catch (error) {
    cleanupError =
      error instanceof Error
        ? error
        : new Error("temporary cleaner cleanup failed", { cause: error });
  }
  if (operationError && cleanupError) {
    throw new AggregateError(
      [operationError, cleanupError],
      "R2 purge and temporary cleaner cleanup both failed",
    );
  }
  if (operationError) throw operationError;
  if (cleanupError) throw cleanupError;
  if (!result) throw new Error("R2 purge returned no result");
  return { ...result, cleanerRemoved: true };
}

if (import.meta.main) {
  const result = await purgeR2BucketBeforeDestroy(process.env);
  console.log(JSON.stringify(result));
}

import { createHash, randomBytes } from "node:crypto";

const DEFAULT_API_BASE_URL = "https://api.cloudflare.com/client/v4";
const MAX_PAGES = 100_000;

export type MigrationFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type MigrationEnv = Record<string, string | undefined>;

function required(value: string | undefined, name: string): string {
  const result = value?.trim();
  if (!result) throw new Error(`${name} is required`);
  return result;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function outputValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (record(value) && typeof value.value === "string") return value.value;
  return undefined;
}

function bucketName(env: MigrationEnv): string {
  const direct = env.TAKOS_STORAGE_R2_BUCKET_NAME?.trim();
  if (direct) return direct;
  const raw = required(env.TAKOSUMI_OUTPUTS_JSON, "TAKOSUMI_OUTPUTS_JSON");
  let outputs: unknown;
  try {
    outputs = JSON.parse(raw);
  } catch {
    throw new Error("TAKOSUMI_OUTPUTS_JSON must be valid JSON");
  }
  const name = record(outputs)
    ? outputValue(outputs.object_bucket_name)?.trim()
    : undefined;
  if (!name) throw new Error("object_bucket_name output is required");
  return name;
}

function legacyPrefix(value: string | undefined): string {
  const normalized = required(value, "TAKOS_STORAGE_LEGACY_KEY_PREFIX").replace(
    /^\/+|\/+$/gu,
    "",
  );
  if (
    normalized.length > 1_024 ||
    normalized.includes("\0") ||
    normalized === "interface-bindings" ||
    normalized.startsWith("interface-bindings/")
  ) {
    throw new Error("legacy key prefix is unsafe");
  }
  return `${normalized}/`;
}

function bindingId(value: string | undefined): string {
  const id = required(value, "TAKOS_STORAGE_INTERFACE_BINDING_ID");
  if (id.length > 512 || /\s/u.test(id)) {
    throw new Error("InterfaceBinding id is invalid");
  }
  return id;
}

async function json(response: Response): Promise<Record<string, unknown>> {
  const value = (await response.json().catch(() => null)) as unknown;
  return record(value) ? value : {};
}

async function cf(
  fetchImpl: MigrationFetch,
  url: string,
  token: string,
  init: RequestInit,
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  const payload = await json(response);
  if (!response.ok || payload.success === false) {
    throw new Error(
      `Cloudflare API ${init.method ?? "GET"} ${new URL(url).pathname} failed: ${response.status}`,
    );
  }
  return payload;
}

async function removeWorker(
  fetchImpl: MigrationFetch,
  url: string,
  token: string,
): Promise<void> {
  const response = await fetchImpl(url, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
  if (response.status === 404) return;
  const payload = await json(response);
  if (!response.ok || payload.success === false) {
    throw new Error(
      `temporary migration Worker removal failed: ${response.status}`,
    );
  }
}

export function legacyMigrationWorkerSource(input: {
  tokenHash: string;
  legacyPrefix: string;
  bindingId: string;
}): string {
  const targetPrefix = `interface-bindings/${encodeURIComponent(input.bindingId)}/`;
  return `const TOKEN_HASH=${JSON.stringify(input.tokenHash)};
const LEGACY_PREFIX=${JSON.stringify(input.legacyPrefix)};
const TARGET_PREFIX=${JSON.stringify(targetPrefix)};
const MARKER="takos-storage-legacy-etag";
async function authorized(request){
 const match=/^Bearer\\s+(.+)$/.exec(request.headers.get("authorization")||"");
 const bytes=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(match?.[1]||"")));
 return [...bytes].map((byte)=>byte.toString(16).padStart(2,"0")).join("")===TOKEN_HASH;
}
export default {async fetch(request,env){
 if(request.method!=="POST"||new URL(request.url).pathname!=="/migrate"||!(await authorized(request)))return new Response("Not found",{status:404});
 const input=await request.json().catch(()=>({}));
 const cursor=typeof input.cursor==="string"&&input.cursor.length<=4096?input.cursor:undefined;
 const page=await env.BUCKET.list({prefix:LEGACY_PREFIX,limit:50,cursor,include:["httpMetadata","customMetadata"]});
 for(const listed of page.objects){
  const source=await env.BUCKET.get(listed.key);
  if(!source)continue;
  const targetKey=TARGET_PREFIX+listed.key;
  const target=await env.BUCKET.head(targetKey);
  if(target){
   if(target.size!==source.size||target.customMetadata?.[MARKER]!==source.httpEtag){
    return Response.json({ok:false,error:"target_conflict",source:listed.key},{status:409});
   }
  }else{
   const copied=await env.BUCKET.put(targetKey,source.body,{httpMetadata:source.httpMetadata,customMetadata:{...(source.customMetadata||{}),[MARKER]:source.httpEtag},onlyIf:{etagDoesNotMatch:"*"}});
   if(!copied)return Response.json({ok:false,error:"target_race",source:listed.key},{status:409});
  }
 }
 return Response.json({ok:true,migrated:page.objects.length,done:!page.truncated,...(page.truncated&&page.cursor?{cursor:page.cursor}:{})});
}};`;
}

export async function migrateLegacyBindingPrefix(
  env: MigrationEnv = process.env,
  fetchImpl: MigrationFetch = fetch,
): Promise<{ bucketName: string; bindingId: string; migrated: number }> {
  const apiToken = required(
    env.CLOUDFLARE_API_TOKEN ?? env.CF_API_TOKEN,
    "CLOUDFLARE_API_TOKEN",
  );
  const accountId = required(
    env.CLOUDFLARE_ACCOUNT_ID,
    "CLOUDFLARE_ACCOUNT_ID",
  );
  const bucket = bucketName(env);
  const prefix = legacyPrefix(env.TAKOS_STORAGE_LEGACY_KEY_PREFIX);
  const binding = bindingId(env.TAKOS_STORAGE_INTERFACE_BINDING_ID);
  const apiBase = (
    env.TAKOS_STORAGE_MIGRATION_API_BASE_URL ??
    env.CLOUDFLARE_API_BASE_URL ??
    DEFAULT_API_BASE_URL
  ).replace(/\/+$/u, "");
  const name = `takos-storage-migrate-${createHash("sha256")
    .update(`${bucket}\0${binding}\0${prefix}`)
    .digest("hex")
    .slice(0, 16)}`;
  const scriptUrl = `${apiBase}/accounts/${encodeURIComponent(accountId)}/workers/scripts/${name}`;
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const subdomainPayload = await cf(
    fetchImpl,
    `${apiBase}/accounts/${encodeURIComponent(accountId)}/workers/subdomain`,
    apiToken,
    { method: "GET" },
  );
  const result = subdomainPayload.result;
  const subdomain = record(result)
    ? required(
        typeof result.subdomain === "string" ? result.subdomain : undefined,
        "Cloudflare workers.dev subdomain",
      )
    : required(undefined, "Cloudflare workers.dev subdomain");
  const workerUrl = `https://${name}.${subdomain}.workers.dev/migrate`;
  const form = new FormData();
  form.set(
    "metadata",
    new Blob(
      [
        JSON.stringify({
          main_module: "worker.mjs",
          compatibility_date: "2026-07-14",
          bindings: [
            { type: "r2_bucket", name: "BUCKET", bucket_name: bucket },
          ],
        }),
      ],
      { type: "application/json" },
    ),
  );
  form.set(
    "worker.mjs",
    new Blob(
      [
        legacyMigrationWorkerSource({
          tokenHash,
          legacyPrefix: prefix,
          bindingId: binding,
        }),
      ],
      { type: "application/javascript+module" },
    ),
    "worker.mjs",
  );

  let operationError: Error | undefined;
  let migrated = 0;
  try {
    await cf(fetchImpl, scriptUrl, apiToken, { method: "PUT", body: form });
    await cf(fetchImpl, `${scriptUrl}/subdomain`, apiToken, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true, previews_enabled: false }),
    });
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const response = await fetchImpl(workerUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(cursor ? { cursor } : {}),
      });
      const payload = await json(response);
      if (!response.ok || payload.ok !== true) {
        throw new Error(`legacy R2 migration failed: ${response.status}`);
      }
      migrated += typeof payload.migrated === "number" ? payload.migrated : 0;
      if (payload.done === true) break;
      if (typeof payload.cursor !== "string" || !payload.cursor) {
        throw new Error("legacy R2 migration returned no continuation cursor");
      }
      cursor = payload.cursor;
      if (page === MAX_PAGES - 1)
        throw new Error("legacy R2 migration exceeded page cap");
    }
  } catch (error) {
    operationError =
      error instanceof Error ? error : new Error("legacy R2 migration failed");
  }

  let cleanupError: Error | undefined;
  try {
    await removeWorker(fetchImpl, scriptUrl, apiToken);
  } catch (error) {
    cleanupError =
      error instanceof Error ? error : new Error("migration cleanup failed");
  }
  if (operationError && cleanupError) {
    throw new AggregateError(
      [operationError, cleanupError],
      "migration and cleanup failed",
    );
  }
  if (operationError) throw operationError;
  if (cleanupError) throw cleanupError;
  return { bucketName: bucket, bindingId: binding, migrated };
}

if (import.meta.main) {
  console.log(JSON.stringify(await migrateLegacyBindingPrefix()));
}

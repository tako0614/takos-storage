import { readFile } from "node:fs/promises";

const outputs = await readCapsuleOutputs();
const baseInput =
  process.env.STORAGE_URL ??
  process.env.STORAGE_API_BASE_URL?.replace(/\/o\/?$/, "") ??
  stringOutput(outputs, "url", "public_url", "launch_url") ??
  process.env.TAKOSUMI_CAPSULE_PUBLIC_URL ??
  "";
const interfaceTokens = {
  read: process.env.TAKOSUMI_INTERFACE_OAUTH_READ_TOKEN ?? "",
  write: process.env.TAKOSUMI_INTERFACE_OAUTH_WRITE_TOKEN ?? "",
  list: process.env.TAKOSUMI_INTERFACE_OAUTH_LIST_TOKEN ?? "",
  delete: process.env.TAKOSUMI_INTERFACE_OAUTH_DELETE_TOKEN ?? "",
};
const skipMutation = process.env.STORAGE_SKIP_MUTATION === "1";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function resolveBaseUrl(input: string): URL {
  if (!input) fail("STORAGE_URL or STORAGE_API_BASE_URL is required");
  try {
    const url = new URL(input);
    url.pathname = url.pathname.replace(/\/$/, "");
    return url;
  } catch {
    fail("STORAGE_URL must be a valid URL");
  }
}

async function expectOk(url: URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, init);
  if (!response.ok) {
    fail(
      `${init?.method ?? "GET"} ${url.pathname}${url.search} failed: ${response.status}`,
    );
  }
  return response;
}

async function readCapsuleOutputs(): Promise<Record<string, unknown>> {
  const file = process.env.TAKOSUMI_CAPSULE_OUTPUTS_FILE;
  if (!file) return {};
  const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function stringOutput(
  outputs: Record<string, unknown>,
  ...names: string[]
): string | undefined {
  for (const name of names) {
    const value = outputs[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

const baseUrl = resolveBaseUrl(baseInput);
const rootUrl = new URL("/", baseUrl);
const healthUrl = new URL("/healthz", baseUrl);

await expectOk(rootUrl);
await expectOk(healthUrl);
const checks = ["root", "health"];

if (!skipMutation) {
  const missingPermissions = Object.entries(interfaceTokens)
    .filter(([, token]) => !token)
    .map(([permission]) => permission);
  if (missingPermissions.length > 0) {
    fail(
      `Interface OAuth tokens are required unless STORAGE_SKIP_MUTATION=1; missing: ${missingPermissions.join(", ")}`,
    );
  }
  const prefix = process.env.STORAGE_SMOKE_PREFIX ?? `smoke/${Date.now()}/`;
  const key = `${prefix}object.txt`;
  const objectUrl = new URL(`/o/${encodeURIComponent(key)}`, baseUrl);
  const listUrl = new URL("/o", baseUrl);
  listUrl.searchParams.set("prefix", prefix);
  await expectOk(objectUrl, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${interfaceTokens.write}`,
      "content-type": "text/plain; charset=utf-8",
    },
    body: "takos-storage smoke",
  });
  checks.push("object.put");
  const read = await expectOk(objectUrl, {
    headers: { authorization: `Bearer ${interfaceTokens.read}` },
  });
  if ((await read.text()) !== "takos-storage smoke")
    fail("stored object body did not round-trip");
  checks.push("object.get");
  await expectOk(objectUrl, {
    method: "HEAD",
    headers: { authorization: `Bearer ${interfaceTokens.read}` },
  });
  checks.push("object.head");
  const listing = (await (
    await expectOk(listUrl, {
      headers: { authorization: `Bearer ${interfaceTokens.list}` },
    })
  ).json()) as {
    objects?: { key?: string }[];
  };
  if (!listing.objects?.some((object) => object.key === key)) {
    fail("stored object was not present in the prefix listing");
  }
  checks.push("object.list");
  await expectOk(objectUrl, {
    method: "DELETE",
    headers: { authorization: `Bearer ${interfaceTokens.delete}` },
  });
  checks.push("object.delete");
  const deleted = await fetch(objectUrl, {
    headers: { authorization: `Bearer ${interfaceTokens.read}` },
  });
  if (deleted.status !== 404)
    fail(`deleted object remained readable: ${deleted.status}`);
  checks.push("object.cleanup");
}

console.log(
  JSON.stringify({
    kind: "takosumi.capsule-functional-probe@v1",
    status: "passed",
    product: "takos-storage",
    checks: checks.map((name) => ({ name, status: "passed" })),
    cleanupVerified: true,
    ok: true,
    service: "takos-storage",
    mutated: !skipMutation,
  }),
);

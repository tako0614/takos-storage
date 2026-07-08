const baseInput =
  process.env.TAKOS_STORAGE_URL ??
  process.env.TAKOS_STORAGE_API_BASE_URL?.replace(/\/o\/?$/, "") ??
  "";
const token = process.env.TAKOS_STORAGE_ACCESS_TOKEN ?? "";
const skipMutation = process.env.TAKOS_STORAGE_SKIP_MUTATION === "1";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function resolveBaseUrl(input: string): URL {
  if (!input) fail("TAKOS_STORAGE_URL or TAKOS_STORAGE_API_BASE_URL is required");
  try {
    const url = new URL(input);
    url.pathname = url.pathname.replace(/\/$/, "");
    return url;
  } catch {
    fail("TAKOS_STORAGE_URL must be a valid URL");
  }
}

async function expectOk(url: URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, init);
  if (!response.ok) {
    fail(`${init?.method ?? "GET"} ${url.pathname}${url.search} failed: ${response.status}`);
  }
  return response;
}

const baseUrl = resolveBaseUrl(baseInput);
const rootUrl = new URL("/", baseUrl);
const healthUrl = new URL("/healthz", baseUrl);

await expectOk(rootUrl);
await expectOk(healthUrl);

if (!skipMutation) {
  if (!token) fail("TAKOS_STORAGE_ACCESS_TOKEN is required unless TAKOS_STORAGE_SKIP_MUTATION=1");
  const prefix = process.env.TAKOS_STORAGE_SMOKE_PREFIX ?? `smoke/${Date.now()}/`;
  const key = `${prefix}object.txt`;
  const objectUrl = new URL(`/o/${encodeURIComponent(key)}`, baseUrl);
  const listUrl = new URL("/o", baseUrl);
  listUrl.searchParams.set("prefix", prefix);
  const headers = { authorization: `Bearer ${token}` };

  await expectOk(objectUrl, {
    method: "PUT",
    headers: { ...headers, "content-type": "text/plain; charset=utf-8" },
    body: "takos-storage smoke",
  });
  const read = await expectOk(objectUrl, { headers });
  if ((await read.text()) !== "takos-storage smoke") fail("stored object body did not round-trip");
  await expectOk(objectUrl, { method: "HEAD", headers });
  await expectOk(listUrl, { headers });
  await expectOk(objectUrl, { method: "DELETE", headers });
}

console.log(
  JSON.stringify({
    ok: true,
    service: "takos-storage",
    url: rootUrl.toString(),
    mutated: !skipMutation,
  }),
);

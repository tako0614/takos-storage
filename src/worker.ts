/**
 * takos-storage — workspace object store service.
 *
 * A plain HTTP object API over a single R2 bucket, gated by scoped bearer
 * tokens that Takosumi mints at bind time. Each token is bounded to a key
 * prefix + verb set, so a consumer app can only touch its own slice.
 *
 *   GET    /healthz          liveness (no auth)
 *   PUT    /o/<key>          store an object          (verb: w)
 *   GET    /o/<key>          fetch an object          (verb: r)
 *   HEAD   /o/<key>          object metadata          (verb: r)
 *   DELETE /o/<key>          remove an object         (verb: d)
 *   GET    /o?prefix=<p>     list keys under a prefix (verb: l)
 *
 * S3 SigV4 compatibility is intentionally out of scope for P0 (see the repo
 * README); this surface exists to prove the bind-time scoped-token flow.
 */

import type { Env } from "./types.ts";
import { type StorageTokenVerb, tokenAllows, verifyStorageToken } from "./token.ts";

const OBJECT_PREFIX = "/o/";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function html(body: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function storageConsoleHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Takos Storage</title>
  <style>
    :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: Canvas; color: CanvasText; }
    main { width: min(960px, calc(100% - 32px)); margin: 32px auto; display: grid; gap: 18px; }
    header { display: grid; gap: 6px; }
    h1 { margin: 0; font-size: 28px; line-height: 1.15; }
    p { margin: 0; color: color-mix(in srgb, CanvasText 70%, transparent); }
    section { border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 8px; padding: 16px; display: grid; gap: 14px; }
    label { display: grid; gap: 6px; font-size: 13px; font-weight: 600; }
    input, textarea { width: 100%; box-sizing: border-box; border: 1px solid color-mix(in srgb, CanvasText 22%, transparent); border-radius: 6px; padding: 10px 11px; background: Canvas; color: CanvasText; font: inherit; }
    textarea { min-height: 140px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; }
    button { border: 1px solid color-mix(in srgb, CanvasText 22%, transparent); border-radius: 6px; padding: 9px 12px; background: color-mix(in srgb, CanvasText 8%, Canvas); color: CanvasText; font: inherit; cursor: pointer; }
    button.primary { background: CanvasText; color: Canvas; }
    pre { margin: 0; overflow: auto; border-radius: 6px; padding: 12px; background: color-mix(in srgb, CanvasText 8%, Canvas); min-height: 96px; font-size: 13px; line-height: 1.45; }
    @media (max-width: 720px) { main { width: min(100% - 20px, 960px); margin: 18px auto; } .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Takos Storage</h1>
      <p>Object storage API for this Capsule. Paste a scoped access token to inspect or edit objects.</p>
    </header>
    <section>
      <label>Access token
        <input id="token" type="password" autocomplete="off" placeholder="Scoped token minted by Takosumi">
      </label>
      <div class="grid">
        <label>Prefix
          <input id="prefix" value="" placeholder="workspace/app/">
        </label>
        <label>Object key
          <input id="key" value="" placeholder="workspace/app/file.txt">
        </label>
      </div>
      <div class="actions">
        <button id="health">Check service</button>
        <button id="list" class="primary">List objects</button>
        <button id="get">Read object</button>
        <button id="put">Write object</button>
        <button id="del">Delete object</button>
      </div>
    </section>
    <section>
      <label>Object body
        <textarea id="body" spellcheck="false" placeholder="Text written by Write object, or filled by Read object."></textarea>
      </label>
      <pre id="result">Ready.</pre>
    </section>
  </main>
  <script>
    const byId = (id) => document.getElementById(id);
    const result = byId("result");
    function tokenHeaders() {
      const token = byId("token").value.trim();
      return token ? { authorization: "Bearer " + token } : {};
    }
    function print(value) {
      result.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    }
    async function call(path, init) {
      const response = await fetch(path, {
        ...init,
        headers: { ...tokenHeaders(), ...(init && init.headers ? init.headers : {}) },
      });
      const text = await response.text();
      let payload = text;
      try { payload = JSON.parse(text); } catch {}
      print({ status: response.status, ok: response.ok, body: payload });
      return { response, text };
    }
    byId("health").addEventListener("click", () => call("/healthz"));
    byId("list").addEventListener("click", () => {
      const prefix = encodeURIComponent(byId("prefix").value);
      call("/o?prefix=" + prefix);
    });
    byId("get").addEventListener("click", async () => {
      const key = byId("key").value.trim();
      if (!key) return print("Object key is required.");
      const out = await call("/o/" + encodeURIComponent(key));
      if (out.response.ok) byId("body").value = out.text;
    });
    byId("put").addEventListener("click", () => {
      const key = byId("key").value.trim();
      if (!key) return print("Object key is required.");
      call("/o/" + encodeURIComponent(key), {
        method: "PUT",
        headers: { "content-type": "text/plain; charset=utf-8" },
        body: byId("body").value,
      });
    });
    byId("del").addEventListener("click", () => {
      const key = byId("key").value.trim();
      if (!key) return print("Object key is required.");
      call("/o/" + encodeURIComponent(key), { method: "DELETE" });
    });
  </script>
</body>
</html>`;
}

const VERB_BY_METHOD: Record<string, StorageTokenVerb> = {
  GET: "r",
  HEAD: "r",
  PUT: "w",
  DELETE: "d",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const nowSeconds = Math.floor(Date.now() / 1000);

    if (request.method === "GET" && url.pathname === "/healthz") {
      return json({ status: "ok", service: "takos-storage" });
    }
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/ui")) {
      return html(storageConsoleHtml());
    }

    const isListPath = url.pathname === "/o" || url.pathname === "/o/";
    const isObjectPath = url.pathname.startsWith(OBJECT_PREFIX) && !isListPath;
    if (!isListPath && !isObjectPath) return json({ error: "not_found" }, 404);

    // --- authenticate ---
    const authHeader = request.headers.get("authorization") ?? "";
    const bearer = /^Bearer\s+(.+)$/i.exec(authHeader);
    if (!bearer) return json({ error: "missing_bearer_token" }, 401);
    if (!env.STORAGE_TOKEN_SIGNING_KEY) {
      return json({ error: "storage_signing_key_unconfigured" }, 503);
    }
    const verified = await verifyStorageToken(
      env.STORAGE_TOKEN_SIGNING_KEY,
      bearer[1],
      nowSeconds,
    );
    if (!verified.ok) return json({ error: "invalid_token", reason: verified.reason }, 401);
    const { payload } = verified;

    // --- list ---
    if (isListPath) {
      if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
      if (!payload.cap.includes("l")) return json({ error: "forbidden", verb: "l" }, 403);
      const requested = url.searchParams.get("prefix") ?? "";
      if (payload.pfx && !requested.startsWith(payload.pfx)) {
        return json({ error: "forbidden_prefix", allowed: payload.pfx }, 403);
      }
      const listing = await env.BUCKET.list({
        prefix: requested || payload.pfx,
        limit: 1000,
      });
      return json({
        objects: listing.objects.map((object) => ({
          key: object.key,
          size: object.size,
          uploaded: object.uploaded,
        })),
        truncated: listing.truncated,
      });
    }

    // --- object ops ---
    let key: string;
    try {
      key = decodeURIComponent(url.pathname.slice(OBJECT_PREFIX.length));
    } catch {
      return json({ error: "invalid_key" }, 400);
    }
    if (!key) return json({ error: "empty_key" }, 400);

    const verb = VERB_BY_METHOD[request.method];
    if (!verb) return json({ error: "method_not_allowed" }, 405);
    if (!tokenAllows(payload, verb, key)) return json({ error: "forbidden", verb, key }, 403);

    if (verb === "r") {
      const object = await env.BUCKET.get(key);
      if (!object) return json({ error: "not_found" }, 404);
      const headers = new Headers({
        "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
      });
      if (object.httpEtag) headers.set("etag", object.httpEtag);
      if (request.method === "HEAD") return new Response(null, { status: 200, headers });
      return new Response(object.body, { status: 200, headers });
    }

    if (verb === "w") {
      const contentType = request.headers.get("content-type") ?? "application/octet-stream";
      const data = await request.arrayBuffer();
      await env.BUCKET.put(key, data, { httpMetadata: { contentType } });
      return json({ ok: true, key }, 201);
    }

    await env.BUCKET.delete(key);
    return json({ ok: true, key });
  },
};

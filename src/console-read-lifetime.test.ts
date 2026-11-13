import { afterEach, describe, expect, test } from "bun:test";
import { createContext, runInContext } from "node:vm";
import { storageConsoleHtml } from "./console.ts";
import worker from "./worker.ts";
import type {
  Env,
  R2Bucket,
  R2Object,
  R2ObjectBody,
  R2PutOptions,
} from "./types.ts";

// A disposable public-mode bucket, matching the existing Drive API tests.
// No real account, session, provider, or stored user data is involved.
class Bucket implements R2Bucket {
  objects = new Map<
    string,
    {
      bytes: Uint8Array;
      etag: string;
      type: string;
      metadata?: Record<string, string>;
    }
  >();
  effects = 0;
  async head(key: string): Promise<R2Object | null> {
    const item = this.objects.get(key);
    if (!item) return null;
    const bytes = item.bytes;
    return {
      key,
      size: bytes.length,
      uploaded: new Date(0),
      httpEtag: item.etag,
      httpMetadata: { contentType: item.type },
      customMetadata: item.metadata,
    };
  }

  async get(key: string): Promise<R2ObjectBody | null> {
    const item = this.objects.get(key);
    if (!item) return null;
    const bytes = item.bytes.slice();
    return {
      key,
      size: bytes.length,
      uploaded: new Date(0),
      httpEtag: item.etag,
      httpMetadata: { contentType: item.type },
      customMetadata: item.metadata,
      body: new Response(bytes).body!,
      arrayBuffer: async () => bytes.buffer,
    };
  }
  async put(
    key: string,
    body: ArrayBuffer | ReadableStream | string,
    options?: R2PutOptions,
  ): Promise<R2Object | null> {
    const old = this.objects.get(key),
      condition = options?.onlyIf;
    const match =
      condition instanceof Headers
        ? condition.get("if-match")
        : condition?.etagMatches;
    const absent =
      condition instanceof Headers
        ? condition.get("if-none-match")
        : condition?.etagDoesNotMatch;
    if (match != null && old?.etag !== match) return null;
    if (absent === "*" && old) return null;
    const bytes = new Uint8Array(await new Response(body).arrayBuffer());
    this.objects.set(key, {
      bytes,
      etag: `"test-${++this.effects}"`,
      type: options?.httpMetadata?.contentType ?? "application/octet-stream",
      metadata: options?.customMetadata,
    });
    return this.head(key);
  }
  async delete(key: string) {
    if (this.objects.delete(key)) this.effects++;
  }
  async list() {
    const objects = await Promise.all(
      [...this.objects.keys()].sort().map((key) => this.head(key)),
    );
    return {
      objects: objects.filter((x): x is R2Object => x !== null),
      truncated: false,
    };
  }
}

type Listener = (event: {
  preventDefault(): void;
  stopPropagation(): void;
  target?: unknown;
}) => void;
class Element {
  value = "";
  textContent = "";
  private html = "";
  get innerHTML() {
    return this.html;
  }
  set innerHTML(value: string) {
    this.html = value;
    this.children = [];
  }
  hidden = false;
  disabled = false;
  open = false;
  files: File[] = [];
  dataset: Record<string, string> = {};
  style = { setProperty() {} };
  listeners = new Map<string, Listener[]>();
  attributes = new Map<string, string>();
  children: Element[] = [];
  classes = new Set<string>();
  classList = {
    add: (s: string) => this.classes.add(s),
    remove: (s: string) => this.classes.delete(s),
    contains: (s: string) => this.classes.has(s),
    toggle: (s: string) =>
      this.classes.has(s) ? this.classes.delete(s) : this.classes.add(s),
  };
  constructor(readonly actions?: Element[]) {}
  addEventListener(name: string, fn: Listener) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]);
  }
  dispatch(name: string) {
    for (const fn of this.listeners.get(name) ?? [])
      fn({ preventDefault() {}, stopPropagation() {}, target: this });
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  querySelector() {
    return new Element();
  }
  querySelectorAll(selector: string) {
    return selector === "[data-action]" ? (this.actions ?? []) : [];
  }
  appendChild(node: Element) {
    this.children.push(node);
    return node;
  }
  append(...nodes: Element[]) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes: Element[]) {
    this.children = nodes;
  }
  contains() {
    return false;
  }
  focus() {}
  select() {}
  remove() {}
  click() {
    this.dispatch("click");
  }
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, bottom: 0 };
  }
}

interface Client {
  state: { files: { path: string }[]; loading: boolean; failed: boolean };
  refresh(): void;
  newFolder(name: string): void;
  preview(name: string): void;
  closePreview(): void;
}
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function until(check: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!check()) {
    if (Date.now() > deadline) throw Error("console did not settle");
    await Bun.sleep(5);
  }
}
async function fixture() {
  const bucket = new Bucket();
  const env: Env = { BUCKET: bucket, ALLOW_UNAUTHENTICATED_DRIVE: "1" };
  let nextList: ((response: Response) => Promise<Response>) | undefined;
  const nextFile = new Map<string, (response: Response) => Promise<Response>>();
  let lists = 0;
  const writes: { status: number; absent: string | null }[] = [];
  const nodes = new Map<string, Element>();
  const node = (id: string) => {
    if (!nodes.has(id)) nodes.set(id, new Element());
    return nodes.get(id)!;
  };
  const location = { pathname: "/", search: "", href: "" };
  const urls: string[] = [],
    revoked: string[] = [];
  class PreviewURL extends URL {
    static createObjectURL() {
      const url = `blob:fixture-${urls.length}`;
      urls.push(url);
      return url;
    }
    static revokeObjectURL(url: string) {
      revoked.push(url);
    }
  }
  const script = [
    ...storageConsoleHtml().matchAll(/<script>([\s\S]*?)<\/script>/gu),
  ]
    .map((x) => x[1]!)
    .find((x) => x.includes("var state ="));
  if (!script || !script.includes("\n  boot();"))
    throw Error("console script seam unavailable");
  const context = createContext({
    document: {
      getElementById: node,
      querySelectorAll: () => [],
      addEventListener() {},
      createElement: () => new Element(),
      createDocumentFragment: () => new Element(),
      activeElement: null,
      body: new Element(),
      documentElement: { lang: "en", dataset: { theme: "light" } },
    },
    navigator: { language: "en" },
    localStorage: { getItem: () => null, setItem() {} },
    window: { addEventListener() {}, innerWidth: 1200, innerHeight: 800 },
    location,
    fetch: async (path: string, init?: RequestInit) => {
      const request = new Request(new URL(path, "http://storage.local"), init);
      const hold = path === "/api/drive/list" ? nextList : nextFile.get(path);
      if (path === "/api/drive/list") nextList = undefined;
      else nextFile.delete(path);
      // This runs the actual product handlers; only R2 and presentation DOM are fixtures.
      const response = await worker.fetch(request, env);
      if (path === "/api/drive/list") lists++;
      if (request.method !== "GET")
        writes.push({
          status: response.status,
          absent: request.headers.get("if-none-match"),
        });
      return hold ? hold(response) : response;
    },
    URL: PreviewURL,
    Blob,
    File,
    Headers,
    Response,
    Request,
    console,
    setTimeout: (fn: () => void, delay: number) => {
      const timer = setTimeout(fn, delay);
      timer.unref();
      cleanups.push(() => clearTimeout(timer));
      return timer;
    },
    clearTimeout,
  });
  runInContext(
    script.replace(
      "\n  boot();",
      `
    globalThis.client = { state: state, refresh: load,
      newFolder: function(name) { nameMode = 'folder'; nameInput.value = name;
        nameForm.dispatch('submit'); },
      preview: function(name) { var item = currentVisible.find(function(x) { return x.name === name; });
        if (!item) throw new Error('missing actual listed file ' + name); openPreview(item); },
      closePreview: closePreview };
    boot();`,
    ),
    context,
  );
  const client = context.client as Client;
  await until(() => lists === 1 && !client.state.loading);
  async function holdList() {
    const response = deferred<Response>(),
      arrived = deferred<Response>();
    nextList = async (r) => {
      arrived.resolve(r);
      return response.promise;
    };
    client.refresh();
    const snapshot = await arrived.promise;
    return { snapshot, response };
  }
  async function createFolder() {
    client.newFolder("created");
    await until(() => writes.length === 1 && !client.state.loading);
    expect(writes).toEqual([{ status: 201, absent: "*" }]);
    expect(client.state.files.map((x) => x.path)).toContain("created/");
  }
  async function files(entries: Record<string, string>) {
    for (const [name, body] of Object.entries(entries)) {
      const response = await worker.fetch(
        new Request(
          `http://storage.local/api/drive/file/${encodeURIComponent(name)}`,
          {
            method: "PUT",
            headers: { "if-none-match": "*" },
            body,
          },
        ),
        env,
      );
      expect(response.status).toBe(201);
    }
    client.refresh();
    await until(() => !client.state.loading);
  }
  async function holdPreview(name: string) {
    const response = deferred<Response>(),
      arrived = deferred<Response>();
    nextFile.set(`/api/drive/file/${encodeURIComponent(name)}`, async (r) => {
      arrived.resolve(r);
      return response.promise;
    });
    client.preview(name);
    return { snapshot: await arrived.promise, response };
  }
  const preview = () => node("preview-body").children[0];
  async function replaceFile(name: string, body: string) {
    const url = `http://storage.local/api/drive/file/${encodeURIComponent(name)}`;
    const head = await worker.fetch(new Request(url, { method: "HEAD" }), env);
    const response = await worker.fetch(
      new Request(url, {
        method: "PUT",
        headers: { "if-match": head.headers.get("etag")! },
        body,
      }),
      env,
    );
    expect(response.status).toBe(201);
  }
  return {
    bucket,
    client,
    location,
    holdList,
    createFolder,
    files,
    holdPreview,
    preview,
    node,
    urls,
    revoked,
    replaceFile,
  };
}

// Flush the actual console promise chain, including Response.json() rejection.
async function settle() {
  await Bun.sleep(20);
}

describe("console listing response lifetime", () => {
  test("an older actual listing cannot hide a newly created folder", async () => {
    const f = await fixture(),
      old = await f.holdList();
    await f.createFolder();
    const effects = f.bucket.effects;
    old.response.resolve(old.snapshot);
    await settle();
    expect(f.client.state.files.map((x) => x.path)).toContain("created/");
    expect(f.client.state.failed).toBe(false);
    expect(f.bucket.effects).toBe(effects);
  });

  for (const outcome of ["success", "failure"] as const) {
    test(`an obsolete body ${outcome} is ignored after response headers arrived`, async () => {
      const f = await fixture(),
        old = await f.holdList();
      const bytes = new Uint8Array(await old.snapshot.arrayBuffer());
      const reading = deferred<void>();
      let body!: ReadableStreamDefaultController<Uint8Array>;
      const stream = new ReadableStream<Uint8Array>(
        {
          start(controller) {
            body = controller;
          },
          pull() {
            reading.resolve();
          },
        },
        { highWaterMark: 0 },
      );
      old.response.resolve(new Response(stream));
      await reading.promise;
      await f.createFolder();
      if (outcome === "failure") body.error(new Error("obsolete body fixture"));
      else {
        body.enqueue(bytes);
        body.close();
      }
      await settle();
      expect(f.client.state.failed).toBe(false);
      expect(f.client.state.files.map((x) => x.path)).toContain("created/");
    });
  }

  for (const failure of ["http", "network", "body"] as const) {
    test(`an obsolete ${failure} failure cannot replace a successful listing`, async () => {
      const f = await fixture(),
        old = await f.holdList();
      await f.createFolder();
      if (failure === "network")
        old.response.reject(new Error("local network fixture"));
      else
        old.response.resolve(
          new Response(failure === "body" ? "{" : "unavailable", {
            status: failure === "http" ? 503 : 200,
          }),
        );
      await settle();
      expect(f.client.state.failed).toBe(false);
      expect(f.client.state.files.map((x) => x.path)).toContain("created/");
    });
  }

  test("an old failure cannot end a newer pending load", async () => {
    const f = await fixture(),
      old = await f.holdList(),
      current = await f.holdList();
    old.response.reject(new Error("obsolete network fixture"));
    await settle();
    expect(f.client.state.loading).toBe(true);
    expect(f.client.state.failed).toBe(false);
    current.response.resolve(current.snapshot);
    await until(() => !f.client.state.loading);
    expect(f.client.state.failed).toBe(false);
  });

  test("a current failure remains visible and a manual refresh recovers", async () => {
    const f = await fixture(),
      current = await f.holdList();
    current.response.resolve(new Response("unavailable", { status: 503 }));
    await until(() => !f.client.state.loading);
    expect(f.client.state.failed).toBe(true);
    f.client.refresh();
    await until(() => !f.client.state.loading);
    expect(f.client.state.failed).toBe(false);
  });

  test("an obsolete unauthorized response cannot redirect a newer successful read", async () => {
    const f = await fixture(),
      old = await f.holdList();
    await f.createFolder();
    old.response.resolve(new Response(null, { status: 401 }));
    await settle();
    expect(f.location.href).toBe("");
    expect(f.client.state.failed).toBe(false);
  });

  test("a current unauthorized response still redirects to sign in", async () => {
    const f = await fixture(),
      current = await f.holdList();
    current.response.resolve(new Response(null, { status: 401 }));
    await until(() => f.location.href !== "");
    expect(f.location.href).toBe("/api/auth/login?return_to=%2F");
  });
});

describe("console preview response lifetime", () => {
  for (const name of ["old.txt", "old.png"]) {
    test(`a late failure for ${name} cannot replace the next file's content`, async () => {
      const f = await fixture();
      await f.files({ [name]: "old", "current.txt": "current body" });
      const old = await f.holdPreview(name);
      f.client.preview("current.txt");
      await until(() => f.preview()?.textContent === "current body");
      old.response.resolve(new Response(null, { status: 503 }));
      await settle();
      expect(f.preview()?.textContent).toBe("current body");
      expect(f.node("preview-name").textContent).toBe("current.txt");
    });
  }

  test("a late body failure cannot replace the next file's content", async () => {
    const f = await fixture();
    await f.files({ "old.txt": "old", "current.txt": "current body" });
    const old = await f.holdPreview("old.txt"),
      reading = deferred<void>();
    let body!: ReadableStreamDefaultController<Uint8Array>;
    old.response.resolve(
      new Response(
        new ReadableStream<Uint8Array>(
          {
            start(controller) {
              body = controller;
            },
            pull() {
              reading.resolve();
            },
          },
          { highWaterMark: 0 },
        ),
      ),
    );
    await reading.promise;
    f.client.preview("current.txt");
    await until(() => f.preview()?.textContent === "current body");
    body.error(new Error("obsolete preview body fixture"));
    await settle();
    expect(f.preview()?.textContent).toBe("current body");
  });

  test("reopening the same listed item retires its first read", async () => {
    const f = await fixture();
    await f.files({ "a.txt": "old A", "b.txt": "B" });
    const old = await f.holdPreview("a.txt");
    f.client.preview("b.txt");
    await until(() => f.preview()?.textContent === "B");
    await f.replaceFile("a.txt", "new A");
    // No list rerender: A is the same object as the first clicked row.
    f.client.preview("a.txt");
    await until(() => f.preview()?.textContent === "new A");
    old.response.resolve(old.snapshot);
    await settle();
    expect(f.preview()?.textContent).toBe("new A");
  });

  test("closing retires a pending preview failure without repopulating its body", async () => {
    const f = await fixture();
    await f.files({ "a.txt": "A" });
    const old = await f.holdPreview("a.txt");
    f.client.closePreview();
    old.response.reject(new Error("closed preview fixture"));
    await settle();
    expect(f.node("preview").classes.has("open")).toBe(false);
    expect(f.node("preview-body").children).toHaveLength(0);
  });

  test("an obsolete preview 401 cannot redirect the next successful preview", async () => {
    const f = await fixture();
    await f.files({ "a.txt": "A", "b.txt": "B" });
    const old = await f.holdPreview("a.txt");
    f.client.preview("b.txt");
    await until(() => f.preview()?.textContent === "B");
    old.response.resolve(new Response(null, { status: 401 }));
    await settle();
    expect(f.location.href).toBe("");
    expect(f.preview()?.textContent).toBe("B");
  });

  test("a current preview 401 still redirects to sign in", async () => {
    const f = await fixture();
    await f.files({ "a.txt": "A" });
    const current = await f.holdPreview("a.txt");
    current.response.resolve(new Response(null, { status: 401 }));
    await until(() => f.location.href !== "");
    expect(f.location.href).toBe("/api/auth/login?return_to=%2F");
  });

  test("a current error offers fallback and reopening the file recovers", async () => {
    const f = await fixture();
    await f.files({ "a.txt": "A" });
    const current = await f.holdPreview("a.txt");
    current.response.resolve(new Response(null, { status: 503 }));
    await until(() => f.preview()?.children.length === 2);
    expect(f.preview()?.children[1]?.textContent).toBe("Download");
    f.client.closePreview();
    f.client.preview("a.txt");
    await until(() => f.preview()?.textContent === "A");
    expect(f.node("preview").classes.has("open")).toBe(true);
  });

  test("replacing and closing an image release each owned object URL once", async () => {
    const f = await fixture();
    await f.files({ "a.png": "A", "b.png": "B" });
    f.client.preview("a.png");
    await until(() => f.urls.length === 1);
    const current = await f.holdPreview("b.png");
    expect(f.revoked).toEqual([f.urls[0]!]);
    current.response.resolve(current.snapshot);
    await until(() => f.urls.length === 2);
    f.client.closePreview();
    f.client.closePreview();
    expect(f.revoked).toEqual(f.urls);
  });
});

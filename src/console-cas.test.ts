import { afterEach, describe, expect, test } from "bun:test";
import { createContext, runInContext } from "node:vm";
import { storageConsoleHtml } from "./console.ts";
import worker from "./worker.ts";
import type { Env, R2Bucket, R2Object, R2PutOptions } from "./types.ts";

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
  async get(key: string): Promise<R2Object | null> {
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
    return this.get(key);
  }
  async delete(key: string) {
    if (this.objects.delete(key)) this.effects++;
  }
  async list() {
    const objects = await Promise.all(
      [...this.objects.keys()].sort().map((key) => this.get(key)),
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
  innerHTML = "";
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

interface Item {
  name: string;
  path: string;
  type: "file" | "folder";
  etag?: string;
}
interface Client {
  state: { files: unknown[]; query: string; nav: string; loading: boolean };
  items: () => Item[];
  refresh(): void;
  select(item: Item): void;
  newFolder(name: string): void;
}
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
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
  const requests: { method: string; path: string; status: number }[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const response = await worker.fetch(request, env);
      requests.push({
        method: request.method,
        path: new URL(request.url).pathname,
        status: response.status,
      });
      return response;
    },
  });
  cleanups.push(() => server.stop(true));
  const send = (path: string, init?: RequestInit) =>
    fetch(new URL(path, server.url), init);
  const actions = new Map(
    ["open", "download", "rename", "delete"].map((name) => {
      const node = new Element();
      node.setAttribute("data-action", name);
      return [name, node] as const;
    }),
  );
  const nodes = new Map<string, Element>();
  const node = (id: string) => {
    if (!nodes.has(id))
      nodes.set(
        id,
        new Element(id === "item-menu" ? [...actions.values()] : undefined),
      );
    return nodes.get(id)!;
  };
  const document = {
    getElementById: node,
    querySelectorAll: () => [],
    addEventListener() {},
    createElement: () => new Element(),
    createDocumentFragment: () => new Element(),
    activeElement: null,
    documentElement: { lang: "en", dataset: { theme: "light" } },
  };
  const scripts = [
    ...storageConsoleHtml().matchAll(/<script>([\s\S]*?)<\/script>/gu),
  ];
  const original = scripts
    .map((x) => x[1]!)
    .find((x) => x.includes("var state ="));
  if (!original || !original.includes("\n  boot();"))
    throw Error("console script seam unavailable");
  // Only the presentation DOM is stubbed. The actual generated console script,
  // action listeners, list mapping, fetches and product HTTP handlers run here.
  const instrumented = original
    .replace(
      "/* splash keeps the error text */",
      "globalThis.bootFailure = String(arguments[0]);",
    )
    .replace(
      "\n  boot();",
      `
    globalThis.client = { state: state, items: visibleItems, refresh: load,
      select: function(item) { menuTarget = item; },
      newFolder: function(name) { nameMode = 'folder'; nameInput.value = name;
        nameForm.dispatch('submit'); } };
    boot();`,
    );
  const context = createContext({
    document,
    navigator: { language: "en" },
    localStorage: { getItem: () => null, setItem() {} },
    window: { addEventListener() {}, innerWidth: 1200, innerHeight: 800 },
    location: { pathname: "/", search: "", href: "" },
    fetch: send,
    URL,
    Blob,
    File,
    Headers,
    Response,
    Request,
    setTimeout: (fn: () => void, delay: number) => {
      const timer = setTimeout(fn, delay);
      timer.unref();
      cleanups.push(() => clearTimeout(timer));
      return timer;
    },
    clearTimeout,
    console,
  });
  runInContext(instrumented, context);
  const client = context.client as Client;
  await until(() => !!context.bootFailure || !client.state.loading);
  if (context.bootFailure)
    throw Error("console presentation fixture: " + String(context.bootFailure));
  const refresh = async () => {
    client.refresh();
    await until(() => !client.state.loading);
  };
  const create = (name: string, body = "original") =>
    send(`/api/drive/file/${encodeURIComponent(name)}`, {
      method: "PUT",
      headers: { "if-none-match": "*" },
      body,
    });
  const item = (name: string) => {
    const entry = client.items().find((x) => x.name === name);
    if (!entry) throw Error("missing listed item " + name);
    return entry;
  };
  const rename = (entry: Item, name: string) => {
    client.select(entry);
    actions.get("rename")!.click();
    node("name-input").value = name;
    node("name-form").dispatch("submit");
  };
  const remove = (entry: Item) => {
    client.select(entry);
    actions.get("delete")!.click();
    node("delete-confirm").click();
  };
  const upload = (name: string, body: string) => {
    node("file-input").files = [new File([body], name, { type: "text/plain" })];
    node("file-input").dispatch("change");
  };
  const writes = () =>
    requests.filter((x) => x.method !== "GET" && x.method !== "HEAD");
  return {
    bucket,
    send,
    requests,
    writes,
    client,
    node,
    refresh,
    create,
    item,
    rename,
    remove,
    upload,
  };
}

describe("console CAS callers against the product HTTP API", () => {
  test("new folders are create-only, including a repeated name", async () => {
    const f = await fixture();
    f.client.newFolder("folder");
    await until(() => f.writes().length === 1);
    expect(f.writes()[0]!.status).toBe(201);
    await until(() => !f.client.state.loading);
    const effects = f.bucket.effects;
    f.client.newFolder("folder");
    await until(() => f.writes().length === 2);
    expect(f.writes()[1]!.status).toBe(412);
    expect(f.bucket.effects).toBe(effects);
  });

  test("new uploads are create-only and name conflicts preserve the stored bytes", async () => {
    const f = await fixture();
    f.upload("upload.txt", "first");
    await until(() => f.writes().length === 1);
    expect(f.writes()[0]!.status).toBe(201);
    await until(() => !f.client.state.loading);
    const effects = f.bucket.effects;
    f.upload("upload.txt", "replacement");
    await until(() => f.writes().length === 2);
    expect(f.writes()[1]!.status).toBe(412);
    expect(f.bucket.effects).toBe(effects);
    expect(await (await f.send("/api/drive/file/upload.txt")).text()).toBe(
      "first",
    );
  });

  test("list ETags survive ordinary, recent and search item projections", async () => {
    const f = await fixture();
    await f.create("note.txt");
    await f.refresh();
    const response = await f.send("/api/drive/file/note.txt", {
      method: "HEAD",
    });
    for (const mode of ["ordinary", "recent", "search"]) {
      f.client.state.nav = mode === "recent" ? "recent" : "files";
      f.client.state.query = mode === "search" ? "note" : "";
      expect(f.item("note.txt").etag).toBe(response.headers.get("etag")!);
    }
  });

  test("rename uses the listed revision and refuses a stale source with zero effect", async () => {
    const f = await fixture();
    await f.create("note.txt");
    await f.refresh();
    const selected = f.item("note.txt");
    const old = await f.send("/api/drive/file/note.txt", { method: "HEAD" });
    await f.send("/api/drive/file/note.txt", {
      method: "PUT",
      headers: { "if-match": old.headers.get("etag")! },
      body: "newer",
    });
    const before = f.writes().length,
      effects = f.bucket.effects;
    f.rename(selected, "renamed.txt");
    await until(() => f.writes().length > before);
    expect(f.writes().at(-1)!.status).toBe(412);
    expect(f.bucket.effects).toBe(effects);
    expect(await (await f.send("/api/drive/file/note.txt")).text()).toBe(
      "newer",
    );
    expect((await f.send("/api/drive/file/renamed.txt")).status).toBe(404);
    await until(() => !f.client.state.loading);
    expect(f.writes().length).toBe(before + 1); // no automatic mutation retry
    f.rename(f.item("note.txt"), "renamed.txt");
    await until(() => f.writes().length > before + 1);
    expect(f.writes().at(-1)!.status).toBe(200);
    expect(await (await f.send("/api/drive/file/renamed.txt")).text()).toBe(
      "newer",
    );
  });

  test("rename never overwrites an occupied destination", async () => {
    const f = await fixture();
    await f.create("source.txt", "source");
    await f.create("taken.txt", "destination");
    await f.refresh();
    const before = f.writes().length,
      effects = f.bucket.effects;
    f.rename(f.item("source.txt"), "taken.txt");
    await until(() => f.writes().length > before);
    expect(f.writes().at(-1)!.status).toBe(409);
    expect(f.bucket.effects).toBe(effects);
    expect(await (await f.send("/api/drive/file/source.txt")).text()).toBe(
      "source",
    );
    expect(await (await f.send("/api/drive/file/taken.txt")).text()).toBe(
      "destination",
    );
  });

  test("delete keeps the selected ETag, refuses conflicts, and permits manual recovery", async () => {
    const f = await fixture();
    await f.create("delete.txt");
    await f.refresh();
    const selected = f.item("delete.txt"),
      current = await f.send("/api/drive/file/delete.txt", { method: "HEAD" });
    await f.send("/api/drive/file/delete.txt", {
      method: "PUT",
      headers: { "if-match": current.headers.get("etag")! },
      body: "newer",
    });
    const before = f.writes().length,
      effects = f.bucket.effects;
    f.remove(selected);
    await until(() => f.writes().length > before);
    expect(f.writes().at(-1)!.status).toBe(412);
    expect(f.bucket.effects).toBe(effects);
    await until(() => !f.client.state.loading);
    f.remove(f.item("delete.txt"));
    await until(() => f.writes().length > before + 1);
    expect(f.writes().at(-1)!.status).toBe(200);
    expect((await f.send("/api/drive/file/delete.txt")).status).toBe(404);
  });

  test("missing list revisions never turn rename or deletion into an unconditional write", async () => {
    const f = await fixture();
    await f.create("unversioned.txt");
    await f.refresh();
    const listed = f.item("unversioned.txt");
    delete listed.etag;
    const before = f.writes().length,
      effects = f.bucket.effects;
    f.rename(listed, "other.txt");
    f.remove(listed);
    await Bun.sleep(20);
    expect(f.writes().length).toBe(before);
    expect(f.bucket.effects).toBe(effects);
    expect(f.node("toast").textContent).toContain("revision");
  });

  test("unsupported whole-folder actions fail before any partial copy or deletion", async () => {
    const f = await fixture();
    await f.create("folder/", "");
    await f.create("folder/child.txt", "child");
    await f.refresh();
    const folder = f.item("folder"),
      before = f.writes().length,
      effects = f.bucket.effects;
    f.rename(folder, "other");
    f.remove(folder);
    await Bun.sleep(20);
    expect(f.writes().length).toBe(before);
    expect(f.bucket.effects).toBe(effects);
    expect(f.node("toast").textContent).toContain("whole folder");
    expect(
      await (await f.send("/api/drive/file/folder%2Fchild.txt")).text(),
    ).toBe("child");
  });
});

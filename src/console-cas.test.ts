import { afterEach, describe, expect, test } from "bun:test";
import { createContext, runInContext } from "node:vm";
import { storageConsoleHtml } from "./console.ts";
import worker from "./worker.ts";
import type {
  Env,
  R2Bucket,
  R2Object,
  R2PutOptions,
  R2ListOptions,
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
  pageSize = 1000;
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
  async list(options?: R2ListOptions) {
    const all = [...this.objects.keys()]
      .filter(
        (key) =>
          key.startsWith(options?.prefix ?? "") &&
          (!options?.cursor || key > options.cursor),
      )
      .sort();
    const keys = all.slice(0, Math.min(this.pageSize, options?.limit ?? 1000));
    const objects = await Promise.all(keys.map((key) => this.get(key)));
    return {
      objects: objects.filter((x): x is R2Object => x !== null),
      truncated: all.length > keys.length,
      ...(all.length > keys.length ? { cursor: keys.at(-1) } : {}),
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
  title = "";
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
  state: {
    files: { path: string; etag?: string }[];
    query: string;
    nav: string;
    loading: boolean;
    truncated: boolean;
  };
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

async function fixture(
  options: {
    loseFolderAck?: boolean;
    loseCleanupAck?: boolean;
    pageResponse?: (response: Response) => Promise<Response>;
    cleanupReviewResponse?: (response: Response) => Promise<Response>;
  } = {},
) {
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
    fetch: async (path: string, init?: RequestInit) => {
      const response = await send(path, init);
      if (options.loseFolderAck && path === "/api/drive/folder") {
        await response.body?.cancel();
        throw new Error("synthetic loss after the real Worker completed");
      }
      if (options.loseCleanupAck && path === "/api/drive/cleanup") {
        await response.body?.cancel();
        throw new Error("synthetic cleanup acknowledgement loss after commit");
      }
      if (options.pageResponse && path.startsWith("/api/drive/list?cursor="))
        return options.pageResponse(response);
      if (
        options.cleanupReviewResponse &&
        path.startsWith("/api/drive/cleanup?")
      )
        return options.cleanupReviewResponse(response);
      return response;
    },
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
    actions,
    send,
    requests,
    writes,
    client,
    node,
    location: context.location as { href: string },
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

  test("confirmed whole-folder rename and deletion use one reviewed server operation each", async () => {
    const f = await fixture();
    await f.create("folder/", "");
    await f.create("folder/child.txt", "child");
    await f.refresh();
    f.rename(f.item("folder"), "other");
    await until(() => f.writes().some((x) => x.path === "/api/drive/folder"));
    await until(
      () =>
        !f.client.state.loading &&
        f.client.items().some((x) => x.name === "other"),
    );
    expect(
      await (await f.send("/api/drive/file/other%2Fchild.txt")).text(),
    ).toBe("child");
    f.remove(f.item("other"));
    await until(
      () =>
        f.writes().filter((x) => x.path === "/api/drive/folder").length === 2,
    );
    await until(
      () =>
        !f.client.state.loading &&
        !f.client.items().some((x) => x.name === "other"),
    );
    expect(
      f
        .writes()
        .filter((x) => x.path === "/api/drive/folder")
        .map((x) => x.status),
    ).toEqual([200, 200]);
  });

  test("folder confirmation retains its observed revisions despite an intervening list refresh", async () => {
    const f = await fixture();
    await f.create("folder/");
    await f.create("folder/child", "one");
    await f.refresh();
    f.client.select(f.item("folder"));
    f.actions.get("rename")!.click();
    const old = f.bucket.objects.get("drive/folder/child")!.etag;
    expect(f.node("name-dialog-note").textContent).toContain("2 reviewed");
    await f.send("/api/drive/file/folder%2Fchild", {
      method: "PUT",
      headers: { "if-match": old },
      body: "other writer",
    });
    await f.refresh();
    const effects = f.bucket.effects;
    f.node("name-input").value = "other";
    f.node("name-form").dispatch("submit");
    await until(() => f.writes().some((x) => x.path === "/api/drive/folder"));
    expect(
      f
        .writes()
        .filter((x) => x.path === "/api/drive/folder")
        .map((x) => x.status),
    ).toEqual([412]);
    expect(f.bucket.effects).toBe(effects);
    expect(await (await f.send("/api/drive/file/folder%2Fchild")).text()).toBe(
      "other writer",
    );
  });

  test("cancel, incomplete listings, and missing child revisions never submit a folder mutation", async () => {
    const f = await fixture();
    await f.create("folder/");
    await f.create("folder/child", "one");
    await f.refresh();
    f.client.select(f.item("folder"));
    f.actions.get("delete")!.click();
    expect(f.node("delete-dialog").open).toBe(true);
    expect(f.node("delete-body").textContent).toContain("2 reviewed");
    f.node("delete-dialog").close();
    await Bun.sleep(10);
    expect(
      f.writes().filter((x) => x.path === "/api/drive/folder"),
    ).toHaveLength(0);
    f.client.state.truncated = true;
    f.rename(f.item("folder"), "blocked");
    await Bun.sleep(10);
    expect(
      f.writes().filter((x) => x.path === "/api/drive/folder"),
    ).toHaveLength(0);
    f.client.state.truncated = false;
    delete f.client.state.files.find((x) => x.path === "folder/child")!.etag;
    f.rename(f.item("folder"), "blocked");
    await Bun.sleep(10);
    expect(
      f.writes().filter((x) => x.path === "/api/drive/folder"),
    ).toHaveLength(0);
  });

  test("partial cleanup shows persistent manual reconciliation and keeps the copied data", async () => {
    const f = await fixture();
    await f.create("folder/");
    await f.create("folder/child", "only copy");
    await f.refresh();
    f.bucket.delete = async () => {
      throw new Error("synthetic cleanup failure");
    };
    f.rename(f.item("folder"), "other");
    await until(() => f.node("folder-result-dialog").open);
    expect(f.node("folder-result-message").textContent).toContain(
      "stopped before completion",
    );
    expect(f.node("folder-result-paths").textContent).toContain("folder/child");
    expect(await (await f.send("/api/drive/file/other%2Fchild")).text()).toBe(
      "only copy",
    );
    expect(
      f.writes().filter((x) => x.path === "/api/drive/folder"),
    ).toHaveLength(1);
    expect(f.node("toast").textContent).not.toContain("completed");
  });

  test("unknown acknowledgement is not retried or reported as saved after the Worker committed", async () => {
    const f = await fixture({ loseFolderAck: true });
    await f.create("folder/");
    await f.create("folder/child", "retained");
    await f.refresh();
    f.rename(f.item("folder"), "other");
    await until(() => f.node("folder-result-dialog").open);
    await until(() => !f.client.state.loading);
    expect(f.node("folder-result-message").textContent).toContain(
      "could not be confirmed",
    );
    expect(
      f
        .writes()
        .filter((x) => x.path === "/api/drive/folder")
        .map((x) => x.status),
    ).toEqual([200]);
    expect(await (await f.send("/api/drive/file/other%2Fchild")).text()).toBe(
      "retained",
    );
    expect(f.node("toast").textContent).not.toContain("completed");
  });

  test("an interrupted folder deletion appears after refresh and requires explicit cleanup confirmation", async () => {
    const f = await fixture();
    await f.create("folder/");
    await f.create("folder/child", "only copy");
    await f.refresh();
    const remove = f.bucket.delete.bind(f.bucket);
    f.bucket.delete = async () => {
      throw new Error("synthetic cleanup failure");
    };
    f.rename(f.item("folder"), "retained");
    await until(() => f.node("folder-result-dialog").open);
    f.node("folder-result-dialog").close();
    f.bucket.delete = remove;
    await f.refresh();
    expect(f.node("pending-list").children).toHaveLength(1);
    f.node("pending-list").children[0]!.children[1]!.click();
    expect(f.node("cleanup-dialog").open).toBe(true);
    expect(
      f.writes().filter((x) => x.path === "/api/drive/cleanup"),
    ).toHaveLength(0);
    f.node("cleanup-dialog").close();
    f.node("cleanup-confirm").click();
    expect(
      f.writes().filter((x) => x.path === "/api/drive/cleanup"),
    ).toHaveLength(0);
    f.node("pending-list").children[0]!.children[1]!.click();
    await until(() => !f.node("cleanup-confirm").disabled);
    f.node("cleanup-confirm").click();
    await until(() => f.writes().some((x) => x.path === "/api/drive/cleanup"));
    await until(
      () =>
        !f.client.state.loading && f.node("pending-list").children.length === 0,
    );
    expect(
      f
        .writes()
        .filter((x) => x.path === "/api/drive/cleanup")
        .map((x) => x.status),
    ).toEqual([200]);
    expect(
      await (await f.send("/api/drive/file/retained%2Fchild")).text(),
    ).toBe("only copy");
    expect((await f.create("folder/child", "reused path")).status).toBe(201);
  });
});

async function interruptedDeletion(
  options: Parameters<typeof fixture>[0] = {},
) {
  const f = await fixture(options);
  await f.create("pending/child", "retained content");
  const source = (await (await f.send("/api/drive/list")).json()) as {
    files: { path: string; etag: string }[];
  };
  const remove = f.bucket.delete.bind(f.bucket);
  f.bucket.delete = async () => {
    throw new Error("synthetic physical cleanup failure");
  };
  const moved = await f.send("/api/drive/folder", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operation: "rename",
      source_path: "pending/",
      destination_path: "retained/",
      entries: source.files,
    }),
  });
  expect(moved.status).toBe(409);
  f.bucket.delete = remove;
  await f.refresh();
  return f;
}

describe("Console interrupted-deletion recovery", () => {
  test("a cancelled inspection cannot redirect or overwrite the next verified confirmation", async () => {
    let release!: () => void,
      started = false,
      once = true;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const f = await interruptedDeletion({
      cleanupReviewResponse: async (response) => {
        if (once) {
          once = false;
          started = true;
          await gate;
          await response.body?.cancel();
          return new Response("", { status: 401 });
        }
        return response;
      },
    });
    f.node("pending-list").children[0]!.children[1]!.click();
    await until(() => started);
    f.node("cleanup-dialog").close();
    f.node("pending-list").children[0]!.children[1]!.click();
    await until(() => !f.node("cleanup-confirm").disabled);
    release();
    await Bun.sleep(15);
    expect(f.location.href).toBe("");
    expect(f.node("cleanup-body").textContent).toContain("pending/child");
    expect(f.node("cleanup-confirm").disabled).toBe(false);
    f.node("cleanup-confirm").click();
    await until(() => f.writes().some((x) => x.path === "/api/drive/cleanup"));
    expect(
      f
        .writes()
        .filter((x) => x.path === "/api/drive/cleanup")
        .map((x) => x.status),
    ).toEqual([200]);
  });

  test("unknown 36-byte marker format is checked before cleanup confirmation can be enabled", async () => {
    const f = await fixture();
    await f.bucket.put("drive/unknown", "x".repeat(36), {
      customMetadata: { "takos-storage-deleting": "1" },
    });
    await f.refresh();
    f.node("pending-list").children[0]!.children[1]!.click();
    expect(f.node("cleanup-confirm").disabled).toBe(true);
    await until(() =>
      f.node("cleanup-body").textContent.includes("operator review"),
    );
    expect(f.node("cleanup-confirm").disabled).toBe(true);
    f.node("cleanup-confirm").click();
    expect(
      f.writes().filter((x) => x.path === "/api/drive/cleanup"),
    ).toHaveLength(0);
  });

  test("a pending item on a later R2 page is explicitly loaded and can be cleaned up", async () => {
    const f = await interruptedDeletion();
    await f.create("aaa.txt", "first page");
    f.bucket.pageSize = 1;
    await f.refresh();
    expect(f.node("pending-list").children).toHaveLength(0);
    expect(f.node("load-more").hidden).toBe(false);
    f.node("load-more").click();
    await until(
      () =>
        !f.client.state.loading && f.node("pending-list").children.length === 1,
    );
    expect(f.client.state.files.map((file) => file.path)).toEqual(["aaa.txt"]);
    f.node("pending-list").children[0]!.children[1]!.click();
    await until(() => !f.node("cleanup-confirm").disabled);
    f.node("cleanup-confirm").click();
    await until(() => f.writes().some((x) => x.path === "/api/drive/cleanup"));
    expect(
      f
        .writes()
        .filter((x) => x.path === "/api/drive/cleanup")
        .map((x) => x.status),
    ).toEqual([200]);
    expect(
      await (await f.send("/api/drive/file/retained%2Fchild")).text(),
    ).toBe("retained content");
  });

  test("a retired page read cannot append stale pending rows after a fresh list", async () => {
    let release!: () => void,
      started = false,
      once = true;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const f = await interruptedDeletion({
      pageResponse: async (response) => {
        if (once) {
          once = false;
          started = true;
          await gate;
        }
        return response;
      },
    });
    await f.create("aaa.txt", "first page");
    f.bucket.pageSize = 1;
    await f.refresh();
    f.node("load-more").click();
    await until(() => started);
    await f.refresh();
    release();
    await Bun.sleep(15);
    expect(f.node("pending-list").children).toHaveLength(0);
    expect(f.client.state.files.map((file) => file.path)).toEqual(["aaa.txt"]);
    expect(f.client.state.loading).toBe(false);
    f.node("load-more").click();
    await until(
      () =>
        !f.client.state.loading && f.node("pending-list").children.length === 1,
    );
  });

  test("cleanup confirmation keeps its old revision when another attempt advances the marker", async () => {
    const f = await interruptedDeletion();
    f.node("pending-list").children[0]!.children[1]!.click();
    await until(() => !f.node("cleanup-confirm").disabled);
    await f.bucket.put("drive/pending/child", crypto.randomUUID(), {
      customMetadata: { "takos-storage-deleting": "1" },
    });
    await f.refresh();
    const effects = f.bucket.effects;
    await until(() => !f.node("cleanup-confirm").disabled);
    f.node("cleanup-confirm").click();
    await until(() => f.writes().some((x) => x.path === "/api/drive/cleanup"));
    expect(
      f
        .writes()
        .filter((x) => x.path === "/api/drive/cleanup")
        .map((x) => x.status),
    ).toEqual([412]);
    expect(f.bucket.effects).toBe(effects);
  });

  test("unknown cleanup ACK refreshes inventory without automatic replay or success", async () => {
    const f = await interruptedDeletion({ loseCleanupAck: true });
    f.node("pending-list").children[0]!.children[1]!.click();
    await until(() => !f.node("cleanup-confirm").disabled);
    f.node("cleanup-confirm").click();
    await until(() => f.node("folder-result-dialog").open);
    await until(
      () =>
        !f.client.state.loading && f.node("pending-list").children.length === 0,
    );
    expect(f.node("folder-result-title").textContent).toContain(
      "deletion cleanup",
    );
    expect(f.node("folder-result-message").textContent).toContain(
      "could not be confirmed",
    );
    expect(
      f
        .writes()
        .filter((x) => x.path === "/api/drive/cleanup")
        .map((x) => x.status),
    ).toEqual([200]);
    expect(f.node("toast").textContent).not.toContain("cleanup finished");
    expect((await f.create("pending/child", "new")).status).toBe(201);
  });

  test("another cleanup failure requires a fresh inventory and a separate manual confirmation", async () => {
    const f = await interruptedDeletion(),
      remove = f.bucket.delete.bind(f.bucket);
    f.bucket.delete = async () => {
      throw new Error("synthetic second cleanup failure");
    };
    f.node("pending-list").children[0]!.children[1]!.click();
    await until(() => !f.node("cleanup-confirm").disabled);
    f.node("cleanup-confirm").click();
    await until(() => f.node("folder-result-dialog").open);
    await until(() => !f.client.state.loading);
    expect(
      f
        .writes()
        .filter((x) => x.path === "/api/drive/cleanup")
        .map((x) => x.status),
    ).toEqual([503]);
    f.node("folder-result-dialog").close();
    f.bucket.delete = remove;
    f.node("pending-list").children[0]!.children[1]!.click();
    await until(() => !f.node("cleanup-confirm").disabled);
    f.node("cleanup-confirm").click();
    await until(
      () =>
        f.writes().filter((x) => x.path === "/api/drive/cleanup").length === 2,
    );
    expect(
      f
        .writes()
        .filter((x) => x.path === "/api/drive/cleanup")
        .map((x) => x.status),
    ).toEqual([503, 200]);
    expect(
      await (await f.send("/api/drive/file/retained%2Fchild")).text(),
    ).toBe("retained content");
  });

  test("legacy empty markers stay visible but cannot invoke self-service cleanup", async () => {
    const f = await fixture();
    await f.bucket.put("drive/legacy", "", {
      customMetadata: { "takos-storage-deleting": "1" },
    });
    await f.refresh();
    const button = f.node("pending-list").children[0]!.children[1]!;
    expect(button.disabled).toBe(true);
    expect(button.title).toContain("operator review");
    const effects = f.bucket.effects;
    button.click();
    await Bun.sleep(10);
    expect(
      f.writes().filter((x) => x.path === "/api/drive/cleanup"),
    ).toHaveLength(0);
    expect(f.bucket.effects).toBe(effects);
  });
});

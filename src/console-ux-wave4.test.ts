import { afterEach, describe, expect, test } from "bun:test";
import { createContext, runInContext } from "node:vm";
import { storageConsoleHtml } from "./console.ts";
import worker from "./worker.ts";
import type {
  Env,
  R2Bucket,
  R2ListOptions,
  R2Object,
  R2ObjectBody,
  R2PutOptions,
} from "./types.ts";

class MemoryBucket implements R2Bucket {
  objects = new Map<
    string,
    { bytes: Uint8Array; etag: string; type: string; uploaded: Date }
  >();
  seq = 0;

  async head(key: string): Promise<R2Object | null> {
    const item = this.objects.get(key);
    if (!item) return null;
    return {
      key,
      size: item.bytes.length,
      uploaded: item.uploaded,
      httpEtag: item.etag,
      httpMetadata: { contentType: item.type },
    };
  }

  async get(key: string): Promise<R2ObjectBody | null> {
    const item = this.objects.get(key);
    if (!item) return null;
    const bytes = item.bytes.slice();
    return {
      key,
      size: bytes.length,
      uploaded: item.uploaded,
      httpEtag: item.etag,
      httpMetadata: { contentType: item.type },
      body: new Response(bytes).body!,
      arrayBuffer: async () => bytes.buffer,
    };
  }

  async put(
    key: string,
    body: ArrayBuffer | ReadableStream | string | Uint8Array,
    options?: R2PutOptions & { uploaded?: Date },
  ): Promise<R2Object | null> {
    const old = this.objects.get(key);
    const cond = options?.onlyIf;
    const absent =
      cond instanceof Headers
        ? cond.get("if-none-match")
        : cond?.etagDoesNotMatch;
    const match =
      cond instanceof Headers ? cond.get("if-match") : cond?.etagMatches;
    if (absent === "*" && old) return null;
    if (match != null && old?.etag !== match) return null;
    const bytes =
      body instanceof Uint8Array
        ? body.slice()
        : new Uint8Array(await new Response(body).arrayBuffer());
    this.objects.set(key, {
      bytes,
      etag: `"etag-${++this.seq}"`,
      type: options?.httpMetadata?.contentType ?? "application/octet-stream",
      uploaded: options?.uploaded ?? new Date(this.seq * 1000),
    });
    return this.head(key);
  }

  async delete(key: string) {
    this.objects.delete(key);
  }

  async list(options?: R2ListOptions) {
    const all = [...this.objects.keys()]
      .filter(
        (key) =>
          key.startsWith(options?.prefix ?? "") &&
          (!options?.cursor || key > options.cursor),
      )
      .sort();
    const keys = all.slice(0, options?.limit ?? 1000);
    const objects = await Promise.all(keys.map((key) => this.head(key)));
    return {
      objects: objects.filter((x): x is R2Object => x !== null),
      truncated: all.length > keys.length,
      ...(all.length > keys.length ? { cursor: keys.at(-1) } : {}),
    };
  }
}

type Listener = (event: Record<string, unknown>) => void;

class FakeEl {
  value = "";
  src = "";
  alt = "";
  private text = "";
  title = "";
  private html = "";
  hidden = false;
  disabled = false;
  open = false;
  inert = false;
  draggable = false;
  tabIndex = -1;
  isConnected = true;
  scrollLeft = 0;
  scrollWidth = 0;
  tagName = "DIV";
  files: File[] = [];
  dataset: Record<string, string> = {};
  style: Record<string, unknown> = { setProperty() {} };
  listeners = new Map<string, Listener[]>();
  attributes = new Map<string, string>();
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  classes = new Set<string>();
  classList = {
    add: (s: string) => this.classes.add(s),
    remove: (s: string) => this.classes.delete(s),
    contains: (s: string) => this.classes.has(s),
  };

  constructor(
    readonly doc: FakeDoc,
    tag = "DIV",
  ) {
    this.tagName = tag.toUpperCase();
  }

  get className(): string {
    return [...this.classes].join(" ");
  }

  set className(val: string) {
    this.classes = new Set(String(val).split(/\s+/u).filter(Boolean));
  }

  get textContent(): string {
    return this.text;
  }

  set textContent(val: string) {
    this.text = String(val);
    this.html = this.text
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  get innerHTML(): string {
    return this.html;
  }

  set innerHTML(val: string) {
    for (const c of this.children) c.markDisconnected();
    this.html = val;
    this.children = [];
    const rowLinkMatch = /class="row-link" data-open="(\d+)"/u.exec(val);
    if (rowLinkMatch) {
      const btn = new FakeEl(this.doc, "BUTTON");
      btn.className = "row-link";
      btn.setAttribute("data-open", rowLinkMatch[1]!);
      this.appendChild(btn);
    }
    const selectMatch =
      /class="select-check([^"]*)" data-select="(\d+)" aria-checked="(true|false)"/u.exec(
        val,
      );
    if (selectMatch) {
      const chk = new FakeEl(this.doc, "BUTTON");
      chk.className = `select-check${selectMatch[1]}`;
      chk.setAttribute("role", "checkbox");
      chk.setAttribute("data-select", selectMatch[2]!);
      chk.setAttribute("aria-checked", selectMatch[3]!);
      this.appendChild(chk);
    }
    if (val.includes('class="card-thumb"')) {
      const thumb = new FakeEl(this.doc, "DIV");
      thumb.className = "card-thumb";
      this.appendChild(thumb);
    }
  }

  markDisconnected() {
    this.isConnected = false;
    for (const c of this.children) c.markDisconnected();
  }

  addEventListener(type: string, fn: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }

  dispatch(type: string, extra: Record<string, unknown> = {}): boolean {
    let prevented = false;
    for (const fn of this.listeners.get(type) ?? []) {
      fn({
        target: this,
        currentTarget: this,
        preventDefault() {
          prevented = true;
        },
        stopPropagation() {},
        ...extra,
      });
    }
    return prevented;
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }

  appendChild(node: FakeEl) {
    node.parent = this;
    node.isConnected = true;
    this.children.push(node);
    return node;
  }

  append(...nodes: FakeEl[]) {
    for (const n of nodes) this.appendChild(n);
  }

  replaceChildren(...nodes: FakeEl[]) {
    for (const c of this.children) c.markDisconnected();
    this.children = [];
    this.append(...nodes);
  }

  remove() {
    if (this.parent) {
      this.parent.children = this.parent.children.filter((c) => c !== this);
      this.parent = null;
    }
    this.markDisconnected();
  }

  all(): FakeEl[] {
    return [this, ...this.children.flatMap((c) => c.all())];
  }

  querySelector(selector: string): FakeEl | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): FakeEl[] {
    const descendants = this.all().filter((el) => el !== this);
    if (selector === ".row-link") {
      return descendants.filter((el) => el.classes.has("row-link"));
    }
    if (selector === ".select-check[data-select]") {
      return descendants.filter(
        (el) =>
          el.classes.has("select-check") &&
          el.getAttribute("data-select") !== null,
      );
    }
    if (selector === ".card-thumb") {
      return descendants.filter((el) => el.classes.has("card-thumb"));
    }
    if (selector === ".card-thumb-img") {
      return descendants.filter((el) => el.classes.has("card-thumb-img"));
    }
    if (selector === ".is-dragging") {
      return descendants.filter((el) => el.classes.has("is-dragging"));
    }
    const dataAction = /^\[data-action="([^"]+)"\]$/u.exec(selector);
    if (dataAction) {
      return descendants.filter(
        (el) => el.getAttribute("data-action") === dataAction[1],
      );
    }
    if (selector === "[data-action]") {
      return descendants.filter(
        (el) => el.getAttribute("data-action") !== null,
      );
    }
    return descendants;
  }

  matchesSelector(selector: string): boolean {
    for (const part of selector.split(",").map((s) => s.trim())) {
      if (part === ".row" && this.classes.has("row")) return true;
      if (part === ".card" && this.classes.has("card")) return true;
      if (part === ".kebab" && this.classes.has("kebab")) return true;
      if (
        part === ".select-check[data-select]" &&
        this.classes.has("select-check") &&
        this.getAttribute("data-select") !== null
      )
        return true;
      if (part === "[data-open]" && this.getAttribute("data-open") !== null)
        return true;
      if (
        part === "[data-item-idx]" &&
        this.getAttribute("data-item-idx") !== null
      )
        return true;
      if (
        part === "[data-folder-path]" &&
        this.getAttribute("data-folder-path") !== null
      )
        return true;
      if (part === "[hidden]" && this.hidden) return true;
    }
    return false;
  }

  closest(selector: string): FakeEl | null {
    if (this.matchesSelector(selector)) return this;
    let cur = this.parent;
    while (cur) {
      if (cur.matchesSelector(selector)) return cur;
      cur = cur.parent;
    }
    return null;
  }

  contains(other: unknown) {
    return other === this || this.all().includes(other as FakeEl);
  }

  focus() {
    this.doc.activeElement = this;
  }

  scrollIntoView() {}
  select() {}
  click() {
    this.dispatch("click");
  }
  showModal() {
    this.open = true;
  }
  close() {
    if (!this.open) return;
    this.open = false;
    this.dispatch("close");
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, bottom: 0 };
  }
}

class FakeDoc {
  nodes = new Map<string, FakeEl>();
  body: FakeEl;
  title = "Takos Storage";
  activeElement: FakeEl | null = null;
  docListeners = new Map<string, Array<{ fn: Listener; capture: boolean }>>();
  documentElement = { lang: "en", dataset: { theme: "light" } };
  sortButtons: FakeEl[] = [];
  navButtons: FakeEl[] = [];
  viewButtons: FakeEl[] = [];

  constructor() {
    this.body = new FakeEl(this, "BODY");
    this.getElementById("app").hidden = true;
    this.getElementById("fab").hidden = true;
    for (const key of ["name", "size", "uploaded"]) {
      const btn = new FakeEl(this, "BUTTON");
      btn.setAttribute("data-sort", key);
      btn.classes.add("sortable");
      this.sortButtons.push(btn);
    }
    for (const nav of ["files", "recent"]) {
      const btn = new FakeEl(this, "BUTTON");
      btn.setAttribute("data-nav", nav);
      this.navButtons.push(btn);
    }
    for (const view of ["list", "grid"]) {
      const btn = new FakeEl(this, "BUTTON");
      btn.setAttribute("data-view", view);
      this.viewButtons.push(btn);
    }
    const itemMenu = this.getElementById("item-menu");
    for (const action of ["open", "download", "rename", "move", "delete"]) {
      const item = new FakeEl(this, "BUTTON");
      item.setAttribute("role", "menuitem");
      item.setAttribute("data-action", action);
      item.classes.add("menu-item");
      itemMenu.appendChild(item);
    }
  }

  getElementById = (id: string): FakeEl => {
    if (!this.nodes.has(id)) {
      const tag =
        id === "q" ||
        id === "name-input" ||
        id === "move-custom-input" ||
        id === "file-input"
          ? "INPUT"
          : id === "move-folder"
            ? "SELECT"
            : id === "brand-link"
              ? "A"
              : id === "select-all" ||
                  id === "bulk-move" ||
                  id === "bulk-delete" ||
                  id === "bulk-clear" ||
                  id === "shortcuts-btn" ||
                  id === "lang-toggle"
                ? "BUTTON"
                : "DIV";
      this.nodes.set(id, new FakeEl(this, tag));
    }
    return this.nodes.get(id)!;
  };

  querySelector = (selector: string): FakeEl | null => {
    if (selector === "dialog[open]") {
      for (const el of this.nodes.values()) {
        if (el.open) return el;
      }
    }
    return null;
  };

  querySelectorAll = (selector: string): FakeEl[] => {
    if (selector === "[data-sort]") return this.sortButtons;
    if (selector === "[data-nav]") return this.navButtons;
    if (selector === "[data-view]") return this.viewButtons;
    return [];
  };

  addEventListener = (type: string, fn: Listener, capture = false) => {
    this.docListeners.set(type, [
      ...(this.docListeners.get(type) ?? []),
      { fn, capture: Boolean(capture) },
    ]);
  };

  dispatchDoc = (type: string, extra: Record<string, unknown> = {}) => {
    let prevented = false;
    let stopped = false;
    const all = this.docListeners.get(type) ?? [];
    const ordered = [
      ...all.filter((entry) => entry.capture),
      ...all.filter((entry) => !entry.capture),
    ];
    for (const entry of ordered) {
      if (stopped) break;
      entry.fn({
        preventDefault() {
          prevented = true;
        },
        stopPropagation() {
          stopped = true;
        },
        ...extra,
      });
    }
    return prevented;
  };

  createElement = (tag: string) => new FakeEl(this, tag);
  createDocumentFragment = () => new FakeEl(this, "FRAGMENT");
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

async function until(check: () => boolean) {
  const deadline = Date.now() + 2500;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("console did not settle");
    await Bun.sleep(5);
  }
}

async function mount(
  opts: {
    initialSearch?: string;
    initialView?: "list" | "grid";
    extraImages?: number;
    includeHugeImage?: boolean;
    holdImageFetches?: boolean;
  } = {},
) {
  const bucket = new MemoryBucket();
  await bucket.put("drive/Documents/", "", {
    httpMetadata: { contentType: "application/x-directory" },
    uploaded: new Date(10_000),
  });
  await bucket.put("drive/Documents/Archive/", "", {
    httpMetadata: { contentType: "application/x-directory" },
    uploaded: new Date(15_000),
  });
  await bucket.put("drive/Documents/Archive/deep.txt", "deep body", {
    httpMetadata: { contentType: "text/plain" },
    uploaded: new Date(20_000),
  });
  await bucket.put("drive/Documents/dup.txt", "doc dup", {
    httpMetadata: { contentType: "text/plain" },
    uploaded: new Date(25_000),
  });
  await bucket.put("drive/Photos/", "", {
    httpMetadata: { contentType: "application/x-directory" },
    uploaded: new Date(30_000),
  });
  await bucket.put("drive/Photos/dup.txt", "photo dup", {
    httpMetadata: { contentType: "text/plain" },
    uploaded: new Date(35_000),
  });
  await bucket.put("drive/alpha.txt", "alpha body", {
    httpMetadata: { contentType: "text/plain" },
    uploaded: new Date(40_000),
  });
  await bucket.put("drive/beta.txt", "beta body", {
    httpMetadata: { contentType: "text/plain" },
    uploaded: new Date(45_000),
  });
  await bucket.put("drive/logo.svg", "<svg/>", {
    httpMetadata: { contentType: "image/svg+xml" },
    uploaded: new Date(50_000),
  });
  await bucket.put("drive/pic.png", "pngbytes", {
    httpMetadata: { contentType: "image/png" },
    uploaded: new Date(55_000),
  });
  if (opts.extraImages) {
    for (let i = 1; i <= opts.extraImages; i++) {
      await bucket.put(`drive/img-${i}.png`, `img-${i}`, {
        httpMetadata: { contentType: "image/png" },
        uploaded: new Date(60_000 + i * 1000),
      });
    }
  }
  if (opts.includeHugeImage) {
    await bucket.put("drive/huge.png", new Uint8Array(4 * 1024 * 1024 + 64), {
      httpMetadata: { contentType: "image/png" },
      uploaded: new Date(90_000),
    });
  }

  const env: Env = { BUCKET: bucket, ALLOW_UNAUTHENTICATED_DRIVE: "1" };
  const doc = new FakeDoc();
  const storage = new Map<string, string>();
  if (opts.initialView) storage.set("takos-storage-view", opts.initialView);

  const locationObj = {
    pathname: "/",
    search: opts.initialSearch ?? "",
    href: "",
    reload() {},
  };
  const historyStack: string[] = [locationObj.pathname + locationObj.search];
  let historyIdx = 0;
  const winListeners = new Map<string, Listener[]>();

  const historyObj = {
    pushState(_state: unknown, _title: string, url: string) {
      const parsed = new URL(url, "http://storage.local");
      locationObj.pathname = parsed.pathname;
      locationObj.search = parsed.search;
      historyStack.splice(historyIdx + 1);
      historyStack.push(parsed.pathname + parsed.search);
      historyIdx = historyStack.length - 1;
    },
    replaceState(_state: unknown, _title: string, url: string) {
      const parsed = new URL(url, "http://storage.local");
      locationObj.pathname = parsed.pathname;
      locationObj.search = parsed.search;
      historyStack[historyIdx] = parsed.pathname + parsed.search;
    },
  };

  function navigateHistory(delta: number) {
    const next = historyIdx + delta;
    if (next < 0 || next >= historyStack.length) return;
    historyIdx = next;
    const parsed = new URL(historyStack[historyIdx]!, "http://storage.local");
    locationObj.pathname = parsed.pathname;
    locationObj.search = parsed.search;
    for (const fn of winListeners.get("popstate") ?? []) fn({});
  }

  const createdUrls: string[] = [];
  const revokedUrls: string[] = [];
  class TrackedURL extends URL {
    static createObjectURL() {
      const u = `blob:w4-${createdUrls.length + 1}`;
      createdUrls.push(u);
      return u;
    }
    static revokeObjectURL(u: string) {
      revokedUrls.push(u);
    }
  }

  type ObserverInstance = {
    cb: (entries: Array<{ target: FakeEl; isIntersecting: boolean }>) => void;
    observed: FakeEl[];
    disconnected: boolean;
  };
  const observers: ObserverInstance[] = [];
  class FakeIntersectionObserver {
    inst: ObserverInstance;
    constructor(
      cb: (entries: Array<{ target: FakeEl; isIntersecting: boolean }>) => void,
    ) {
      this.inst = { cb, observed: [], disconnected: false };
      observers.push(this.inst);
    }
    observe(el: FakeEl) {
      this.inst.observed.push(el);
    }
    unobserve(el: FakeEl) {
      this.inst.observed = this.inst.observed.filter((x) => x !== el);
    }
    disconnect() {
      this.inst.disconnected = true;
      this.inst.observed = [];
    }
  }

  const requests: Array<{
    method: string;
    path: string;
    body?: string;
    ifMatch?: string | null;
  }> = [];
  let inFlightImages = 0;
  let maxConcurrentImages = 0;
  const imageGates: Array<() => void> = [];
  let failNetworkForPath: string | null = null;

  const script = [
    ...storageConsoleHtml().matchAll(/<script>([\s\S]*?)<\/script>/gu),
  ]
    .map((m) => m[1]!)
    .find((s) => s.includes("var state ="));
  if (!script) throw new Error("console script not found");

  const context = createContext({
    document: doc,
    navigator: { language: "en" },
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, v),
    },
    window: {
      addEventListener(type: string, fn: Listener) {
        winListeners.set(type, [...(winListeners.get(type) ?? []), fn]);
      },
      innerWidth: 1200,
      innerHeight: 800,
    },
    location: locationObj,
    history: historyObj,
    URLSearchParams,
    IntersectionObserver: FakeIntersectionObserver,
    fetch: async (path: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers);
      requests.push({
        method,
        path,
        body: typeof init?.body === "string" ? init.body : undefined,
        ifMatch: headers.get("if-match"),
      });
      if (failNetworkForPath && path.includes(failNetworkForPath)) {
        throw new TypeError("simulated network outage");
      }
      const isImgGet =
        method === "GET" &&
        path.startsWith("/api/drive/file/") &&
        path.endsWith(".png");
      if (isImgGet) {
        inFlightImages += 1;
        if (inFlightImages > maxConcurrentImages) {
          maxConcurrentImages = inFlightImages;
        }
        try {
          if (opts.holdImageFetches) {
            await new Promise<void>((resolve) => {
              imageGates.push(resolve);
            });
          }
          return await worker.fetch(
            new Request(new URL(path, "http://storage.local"), init),
            env,
          );
        } finally {
          inFlightImages -= 1;
        }
      }
      return worker.fetch(
        new Request(new URL(path, "http://storage.local"), init),
        env,
      );
    },
    URL: TrackedURL,
    Blob,
    File,
    Headers,
    Response,
    Request,
    setTimeout: (fn: () => void, ms: number) => {
      const id = setTimeout(fn, ms);
      id.unref();
      cleanups.push(() => clearTimeout(id));
      return id;
    },
    clearTimeout,
    console,
  });

  runInContext(
    script.replace(
      "\n  boot();",
      `\n  globalThis.ctrl = { state: state, items: visibleItems, render: render, load: load, openItem: openItem };\n  boot();`,
    ),
    context,
  );

  const ctrl = context.ctrl as {
    state: {
      loading: boolean;
      failed: boolean;
      nav: string;
      path: string;
      view: string;
      query: string;
      files: Array<{ path: string; etag?: string }>;
    };
    items: () => Array<{
      name: string;
      path: string;
      type: "file" | "folder";
      etag?: string;
    }>;
    render: () => void;
    load: (more?: boolean) => void;
    openItem: (item: unknown, trigger?: FakeEl) => void;
  };
  await until(() => !ctrl.state.loading);

  return {
    doc,
    ctrl,
    bucket,
    location: locationObj,
    historyStack,
    navigateHistory,
    winListeners,
    observers,
    createdUrls,
    revokedUrls,
    requests,
    getMaxConcurrentImages: () => maxConcurrentImages,
    releaseImageGates: () => {
      for (const fn of imageGates.splice(0)) fn();
    },
    getPendingImageGates: () => imageGates.length,
    setFailNetwork: (match: string | null) => {
      failNetworkForPath = match;
    },
  };
}

describe("Takos Storage Wave 4 UI/UX improvements", () => {
  test("HTML & CSS include bulk selection bar, select-all checkbox, drag-drop highlight, grid thumb styles, and keyboard shortcuts sheet", () => {
    const html = storageConsoleHtml();
    expect(html).toContain('id="bulk-bar"');
    expect(html).toContain('id="select-all"');
    expect(html).toContain('id="bulk-move"');
    expect(html).toContain('id="bulk-delete"');
    expect(html).toContain('id="bulk-clear"');
    expect(html).toContain('id="shortcuts-btn"');
    expect(html).toContain(
      '<dialog id="shortcuts-dialog" aria-labelledby="shortcuts-title">',
    );
    expect(html).toContain(".drop-target {");
    expect(html).toContain(".card-thumb-img {");
    expect(html).toContain(".select-check { width: 44px; height: 44px; }");
  });

  test("URL state restores folder, Recent, and search on load, sanitizes invalid paths, and syncs pushState/replaceState/popstate", async () => {
    const deep = await mount({ initialSearch: "?path=Documents%2FArchive%2F" });
    expect(deep.ctrl.state.path).toBe("Documents/Archive/");
    expect(deep.ctrl.items().map((i) => i.name)).toEqual(["deep.txt"]);

    const recent = await mount({ initialSearch: "?view=recent" });
    expect(recent.ctrl.state.nav).toBe("recent");
    expect(recent.doc.title).toBe("Recent — Takos Storage");

    const searched = await mount({ initialSearch: "?q=alpha" });
    expect(searched.ctrl.state.query).toBe("alpha");
    expect(searched.doc.getElementById("q").value).toBe("alpha");
    expect(searched.ctrl.items().map((i) => i.name)).toEqual(["alpha.txt"]);

    const unsafe = await mount({ initialSearch: "?path=..%2Fetc%2Fpasswd" });
    expect(unsafe.ctrl.state.path).toBe("");

    // Interactive pushState / popstate flow.
    const m = await mount();
    expect(m.location.search).toBe("");
    const docs = m.ctrl.items().find((i) => i.name === "Documents")!;
    m.ctrl.openItem(docs);
    expect(m.location.search).toBe("?path=Documents%2F");

    const archive = m.ctrl.items().find((i) => i.name === "Archive")!;
    m.ctrl.openItem(archive);
    expect(m.location.search).toBe("?path=Documents%2FArchive%2F");

    // Browser Back steps back to Documents/, then root.
    m.navigateHistory(-1);
    expect(m.ctrl.state.path).toBe("Documents/");
    expect(m.location.search).toBe("?path=Documents%2F");
    m.navigateHistory(-1);
    expect(m.ctrl.state.path).toBe("");
    expect(m.location.search).toBe("");

    // Browser Forward returns to Documents/.
    m.navigateHistory(1);
    expect(m.ctrl.state.path).toBe("Documents/");

    // Search pushes on entering search, replaces while refining, pushes on clear.
    // Note: we were at history index 1 (Documents/) with Archive/ ahead in forward stack,
    // so entering search truncates forward history and pushes at index 2.
    const q = m.doc.getElementById("q");
    q.value = "al";
    q.dispatch("input");
    await until(() => m.ctrl.state.query === "al");
    expect(m.location.search).toContain("q=al");
    expect(m.historyStack).toEqual([
      "/",
      "/?path=Documents%2F",
      "/?path=Documents%2F&q=al",
    ]);

    q.value = "alpha";
    q.dispatch("input");
    await until(() => m.ctrl.state.query === "alpha");
    expect(m.location.search).toContain("q=alpha");
    expect(m.historyStack).toEqual([
      "/",
      "/?path=Documents%2F",
      "/?path=Documents%2F&q=alpha",
    ]);

    m.doc.getElementById("q-clear").click();
    expect(m.ctrl.state.query).toBe("");
    expect(m.location.search).toBe("?path=Documents%2F");
    expect(m.historyStack).toEqual([
      "/",
      "/?path=Documents%2F",
      "/?path=Documents%2F&q=alpha",
      "/?path=Documents%2F",
    ]);
  });

  test("bulk selection supports checkboxes, Shift+Click, Select All, Escape clear, inline collision guard, and CAS partial-failure reconciliation", async () => {
    const m = await mount();
    const checks = m.doc
      .getElementById("rows")
      .querySelectorAll(".select-check[data-select]");
    const selectAll = m.doc.getElementById("select-all");
    const bulkBar = m.doc.getElementById("bulk-bar");
    expect(bulkBar.hidden).toBe(true);
    expect(selectAll.getAttribute("aria-checked")).toBe("false");

    const alphaIdx = m.ctrl.items().findIndex((i) => i.name === "alpha.txt");
    const betaIdx = m.ctrl.items().findIndex((i) => i.name === "beta.txt");
    const alphaCheck = checks.find(
      (c) => Number(c.getAttribute("data-select")) === alphaIdx,
    )!;
    const betaCheck = checks.find(
      (c) => Number(c.getAttribute("data-select")) === betaIdx,
    )!;

    // Select alpha.txt & beta.txt via Shift+Click range selection!
    m.doc.dispatchDoc("click", { target: alphaCheck });
    expect(bulkBar.hidden).toBe(false);
    expect(m.doc.getElementById("bulk-count").textContent).toBe("1 selected");
    expect(selectAll.getAttribute("aria-checked")).toBe("mixed");

    m.doc.dispatchDoc("click", { target: betaCheck, shiftKey: true });
    expect(m.doc.getElementById("bulk-count").textContent).toBe("2 selected");

    // Pre-create beta.txt in Photos/ so bulk move hits partial 409 conflict on beta.txt while alpha.txt succeeds!
    await m.bucket.put("drive/Photos/beta.txt", "existing", {
      httpMetadata: { contentType: "text/plain" },
    });

    m.doc.getElementById("bulk-move").click();
    expect(m.doc.getElementById("move-dialog").open).toBe(true);
    expect(m.doc.getElementById("move-dialog-item").textContent).toContain(
      "2 selected",
    );

    // Concurrent update to alpha.txt after dialog opened: snapshot keeps original ETag,
    // wait — here let's test beta.txt 409 conflict + alpha.txt clean move first, then stale-ETag 412 below!

    const moveSelect = m.doc.getElementById("move-folder");
    moveSelect.value = "Photos/";
    moveSelect.dispatch("change");
    expect(m.doc.getElementById("move-form").dispatch("submit")).toBe(false);
    // Match browser <form method="dialog"> closing the dialog after non-prevented submit.
    m.doc.getElementById("move-dialog").close();

    await until(() => m.doc.getElementById("folder-result-dialog").open);
    await until(() => !m.ctrl.state.loading);

    // alpha.txt moved cleanly; beta.txt kept at source & destination untouched; reconciliation dialog lists both!
    expect(m.bucket.objects.has("drive/Photos/alpha.txt")).toBe(true);
    expect(m.bucket.objects.has("drive/alpha.txt")).toBe(false);
    expect(m.bucket.objects.has("drive/beta.txt")).toBe(true);
    expect(
      new TextDecoder().decode(
        m.bucket.objects.get("drive/Photos/beta.txt")!.bytes,
      ),
    ).toBe("existing");
    expect(m.doc.getElementById("folder-result-paths").textContent).toContain(
      "alpha.txt",
    );
    expect(m.doc.getElementById("folder-result-paths").textContent).toContain(
      "beta.txt",
    );
    expect(m.doc.getElementById("toast").textContent).not.toContain("Moved");
    m.doc.getElementById("folder-result-dialog").close();

    // Select All + Escape clears selection.
    selectAll.click();
    expect(selectAll.getAttribute("aria-checked")).toBe("true");
    expect(bulkBar.hidden).toBe(false);
    m.doc.dispatchDoc("keydown", { key: "Escape", isComposing: false });
    expect(bulkBar.hidden).toBe(true);
    expect(selectAll.getAttribute("aria-checked")).toBe("false");

    // Bulk move collision check in search view (Documents/dup.txt + Photos/dup.txt -> root).
    m.ctrl.state.query = "dup.txt";
    m.ctrl.render();
    selectAll.click();
    m.doc.getElementById("bulk-move").click();
    moveSelect.value = "";
    moveSelect.dispatch("change");
    expect(m.doc.getElementById("move-form").dispatch("submit")).toBe(true);
    expect(m.doc.getElementById("move-error").hidden).toBe(false);
    expect(m.doc.getElementById("move-error").textContent).toContain(
      "same name",
    );
    m.doc.getElementById("move-dialog").close();

    // Bulk delete snapshot immutability: modifying logo.svg after opening delete-dialog causes CAS 412 refusal preserving newer bytes!
    m.ctrl.state.query = "";
    m.ctrl.render();
    const freshChecks = m.doc
      .getElementById("rows")
      .querySelectorAll(".select-check[data-select]");
    const bIdx = m.ctrl.items().findIndex((i) => i.name === "beta.txt");
    const svgIdx = m.ctrl.items().findIndex((i) => i.name === "logo.svg");
    m.doc.dispatchDoc("click", {
      target: freshChecks.find(
        (c) => Number(c.getAttribute("data-select")) === bIdx,
      )!,
    });
    m.doc.dispatchDoc("click", {
      target: freshChecks.find(
        (c) => Number(c.getAttribute("data-select")) === svgIdx,
      )!,
    });
    m.doc.getElementById("bulk-delete").click();
    expect(m.doc.getElementById("delete-dialog").open).toBe(true);
    // Simulate concurrent writer modifying logo.svg before user confirms!
    await m.bucket.put("drive/logo.svg", "<svg>newer</svg>", {
      httpMetadata: { contentType: "image/svg+xml" },
    });
    m.doc.getElementById("delete-confirm").click();
    await until(() => m.doc.getElementById("folder-result-dialog").open);
    await until(() => !m.ctrl.state.loading);
    expect(m.bucket.objects.has("drive/beta.txt")).toBe(false);
    expect(m.bucket.objects.has("drive/logo.svg")).toBe(true);
    expect(
      new TextDecoder().decode(m.bucket.objects.get("drive/logo.svg")!.bytes),
    ).toBe("<svg>newer</svg>");
    m.doc.getElementById("folder-result-dialog").close();

    // Bulk delete stops immediately on network failure and reports uncertain + unattempted entries without retrying.
    const checksAfter = m.doc
      .getElementById("rows")
      .querySelectorAll(".select-check[data-select]");
    const svgIdx2 = m.ctrl.items().findIndex((i) => i.name === "logo.svg");
    const picIdx = m.ctrl.items().findIndex((i) => i.name === "pic.png");
    m.doc.dispatchDoc("click", {
      target: checksAfter.find(
        (c) => Number(c.getAttribute("data-select")) === svgIdx2,
      )!,
    });
    m.doc.dispatchDoc("click", {
      target: checksAfter.find(
        (c) => Number(c.getAttribute("data-select")) === picIdx,
      )!,
    });
    m.setFailNetwork("logo.svg");
    const deletesBefore = m.requests.filter(
      (r) => r.method === "DELETE",
    ).length;
    m.doc.getElementById("bulk-delete").click();
    expect(m.doc.getElementById("delete-dialog").open).toBe(true);
    m.doc.getElementById("delete-confirm").click();
    await until(() => m.doc.getElementById("folder-result-dialog").open);
    await until(() => !m.ctrl.state.loading);
    // Network error stopped batch immediately (no automatic retry) and reported uncertain result.
    expect(m.doc.getElementById("folder-result-message").textContent).toContain(
      "could not be confirmed",
    );
    expect(m.doc.getElementById("folder-result-paths").textContent).toContain(
      "logo.svg",
    );
    expect(
      m.requests.filter((r) => r.method === "DELETE").length - deletesBefore,
    ).toBeLessThanOrEqual(2);
  });

  test("drag-and-drop moves a file onto a folder row or ancestor breadcrumb via CAS /api/drive/move without triggering external upload overlay", async () => {
    const m = await mount();
    const main = m.doc.getElementById("main");
    const rows = m.doc.getElementById("rows").children;
    const alphaIdx = m.ctrl.items().findIndex((i) => i.name === "alpha.txt");
    const docsIdx = m.ctrl.items().findIndex((i) => i.name === "Documents");
    const alphaRow = rows[alphaIdx]!;
    const docsRow = rows[docsIdx]!;

    // Drag alpha.txt onto Documents/ row.
    main.dispatch("dragstart", {
      target: alphaRow,
      dataTransfer: { effectAllowed: "", setData() {}, types: ["text/plain"] },
    });
    main.dispatch("dragenter", {
      target: docsRow,
      dataTransfer: { types: ["text/plain"] },
    });
    expect(
      m.doc.getElementById("drop-overlay").classList.contains("active"),
    ).toBe(false);
    expect(docsRow.classList.contains("drop-target")).toBe(true);

    main.dispatch("drop", {
      target: docsRow,
      dataTransfer: { types: ["text/plain"], files: [] },
    });
    await until(() => m.bucket.objects.has("drive/Documents/alpha.txt"));
    await until(() => !m.ctrl.state.loading);
    expect(m.bucket.objects.has("drive/alpha.txt")).toBe(false);
    expect(docsRow.classList.contains("drop-target")).toBe(false);

    // Open Documents/ and drag alpha.txt back onto the "My Drive" root breadcrumb!
    m.ctrl.openItem(m.ctrl.items().find((i) => i.name === "Documents")!);
    const homeCrumb = m.doc
      .getElementById("crumbs")
      .all()
      .find((c) => c.getAttribute("data-folder-path") === "")!;
    expect(homeCrumb).toBeDefined();
    const docRows = m.doc.getElementById("rows").children;
    const docAlphaIdx = m.ctrl.items().findIndex((i) => i.name === "alpha.txt");
    main.dispatch("dragstart", {
      target: docRows[docAlphaIdx]!,
      dataTransfer: { effectAllowed: "", setData() {}, types: ["text/plain"] },
    });
    main.dispatch("dragover", {
      target: homeCrumb,
      dataTransfer: { dropEffect: "", types: ["text/plain"] },
    });
    expect(homeCrumb.classList.contains("drop-target")).toBe(true);
    main.dispatch("drop", {
      target: homeCrumb,
      dataTransfer: { types: ["text/plain"], files: [] },
    });
    await until(() => m.bucket.objects.has("drive/alpha.txt"));
    await until(() => !m.ctrl.state.loading);
    expect(m.bucket.objects.has("drive/Documents/alpha.txt")).toBe(false);

    // Dragging a folder onto another folder opens Move dialog preselected to target (preserving snapshot review).
    m.ctrl.state.path = "";
    m.ctrl.render();
    const rootRows = m.doc.getElementById("rows").children;
    const photosIdx = m.ctrl.items().findIndex((i) => i.name === "Photos");
    const docsIdx2 = m.ctrl.items().findIndex((i) => i.name === "Documents");
    main.dispatch("dragstart", {
      target: rootRows[photosIdx]!,
      dataTransfer: { effectAllowed: "", setData() {}, types: ["text/plain"] },
    });
    main.dispatch("drop", {
      target: rootRows[docsIdx2]!,
      dataTransfer: { types: ["text/plain"], files: [] },
    });
    expect(m.doc.getElementById("move-dialog").open).toBe(true);
    expect(m.doc.getElementById("move-folder").value).toBe("Documents/");
    expect(m.doc.getElementById("move-dialog-note").hidden).toBe(false);
    m.doc.getElementById("move-dialog").close();

    // External OS file drag still activates drop-overlay.
    main.dispatch("dragenter", {
      target: main,
      dataTransfer: { types: ["Files"] },
    });
    expect(
      m.doc.getElementById("drop-overlay").classList.contains("active"),
    ).toBe(true);
  });

  test("grid view lazy-loads bounded raster thumbnails, skips SVG and oversized images, caps concurrency, handles img error, and revokes every blob URL on leave", async () => {
    const m = await mount({
      initialView: "grid",
      extraImages: 5,
      includeHugeImage: true,
      holdImageFetches: true,
    });
    // Only the 6 small raster PNGs (pic.png + img-1..5.png) should be observed — NOT logo.svg and NOT huge.png (>4MB)!
    const obs = m.observers.at(-1)!;
    expect(obs).toBeDefined();
    expect(obs.observed).toHaveLength(6);

    // Trigger intersection for all 6 at once — concurrency cap must keep in-flight <= 3!
    obs.cb(obs.observed.map((target) => ({ target, isIntersecting: true })));
    await until(() => m.getPendingImageGates() === 3);
    expect(m.getMaxConcurrentImages()).toBe(3);

    // Release first wave, then second wave.
    m.releaseImageGates();
    await until(() => m.createdUrls.length >= 3);
    await until(() => m.getPendingImageGates() === 3);
    expect(m.getMaxConcurrentImages()).toBe(3);
    m.releaseImageGates();
    await until(() => m.createdUrls.length === 6);
    expect(m.requests.some((r) => r.path.includes("logo.svg"))).toBe(false);
    expect(m.requests.some((r) => r.path.includes("huge.png"))).toBe(false);

    // Img error on one thumbnail revokes its URL and removes the <img> cleanly.
    const firstImg = m.doc
      .getElementById("cards")
      .querySelector(".card-thumb-img")!;
    expect(firstImg).not.toBeNull();
    firstImg.dispatch("error");
    expect(m.revokedUrls).toHaveLength(1);

    // Switching back to List view disconnects observer and revokes ALL remaining blob URLs!
    const listBtn = m.doc.viewButtons.find(
      (b) => b.getAttribute("data-view") === "list",
    )!;
    listBtn.click();
    expect(obs.disconnected).toBe(true);
    expect(m.revokedUrls.length).toBe(m.createdUrls.length);
  });

  test("keyboard shortcuts ? / n / u work with strict input, IME, modifier, and overlay guards and restore focus", async () => {
    const m = await mount();
    const main = m.doc.getElementById("main");
    main.focus();

    // "?" opens shortcuts dialog and "?" again closes and restores focus.
    m.doc.dispatchDoc("keydown", { key: "?", shiftKey: true });
    expect(m.doc.getElementById("shortcuts-dialog").open).toBe(true);
    m.doc.dispatchDoc("keydown", { key: "?", shiftKey: true });
    expect(m.doc.getElementById("shortcuts-dialog").open).toBe(false);
    expect(m.doc.activeElement).toBe(main);

    // "#" / "n" / "u" guarded in text input, IME, modifiers, and open dialogs.
    const q = m.doc.getElementById("q");
    q.focus();
    m.doc.dispatchDoc("keydown", { key: "?" });
    m.doc.dispatchDoc("keydown", { key: "n" });
    expect(m.doc.getElementById("shortcuts-dialog").open).toBe(false);
    expect(m.doc.getElementById("name-dialog").open).toBe(false);

    main.focus();
    m.doc.dispatchDoc("keydown", { key: "n", ctrlKey: true });
    m.doc.dispatchDoc("keydown", { key: "n", isComposing: true });
    m.doc.dispatchDoc("keydown", { key: "n", keyCode: 229 });
    m.doc.dispatchDoc("keydown", { key: "n", shiftKey: true });
    expect(m.doc.getElementById("name-dialog").open).toBe(false);

    // Unguarded "n" opens New Folder dialog; closing restores focus.
    m.doc.dispatchDoc("keydown", { key: "n" });
    expect(m.doc.getElementById("name-dialog").open).toBe(true);
    expect(m.doc.getElementById("name-dialog-title").textContent).toBe(
      "New folder",
    );
    // While name-dialog is open, "?" and "u" must NOT fire.
    let fileInputClicks = 0;
    m.doc.getElementById("file-input").addEventListener("click", () => {
      fileInputClicks += 1;
    });
    m.doc.dispatchDoc("keydown", { key: "?" });
    m.doc.dispatchDoc("keydown", { key: "u" });
    expect(m.doc.getElementById("shortcuts-dialog").open).toBe(false);
    expect(fileInputClicks).toBe(0);
    m.doc.getElementById("name-dialog").close();
    expect(m.doc.activeElement).toBe(main);

    // Unguarded "u" triggers file input click.
    m.doc.dispatchDoc("keydown", { key: "u" });
    expect(fileInputClicks).toBe(1);
  });
});

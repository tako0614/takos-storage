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
    { bytes: Uint8Array; etag: string; type: string }
  >();
  seq = 0;
  pageSize = 1000;

  async head(key: string): Promise<R2Object | null> {
    const item = this.objects.get(key);
    if (!item) return null;
    return {
      key,
      size: item.bytes.length,
      uploaded: new Date(0),
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
      uploaded: new Date(0),
      httpEtag: item.etag,
      httpMetadata: { contentType: item.type },
      body: new Response(bytes).body!,
      arrayBuffer: async () => bytes.buffer,
    };
  }

  async put(
    key: string,
    body: ArrayBuffer | ReadableStream | string,
    options?: R2PutOptions,
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
    const bytes = new Uint8Array(await new Response(body).arrayBuffer());
    this.objects.set(key, {
      bytes,
      etag: `"etag-${++this.seq}"`,
      type: options?.httpMetadata?.contentType ?? "application/octet-stream",
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
    const keys = all.slice(0, Math.min(this.pageSize, options?.limit ?? 1000));
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
  private text = "";
  title = "";
  private html = "";
  hidden = false;
  disabled = false;
  open = false;
  inert = false;
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
    this.html = val;
    this.children = [];
    // Synthesize .row-link buttons for keyboard navigation tests when rows/cards render.
    const rowLinkMatch = /class="row-link" data-open="(\d+)"/u.exec(val);
    if (rowLinkMatch) {
      const btn = new FakeEl(this.doc, "BUTTON");
      btn.className = "row-link";
      btn.setAttribute("data-open", rowLinkMatch[1]!);
      this.children.push(btn);
    }
  }

  addEventListener(type: string, fn: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }

  dispatch(type: string, extra: Record<string, unknown> = {}): boolean {
    let prevented = false;
    for (const fn of this.listeners.get(type) ?? []) {
      fn({
        target: this,
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
    this.children.push(node);
    return node;
  }

  append(...nodes: FakeEl[]) {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes: FakeEl[]) {
    this.children = nodes;
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
    if (selector === ".tray-retry") {
      return descendants.filter((el) => el.classes.has("tray-retry"));
    }
    if (selector.includes("button:not([disabled]):not([hidden])")) {
      return descendants.filter(
        (el) => el.tagName === "BUTTON" && !el.disabled && !el.hidden,
      );
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

  closest(selector: string): FakeEl | null {
    if (selector === ".kebab" && this.classes.has("kebab")) return this;
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
  remove() {}
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
  activeElement: FakeEl | null = null;
  docListeners = new Map<string, Array<{ fn: Listener; capture: boolean }>>();
  documentElement = { lang: "en", dataset: { theme: "light" } };
  i18nNodes: FakeEl[] = [];
  placeholderNodes: FakeEl[] = [];
  labelNodes: FakeEl[] = [];

  constructor() {
    this.body = new FakeEl(this, "BODY");
    const q = this.getElementById("q");
    q.setAttribute("data-i18n-placeholder", "searchPlaceholder");
    q.setAttribute("data-i18n-label", "searchPlaceholder");
    this.placeholderNodes.push(q);
    this.labelNodes.push(q);

    const searchTruncText = new FakeEl(this, "SPAN");
    searchTruncText.setAttribute("data-i18n", "searchTruncated");
    this.i18nNodes.push(searchTruncText);
    this.getElementById("search-truncated").appendChild(searchTruncText);

    const itemMenu = this.getElementById("item-menu");
    for (const action of ["open", "download", "rename", "move", "delete"]) {
      const item = new FakeEl(this, "BUTTON");
      item.setAttribute("role", "menuitem");
      item.setAttribute("data-action", action);
      item.classes.add("menu-item");
      itemMenu.appendChild(item);
    }

    const preview = this.getElementById("preview");
    preview.appendChild(this.getElementById("preview-download"));
    preview.appendChild(this.getElementById("preview-close"));
  }

  getElementById = (id: string): FakeEl => {
    if (!this.nodes.has(id)) {
      const tag =
        id === "q" || id === "name-input" || id === "move-custom-input"
          ? "INPUT"
          : id === "move-folder"
            ? "SELECT"
            : id === "lang-toggle" ||
                id === "preview-download" ||
                id === "preview-close" ||
                id === "search-load-more" ||
                id === "load-more" ||
                id === "tray-close"
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
    if (selector === "[data-i18n]") return this.i18nNodes;
    if (selector === "[data-i18n-placeholder]") return this.placeholderNodes;
    if (selector === "[data-i18n-label]") return this.labelNodes;
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
  const deadline = Date.now() + 2000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("console did not settle");
    await Bun.sleep(5);
  }
}

async function mount(opts: { pageSize?: number } = {}) {
  const bucket = new MemoryBucket();
  bucket.pageSize = opts.pageSize ?? 1000;
  await bucket.put("drive/Documents/", "", {
    httpMetadata: { contentType: "application/x-directory" },
  });
  await bucket.put("drive/Documents/Archive/", "", {
    httpMetadata: { contentType: "application/x-directory" },
  });
  await bucket.put("drive/Documents/Archive/deep.txt", "nested", {
    httpMetadata: { contentType: "text/plain" },
  });
  await bucket.put("drive/Photos/", "", {
    httpMetadata: { contentType: "application/x-directory" },
  });
  await bucket.put("drive/Photos/pic.txt", "photo note", {
    httpMetadata: { contentType: "text/plain" },
  });
  await bucket.put("drive/note.txt", "hello storage", {
    httpMetadata: { contentType: "text/plain" },
  });
  await bucket.put("drive/zebra-last.txt", "on page 2", {
    httpMetadata: { contentType: "text/plain" },
  });

  const env: Env = { BUCKET: bucket, ALLOW_UNAUTHENTICATED_DRIVE: "1" };
  const doc = new FakeDoc();
  const storage = new Map<string, string>();
  const requests: Array<{
    method: string;
    path: string;
    ifNoneMatch: string | null;
    body?: string;
  }> = [];
  let failPutMatch: string | null = null;

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
    window: { addEventListener() {}, innerWidth: 1200, innerHeight: 800 },
    location: { pathname: "/", search: "", href: "" },
    fetch: async (path: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers);
      requests.push({
        method,
        path,
        ifNoneMatch: headers.get("if-none-match"),
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      if (method === "PUT" && failPutMatch && path.includes(failPutMatch)) {
        return new Response("transient", { status: 503 });
      }
      return worker.fetch(
        new Request(new URL(path, "http://storage.local"), init),
        env,
      );
    },
    URL,
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
      `\n  globalThis.ctrl = { state: state, items: visibleItems, render: render, uploadFiles: uploadFiles, openItem: openItem, openPreview: openPreview, closePreview: closePreview, selectMenu: function(item, anchor) { menuTarget = item; menuAnchor = anchor || null; } };\n  boot();`,
    ),
    context,
  );

  const ctrl = context.ctrl as {
    state: {
      loading: boolean;
      failed: boolean;
      truncated: boolean;
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
    uploadFiles: (files: File[]) => void;
    openItem: (item: unknown) => void;
    openPreview: (item: unknown) => void;
    closePreview: (restore?: boolean) => void;
    selectMenu: (item: unknown, anchor?: FakeEl) => void;
  };
  await until(() => !ctrl.state.loading);
  return {
    doc,
    ctrl,
    bucket,
    storage,
    requests,
    setFailPut: (match: string | null) => {
      failPutMatch = match;
    },
  };
}

describe("Takos Storage Wave 2 UI/UX improvements", () => {
  test("HTML includes language toggle, truncated search banner, move menu/dialog, upload progress, and mobile header wrapping", () => {
    const html = storageConsoleHtml();
    expect(html).toContain('id="lang-toggle" class="lang-btn"');
    expect(html).not.toContain(
      'id="lang-toggle" class="lang-btn" type="button" aria-pressed',
    );
    expect(html).toContain("header.app { flex-wrap: wrap; }");
    expect(html).toContain(
      ".search { order: 3; flex: 1 0 100%; max-width: none; }",
    );
    expect(html).toContain(".tray-retry { min-height: 44px;");
    expect(html).toContain(
      'id="search-truncated" class="search-notice" role="status"',
    );
    expect(html).toContain('id="search-load-more"');
    expect(html).toContain('data-action="move"');
    expect(html).toContain(
      '<dialog id="move-dialog" aria-labelledby="move-dialog-title">',
    );
    expect(html).toContain('id="move-error" role="alert"');
    expect(html).toContain('id="tray-progress" aria-live="polite"');
    expect(html).toContain('data-i18n-label="breadcrumbLabel"');
  });

  test("language toggle switches EN <-> JA live, persists takos-lang, and updates dynamic aria-label without aria-pressed", async () => {
    const m = await mount();
    const langBtn = m.doc.getElementById("lang-toggle");
    expect(m.doc.documentElement.lang).toBe("en");
    expect(langBtn.textContent).toBe("EN");
    expect(langBtn.getAttribute("aria-pressed")).toBeNull();
    expect(langBtn.getAttribute("aria-label")).toBe(
      "Switch language to Japanese",
    );

    langBtn.click();
    expect(m.doc.documentElement.lang).toBe("ja");
    expect(m.storage.get("takos-lang")).toBe("ja");
    expect(langBtn.textContent).toBe("JA");
    expect(langBtn.getAttribute("aria-pressed")).toBeNull();
    expect(langBtn.getAttribute("aria-label")).toBe("英語に切り替え");
    expect(m.doc.getElementById("q").getAttribute("placeholder")).toBe(
      "ドライブ内を検索",
    );
    expect(m.doc.getElementById("usage-text").textContent).toContain(
      "個のファイル",
    );

    langBtn.click();
    expect(m.doc.documentElement.lang).toBe("en");
    expect(m.storage.get("takos-lang")).toBe("en");
    expect(langBtn.textContent).toBe("EN");
    expect(langBtn.getAttribute("aria-pressed")).toBeNull();
  });

  test("upload tray shows live N/M progress, retries failed file with CAS if-none-match *, and clears File refs on dismiss", async () => {
    const m = await mount();
    m.setFailPut("bad.txt");
    const goodFile = new File(["ok"], "good.txt", { type: "text/plain" });
    const badFile = new File(["retry me"], "bad.txt", { type: "text/plain" });

    m.ctrl.uploadFiles([goodFile, badFile]);
    await until(
      () =>
        !m.ctrl.state.loading &&
        m.doc.getElementById("tray-progress").textContent ===
          "1 / 2 · 1 failed",
    );

    const trayList = m.doc.getElementById("tray-list");
    const retryBtns = trayList.querySelectorAll(".tray-retry");
    expect(retryBtns).toHaveLength(1);
    expect(retryBtns[0]!.getAttribute("aria-label")).toBe(
      "Retry uploading bad.txt",
    );

    // Navigate into a subfolder before retrying — retry must still target original root path with if-none-match: *.
    m.ctrl.state.path = "Documents/";
    m.setFailPut(null);
    retryBtns[0]!.click();
    await until(
      () =>
        !m.ctrl.state.loading &&
        m.doc.getElementById("tray-progress").textContent === "2 / 2",
    );
    const badPuts = m.requests.filter(
      (r) => r.method === "PUT" && r.path === "/api/drive/file/bad.txt",
    );
    expect(badPuts).toHaveLength(2);
    expect(badPuts[1]!.ifNoneMatch).toBe("*");
    expect(m.bucket.objects.has("drive/bad.txt")).toBe(true);
    expect(trayList.querySelectorAll(".tray-retry")).toHaveLength(0);

    // Retrying a file that now conflicts (412) reloads the drive list to match the conflict toast.
    m.setFailPut("conflict.txt");
    m.ctrl.state.path = "";
    m.ctrl.uploadFiles([
      new File(["v1"], "conflict.txt", { type: "text/plain" }),
    ]);
    await until(() => trayList.querySelectorAll(".tray-retry").length === 1);
    const conflictRetry = trayList.querySelectorAll(".tray-retry")[0]!;
    await m.bucket.put("drive/conflict.txt", "concurrent writer", {
      httpMetadata: { contentType: "text/plain" },
    });
    m.setFailPut(null);
    const listsBeforeConflictRetry = m.requests.filter((r) =>
      r.path.startsWith("/api/drive/list"),
    ).length;
    conflictRetry.click();
    await until(
      () =>
        !m.ctrl.state.loading &&
        m.requests.filter((r) => r.path.startsWith("/api/drive/list")).length >
          listsBeforeConflictRetry,
    );
    expect(m.ctrl.state.files.some((f) => f.path === "conflict.txt")).toBe(
      true,
    );

    // Fail another file and dismiss tray -> File reference is released so stale retry button cannot upload.
    m.setFailPut("discard.txt");
    m.ctrl.uploadFiles([
      new File(["nope"], "discard.txt", { type: "text/plain" }),
    ]);
    await until(() => trayList.querySelectorAll(".tray-retry").length === 2);
    const staleRetry = trayList.querySelectorAll(".tray-retry")[1]!;
    m.doc.getElementById("tray-close").click();
    expect(m.doc.getElementById("tray").classList.contains("open")).toBe(false);
    expect(m.doc.getElementById("tray-progress").textContent).toBe("");

    m.setFailPut(null);
    const putsBefore = m.requests.filter((r) => r.method === "PUT").length;
    staleRetry.click();
    await Bun.sleep(20);
    expect(m.requests.filter((r) => r.method === "PUT").length).toBe(
      putsBefore,
    );
  });

  test("ArrowDown/ArrowUp/Home/End navigate list & grid rows and Backspace navigates up with strict overlay/input guards", async () => {
    const m = await mount();
    const main = m.doc.getElementById("main");
    main.focus();
    const listLinks = m.doc
      .getElementById("rows")
      .querySelectorAll(".row-link");
    expect(listLinks.length).toBeGreaterThanOrEqual(3);

    m.doc.dispatchDoc("keydown", { key: "ArrowDown" });
    expect(m.doc.activeElement).toBe(listLinks[0]!);
    m.doc.dispatchDoc("keydown", { key: "ArrowDown" });
    expect(m.doc.activeElement).toBe(listLinks[1]!);
    m.doc.dispatchDoc("keydown", { key: "End" });
    expect(m.doc.activeElement).toBe(listLinks.at(-1)!);
    m.doc.dispatchDoc("keydown", { key: "Home" });
    expect(m.doc.activeElement).toBe(listLinks[0]!);

    // Grid view navigation works identically.
    m.ctrl.state.view = "grid";
    m.ctrl.render();
    main.focus();
    const cardLinks = m.doc
      .getElementById("cards")
      .querySelectorAll(".row-link");
    expect(cardLinks.length).toBe(listLinks.length);
    m.doc.dispatchDoc("keydown", { key: "ArrowDown" });
    expect(m.doc.activeElement).toBe(cardLinks[0]!);
    m.doc.dispatchDoc("keydown", { key: "ArrowDown" });
    expect(m.doc.activeElement).toBe(cardLinks[1]!);
    m.doc.dispatchDoc("keydown", { key: "ArrowUp" });
    expect(m.doc.activeElement).toBe(cardLinks[0]!);

    // Backspace moves up from nested folder to parent, then root.
    m.ctrl.state.path = "Documents/Archive/";
    m.ctrl.render();
    main.focus();
    // Guarded when focus is in an input.
    m.doc.getElementById("q").focus();
    m.doc.dispatchDoc("keydown", { key: "Backspace" });
    expect(m.ctrl.state.path).toBe("Documents/Archive/");

    // Guarded when a dialog is open.
    main.focus();
    m.doc.getElementById("move-dialog").open = true;
    m.doc.dispatchDoc("keydown", { key: "Backspace" });
    expect(m.ctrl.state.path).toBe("Documents/Archive/");
    m.doc.getElementById("move-dialog").open = false;

    // Guarded when preview or menu is open.
    m.doc.getElementById("preview").classList.add("open");
    m.doc.dispatchDoc("keydown", { key: "Backspace" });
    expect(m.ctrl.state.path).toBe("Documents/Archive/");
    m.doc.getElementById("preview").classList.remove("open");

    // Unguarded in normal view -> steps up one level at a time.
    m.doc.dispatchDoc("keydown", { key: "Backspace" });
    expect(m.ctrl.state.path).toBe("Documents/");
    expect(m.doc.activeElement).toBe(main);
    m.doc.dispatchDoc("keydown", { key: "Backspace" });
    expect(m.ctrl.state.path).toBe("");
  });

  test("Move-to-folder validates inline and executes CAS /api/drive/move (file) and /api/drive/folder (folder)", async () => {
    const m = await mount();
    const moveAction = m.doc
      .getElementById("item-menu")
      .querySelector('[data-action="move"]')!;
    const moveSelect = m.doc.getElementById("move-folder");
    const moveCustom = m.doc.getElementById("move-custom-input");
    const moveForm = m.doc.getElementById("move-form");
    const moveError = m.doc.getElementById("move-error");

    const note = m.ctrl.items().find((i) => i.name === "note.txt")!;
    m.ctrl.selectMenu(note);
    moveAction.click();
    expect(m.doc.getElementById("move-dialog").open).toBe(true);
    expect(moveSelect.value).toBe("");

    // Submitting same folder fails inline without writes.
    expect(moveForm.dispatch("submit")).toBe(true);
    expect(moveError.hidden).toBe(false);
    expect(moveError.textContent).toBe("Already in this folder.");
    expect(moveSelect.getAttribute("aria-invalid")).toBe("true");

    // Custom path rejects blank and traversal inline.
    moveSelect.value = "__custom__";
    moveSelect.dispatch("change");
    expect(m.doc.getElementById("move-custom-wrap").hidden).toBe(false);
    moveCustom.value = "   ";
    expect(moveForm.dispatch("submit")).toBe(true);
    expect(moveError.textContent).toBe("Enter a folder path.");

    moveCustom.value = "../escape";
    expect(moveForm.dispatch("submit")).toBe(true);
    expect(moveError.textContent).toBe("Enter a valid folder path.");

    // Valid existing destination moves file with exact source_etag via /api/drive/move.
    moveSelect.value = "Documents/";
    moveSelect.dispatch("change");
    expect(moveForm.dispatch("submit")).toBe(false);
    await until(() => m.bucket.objects.has("drive/Documents/note.txt"));
    expect(m.bucket.objects.has("drive/note.txt")).toBe(false);
    const moveReq = m.requests.find((r) => r.path === "/api/drive/move");
    expect(moveReq).toBeDefined();
    expect(JSON.parse(moveReq!.body!)).toMatchObject({
      source_path: "note.txt",
      destination_path: "Documents/note.txt",
      source_etag: note.etag,
    });

    // Wait for post-move reload to settle before moving folder.
    await until(
      () =>
        !m.ctrl.state.loading &&
        m.ctrl.state.files.some((f) => f.path === "Documents/note.txt"),
    );

    // Moving Documents/ into custom Documents/sub is rejected inline (into self).
    const docs = m.ctrl.items().find((i) => i.name === "Documents")!;
    m.ctrl.selectMenu(docs);
    moveAction.click();
    moveSelect.value = "__custom__";
    moveSelect.dispatch("change");
    moveCustom.value = "Documents/sub";
    expect(moveForm.dispatch("submit")).toBe(true);
    expect(moveError.textContent).toBe(
      "Can't move a folder into itself or a conflicting path.",
    );

    // Moving Photos/ into Documents/ uses CAS /api/drive/folder with operation="rename".
    const photos = m.ctrl.items().find((i) => i.name === "Photos")!;
    m.ctrl.selectMenu(photos);
    moveAction.click();
    moveSelect.value = "Documents/";
    moveSelect.dispatch("change");
    expect(moveForm.dispatch("submit")).toBe(false);
    await until(
      () =>
        !m.ctrl.state.loading &&
        m.bucket.objects.has("drive/Documents/Photos/pic.txt"),
    );
    expect(m.bucket.objects.has("drive/Photos/pic.txt")).toBe(false);
    const folderReq = m.requests.find((r) => r.path === "/api/drive/folder");
    expect(folderReq).toBeDefined();
    expect(JSON.parse(folderReq!.body!)).toMatchObject({
      operation: "rename",
      source_path: "Photos/",
      destination_path: "Documents/Photos/",
    });
  });

  test("truncated search banner appears during search when truncated and loads remaining items on click", async () => {
    const m = await mount({ pageSize: 4 });
    expect(m.ctrl.state.truncated).toBe(true);
    const banner = m.doc.getElementById("search-truncated");
    expect(banner.hidden).toBe(true);

    m.ctrl.state.query = "zebra";
    m.ctrl.render();
    expect(banner.hidden).toBe(false);
    expect(m.ctrl.items()).toHaveLength(0);

    m.doc.getElementById("search-load-more").click();
    await until(() => !m.ctrl.state.loading && !m.ctrl.state.truncated);
    expect(banner.hidden).toBe(true);
    expect(m.ctrl.items().map((i) => i.name)).toEqual(["zebra-last.txt"]);
  });

  test("preview Shift+Tab wraps to last focusable control when #preview itself has focus", async () => {
    const m = await mount();
    const note = m.ctrl.items().find((i) => i.name === "note.txt")!;
    m.ctrl.openPreview(note);
    const preview = m.doc.getElementById("preview");
    preview.focus();
    expect(m.doc.activeElement).toBe(preview);

    const prevented = m.doc.dispatchDoc("keydown", {
      key: "Tab",
      shiftKey: true,
    });
    expect(prevented).toBe(true);
    expect(m.doc.activeElement).toBe(m.doc.getElementById("preview-close"));
    m.ctrl.closePreview(false);
  });

  test("move dialog restores focus to connected opener on close and falls back to #main when detached", async () => {
    const m = await mount();
    const moveAction = m.doc
      .getElementById("item-menu")
      .querySelector('[data-action="move"]')!;
    const moveDialog = m.doc.getElementById("move-dialog");
    const note = m.ctrl.items().find((i) => i.name === "note.txt")!;

    const opener = m.doc.createElement("button");
    m.ctrl.selectMenu(note, opener);
    moveAction.click();
    expect(moveDialog.open).toBe(true);
    m.doc.activeElement = m.doc.body;
    moveDialog.close();
    expect(m.doc.activeElement).toBe(opener);

    const detached = m.doc.createElement("button");
    m.ctrl.selectMenu(note, detached);
    moveAction.click();
    expect(moveDialog.open).toBe(true);
    detached.isConnected = false;
    m.doc.activeElement = m.doc.body;
    moveDialog.close();
    expect(m.doc.activeElement).toBe(m.doc.getElementById("main"));
  });
});

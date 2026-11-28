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
  controls = false;
  playsInline = false;
  preload = "";
  error: { code: number } | null = null;
  paused = false;
  pauseCalls = 0;
  loadCalls = 0;
  selectionStart = 0;
  selectionEnd = 0;
  selectAllCalls = 0;
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
    const kebabMatch = /class="kebab" data-item="(\d+)"/u.exec(val);
    if (kebabMatch) {
      const kb = new FakeEl(this.doc, "BUTTON");
      kb.className = "kebab";
      kb.setAttribute("data-item", kebabMatch[1]!);
      this.appendChild(kb);
    }
  }

  markDisconnected() {
    this.isConnected = false;
    for (const c of this.children) c.markDisconnected();
  }

  addEventListener(type: string, fn: Listener, capture?: boolean) {
    const existing = this.listeners.get(type) ?? [];
    this.listeners.set(type, capture ? [fn, ...existing] : [...existing, fn]);
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
    if (name === "src") this.src = "";
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

  contains(other: unknown): boolean {
    if (other === this) return true;
    return this.children.some((c) => c.contains(other));
  }

  matchesSelector(sel: string): boolean {
    return sel.split(",").some((raw) => {
      const part = raw.trim();
      if (!part) return false;
      if (part === "#rows") return this.getAttribute("id") === "rows";
      if (part === "#cards") return this.getAttribute("id") === "cards";
      if (part === ".row") return this.classes.has("row");
      if (part === ".card") return this.classes.has("card");
      if (part === ".row-link") return this.classes.has("row-link");
      if (part === ".select-check[data-select]") {
        return (
          this.classes.has("select-check") && this.attributes.has("data-select")
        );
      }
      if (part === ".kebab") return this.classes.has("kebab");
      if (part === "[data-open]") return this.attributes.has("data-open");
      if (part === "[data-action]") return this.attributes.has("data-action");
      if (part === "[data-item-idx]")
        return this.attributes.has("data-item-idx");
      if (part === "[data-folder-path]")
        return this.attributes.has("data-folder-path");
      if (part === "[hidden]") return this.hidden;
      if (part === "audio") return this.tagName === "AUDIO";
      if (part === "video") return this.tagName === "VIDEO";
      if (part === "audio[controls]")
        return this.tagName === "AUDIO" && this.attributes.has("controls");
      if (part === "video[controls]")
        return this.tagName === "VIDEO" && this.attributes.has("controls");
      if (part === "dialog") return this.tagName === "DIALOG";
      if (part === "dialog[open]")
        return this.tagName === "DIALOG" && this.open;
      if (part === "button:not([disabled]):not([hidden])")
        return this.tagName === "BUTTON" && !this.disabled && !this.hidden;
      if (part === "a[href]")
        return this.tagName === "A" && this.attributes.has("href");
      if (part === "[tabindex]:not([tabindex='-1'])") return this.tabIndex >= 0;
      const attrEq = /^\[([^=\]]+)="([^"]*)"\]$/u.exec(part);
      if (attrEq) return this.getAttribute(attrEq[1]!) === attrEq[2]!;
      return false;
    });
  }

  closest(sel: string): FakeEl | null {
    if (this.matchesSelector(sel)) return this;
    for (let cur = this.parent; cur; cur = cur.parent) {
      if (cur.matchesSelector(sel)) return cur;
    }
    return null;
  }

  querySelectorAll(sel: string): FakeEl[] {
    const out: FakeEl[] = [];
    const walk = (node: FakeEl) => {
      for (const child of node.children) {
        if (child.matchesSelector(sel)) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }

  querySelector(sel: string): FakeEl | null {
    return this.querySelectorAll(sel)[0] ?? null;
  }

  focus() {
    this.doc.activeElement = this;
    this.dispatch("focus");
  }

  select() {
    this.selectAllCalls += 1;
    this.selectionStart = 0;
    this.selectionEnd = this.value.length;
  }

  setSelectionRange(start: number, end: number) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }

  pause() {
    this.paused = true;
    this.pauseCalls += 1;
  }

  load() {
    this.loadCalls += 1;
  }

  scrollIntoView() {}

  click() {
    this.dispatch("click");
    this.doc.dispatch("click", { target: this });
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
    return { left: 10, top: 10, bottom: 40 };
  }
}

class FakeDoc {
  nodes = new Map<string, FakeEl>();
  listeners = new Map<string, Listener[]>();
  navButtons: FakeEl[] = [];
  sideFilesBtn!: FakeEl;
  viewButtons: FakeEl[] = [];
  sortButtons: FakeEl[] = [];
  menuActions: FakeEl[] = [];
  activeElement: FakeEl | null = null;
  title = "Takos Storage";
  body: FakeEl;
  documentElement = { lang: "en", dataset: { theme: "light" } };

  constructor() {
    this.body = new FakeEl(this, "BODY");

    const sideNav = this.getElementById("side-nav", "NAV");
    for (const nav of ["files", "recent"]) {
      const btn = new FakeEl(this, "BUTTON");
      btn.className = "nav-item";
      btn.setAttribute("data-nav", nav);
      if (nav === "files") {
        btn.setAttribute("data-folder-path", "");
        this.sideFilesBtn = btn;
      }
      sideNav.appendChild(btn);
      this.navButtons.push(btn);
    }

    for (const view of ["list", "grid"]) {
      const btn = new FakeEl(this, "BUTTON");
      btn.setAttribute("data-view", view);
      this.viewButtons.push(btn);
    }

    for (const key of ["name", "size", "uploaded"]) {
      const btn = new FakeEl(this, "BUTTON");
      btn.setAttribute("data-sort", key);
      this.sortButtons.push(btn);
    }

    const itemMenu = this.getElementById("item-menu");
    for (const action of ["open", "download", "rename", "move", "delete"]) {
      const btn = new FakeEl(this, "BUTTON");
      btn.setAttribute("data-action", action);
      btn.setAttribute("role", "menuitem");
      itemMenu.appendChild(btn);
      this.menuActions.push(btn);
    }

    const preview = this.getElementById("preview");
    const previewNav = this.getElementById("preview-nav");
    previewNav.appendChild(this.getElementById("preview-prev", "BUTTON"));
    previewNav.appendChild(this.getElementById("preview-next", "BUTTON"));
    preview.appendChild(previewNav);
    preview.appendChild(this.getElementById("preview-download", "BUTTON"));
    preview.appendChild(this.getElementById("preview-close", "BUTTON"));
    preview.appendChild(this.getElementById("preview-body"));
    const focusEnd = this.getElementById("preview-focus-end", "SPAN");
    focusEnd.tabIndex = 0;
    focusEnd.hidden = true;
    preview.appendChild(focusEnd);

    const main = this.getElementById("main", "MAIN");
    const bulkBar = this.getElementById("bulk-bar");
    bulkBar.appendChild(this.getElementById("bulk-count"));
    bulkBar.appendChild(this.getElementById("bulk-move", "BUTTON"));
    bulkBar.appendChild(this.getElementById("bulk-delete", "BUTTON"));
    bulkBar.appendChild(this.getElementById("bulk-clear", "BUTTON"));
    main.appendChild(bulkBar);
    const listHead = this.getElementById("list-head");
    listHead.appendChild(this.getElementById("select-all", "BUTTON"));
    main.appendChild(listHead);
    main.appendChild(this.getElementById("rows", "UL"));
    main.appendChild(this.getElementById("cards", "DIV"));
    main.appendChild(this.getElementById("crumbs", "NAV"));

    const app = this.getElementById("app");
    app.appendChild(this.getElementById("q", "INPUT"));
    app.appendChild(sideNav);
    app.appendChild(main);

    for (const dlgId of [
      "name-dialog",
      "move-dialog",
      "delete-dialog",
      "cleanup-dialog",
      "folder-result-dialog",
      "shortcuts-dialog",
    ]) {
      this.getElementById(dlgId, "DIALOG");
    }
    this.getElementById("name-input", "INPUT");
    this.getElementById("move-folder", "SELECT");
    this.getElementById("move-custom-input", "INPUT");
    this.getElementById("name-form", "FORM");
    this.getElementById("move-form", "FORM");
    this.getElementById("file-input", "INPUT");
    this.getElementById("lang-toggle", "BUTTON");
    this.getElementById("theme-toggle", "BUTTON");
    this.getElementById("shortcuts-btn", "BUTTON");
  }

  getElementById(id: string, tag?: string): FakeEl {
    if (!this.nodes.has(id)) {
      const inferredTag =
        tag ??
        (id.endsWith("-dialog")
          ? "DIALOG"
          : id.endsWith("-input") || id === "q"
            ? "INPUT"
            : id.endsWith("-btn") ||
                id.endsWith("-clear") ||
                id.endsWith("-toggle") ||
                id === "select-all" ||
                id === "fab"
              ? "BUTTON"
              : "DIV");
      const el = new FakeEl(this, inferredTag);
      el.setAttribute("id", id);
      this.nodes.set(id, el);
    }
    return this.nodes.get(id)!;
  }

  createElement(tag: string): FakeEl {
    return new FakeEl(this, tag);
  }

  createDocumentFragment(): FakeEl {
    return new FakeEl(this, "FRAGMENT");
  }

  querySelectorAll(sel: string): FakeEl[] {
    if (sel === "[data-nav]") return this.navButtons;
    if (sel === "[data-view]") return this.viewButtons;
    if (sel === "[data-sort]") return this.sortButtons;
    return [];
  }

  querySelector(sel: string): FakeEl | null {
    if (sel === "dialog[open]") {
      for (const el of this.nodes.values()) {
        if (el.tagName === "DIALOG" && el.open) return el;
      }
      return null;
    }
    return this.querySelectorAll(sel)[0] ?? null;
  }

  addEventListener(type: string, fn: Listener, capture?: boolean) {
    const existing = this.listeners.get(type) ?? [];
    this.listeners.set(type, capture ? [fn, ...existing] : [...existing, fn]);
  }

  dispatch(type: string, extra: Record<string, unknown> = {}): boolean {
    let prevented = false;
    for (const fn of this.listeners.get(type) ?? []) {
      fn({
        target: this.body,
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
}

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn();
});

async function until(check: () => boolean) {
  const deadline = Date.now() + 2500;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("console did not settle");
    await Bun.sleep(5);
  }
}

async function mount(
  opts: { initialFiles?: [string, string | Uint8Array][] } = {},
) {
  const bucket = new MemoryBucket();
  for (const [key, content] of opts.initialFiles ?? [
    ["drive/Documents/", ""],
    ["drive/Documents/nested.txt", "nested body"],
    ["drive/Documents/Sub/", ""],
    ["drive/Documents/Sub/deep.txt", "deep body"],
    ["drive/Photos/", ""],
    ["drive/Photos/pic.png", new Uint8Array([137, 80, 78, 71])],
    ["drive/track.mp3", new Uint8Array([73, 68, 51, 3])],
    ["drive/clip.mp4", new Uint8Array([0, 0, 0, 24])],
    ["drive/note.txt", "hello world"],
    ["drive/.env", "SECRET=1"],
  ]) {
    await bucket.put(key, content, {
      httpMetadata: {
        contentType: key.endsWith("/")
          ? "application/x-directory"
          : "application/octet-stream",
      },
    });
  }

  const env: Env = { BUCKET: bucket, ALLOW_UNAUTHENTICATED_DRIVE: "1" };
  const doc = new FakeDoc();
  const createdUrls: Array<{ url: string; type: string }> = [];
  const revokedUrls: string[] = [];

  class TrackedURL extends URL {
    static createObjectURL(blob: Blob) {
      const url = `blob:w5-${createdUrls.length + 1}`;
      createdUrls.push({ url, type: blob.type });
      return url;
    }
    static revokeObjectURL(url: string) {
      revokedUrls.push(url);
    }
  }

  const locationObj = { pathname: "/", search: "", href: "", reload() {} };
  const historyObj = {
    pushState(_s: unknown, _t: string, url: string) {
      const q = url.indexOf("?");
      locationObj.search = q >= 0 ? url.slice(q) : "";
    },
    replaceState(_s: unknown, _t: string, url: string) {
      const q = url.indexOf("?");
      locationObj.search = q >= 0 ? url.slice(q) : "";
    },
  };

  const script = [
    ...storageConsoleHtml().matchAll(/<script>([\s\S]*?)<\/script>/gu),
  ]
    .map((m) => m[1]!)
    .find((s) => s.includes("var state ="));
  if (!script) throw new Error("console script not found");

  const context = createContext({
    document: doc,
    navigator: { language: "en" },
    localStorage: { getItem: () => null, setItem() {} },
    window: { addEventListener() {}, innerWidth: 1280, innerHeight: 800 },
    location: locationObj,
    history: historyObj,
    URLSearchParams,
    fetch: async (path: string, init?: RequestInit) =>
      worker.fetch(
        new Request(new URL(path, "http://storage.local"), init),
        env,
      ),
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
      `\n  globalThis.ctrl = { state: state, items: visibleItems, render: render, openItem: openItem, openPreview: openPreview, closePreview: closePreview };\n  boot();`,
    ),
    context,
  );

  const ctrl = context.ctrl as {
    state: {
      loading: boolean;
      nav: string;
      path: string;
      view: string;
      query: string;
      files: Array<{ path: string; size?: number; etag?: string }>;
    };
    items: () => Array<{
      name: string;
      path: string;
      type: "file" | "folder";
      size?: number;
      etag?: string;
    }>;
    render: () => void;
    openItem: (item: unknown, trigger?: FakeEl) => void;
    openPreview: (item: unknown, trigger?: FakeEl) => void;
    closePreview: (restore?: boolean) => void;
  };
  await until(() => !ctrl.state.loading);
  return { doc, ctrl, bucket, createdUrls, revokedUrls };
}

describe("Takos Storage Wave 5 UI/UX improvements", () => {
  test("HTML & CSS include 2-column 375px grid, inset focus outlines, sidebar root drop target, Ctrl/Cmd+A shortcut, tray landmark, splash h1, and media preview styles", () => {
    const html = storageConsoleHtml();
    expect(html).toContain(
      ".cards, .skel-cards { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; }",
    );
    expect(html).toContain(
      ".card .row-link:focus-visible { outline-offset: -2px;",
    );
    expect(html).toContain(
      ".card .kebab:focus-visible, .card .card-check:focus-visible { outline-offset: -2px; }",
    );
    expect(html).toContain(
      ".view-toggle .seg:focus-visible { outline-offset: -2px; }",
    );
    expect(html).toContain(
      'button type="button" class="nav-item" data-nav="files" data-folder-path="" aria-pressed="true"',
    );
    expect(html).toContain('data-i18n="shortcutSelectAll"');
    expect(html).toContain(
      '<div class="tray" id="tray" role="region" aria-labelledby="tray-title">',
    );
    expect(html).toContain(
      '<div id="splash-status" role="status" aria-live="polite">',
    );
    expect(html).toContain('<h1 id="splash-text" data-i18n="loading">');
    expect(html).toContain(
      '<span class="sr-only" id="preview-focus-end" tabindex="0" hidden></span>',
    );
    expect(html).toContain(
      'id="folder-result-paths" class="result-paths" tabindex="0"',
    );
    expect(html).toContain(".preview-audio-card");
    expect(html).toContain(".preview-body video");
    expect(html).toContain(
      "main { margin: 0 10px 10px; padding-bottom: 84px; }",
    );
    expect(html).toContain(
      ".row .select-check, .list-head:not(.as-grid) .select-check { margin: 0 -6px; }",
    );
  });

  test("desktop sidebar My Drive [data-nav=files] accepts dragged subfolder files and folders via CAS move", async () => {
    const m = await mount();
    const docs = m.ctrl.items().find((i) => i.name === "Documents")!;
    m.ctrl.openItem(docs);
    expect(m.ctrl.state.path).toBe("Documents/");

    const nestedIdx = m.ctrl.items().findIndex((i) => i.name === "nested.txt");
    const nestedRow = m.doc.getElementById("rows").children[nestedIdx]!;
    const main = m.doc.getElementById("main");
    const sideNav = m.doc.getElementById("side-nav");
    const sideFiles = m.doc.sideFilesBtn;

    // Drag nested.txt onto desktop sidebar My Drive (data-folder-path="").
    main.dispatch("dragstart", {
      target: nestedRow,
      dataTransfer: { effectAllowed: "", setData() {} },
    });
    const enterPrevented = sideNav.dispatch("dragenter", {
      target: sideFiles,
      dataTransfer: { types: ["text/plain"], files: [] },
    });
    expect(enterPrevented).toBe(true);
    expect(sideFiles.classList.contains("drop-target")).toBe(true);

    const dt = { dropEffect: "", types: ["text/plain"], files: [] };
    const overPrevented = sideNav.dispatch("dragover", {
      target: sideFiles,
      dataTransfer: dt,
    });
    expect(overPrevented).toBe(true);
    expect(dt.dropEffect).toBe("move");

    sideNav.dispatch("drop", {
      target: sideFiles,
      dataTransfer: { types: ["text/plain"], files: [] },
    });
    expect(sideFiles.classList.contains("drop-target")).toBe(false);
    await until(() => m.bucket.objects.has("drive/nested.txt"));
    expect(m.bucket.objects.has("drive/Documents/nested.txt")).toBe(false);
    await until(() => !m.ctrl.state.loading);

    // Dragging a subfolder onto sidebar My Drive opens Move dialog preselected to root "".
    const subIdx = m.ctrl.items().findIndex((i) => i.name === "Sub");
    const subRow = m.doc.getElementById("rows").children[subIdx]!;
    main.dispatch("dragstart", {
      target: subRow,
      dataTransfer: { effectAllowed: "", setData() {} },
    });
    sideNav.dispatch("drop", {
      target: sideFiles,
      dataTransfer: { types: ["text/plain"], files: [] },
    });
    expect(m.doc.getElementById("move-dialog").open).toBe(true);
    expect(m.doc.getElementById("move-folder").value).toBe("");
    m.doc.getElementById("move-dialog").close();
    expect(m.doc.activeElement).toBe(sideFiles);

    // Items already at root My Drive cannot be dropped onto sidebar My Drive.
    sideFiles.click();
    expect(m.ctrl.state.path).toBe("");
    const rootNoteIdx = m.ctrl.items().findIndex((i) => i.name === "note.txt");
    const rootNoteRow = m.doc.getElementById("rows").children[rootNoteIdx]!;
    main.dispatch("dragstart", {
      target: rootNoteRow,
      dataTransfer: { effectAllowed: "", setData() {} },
    });
    const rootOverPrevented = sideNav.dispatch("dragover", {
      target: sideFiles,
      dataTransfer: { types: ["text/plain"], files: [] },
    });
    expect(rootOverPrevented).toBe(false);
    expect(sideFiles.classList.contains("drop-target")).toBe(false);
  });

  test("guarded Ctrl/Cmd+A selects all visible items only when focus is inside the file list", async () => {
    const m = await mount();
    const rows = m.doc.getElementById("rows");
    const firstLink = rows.children[0]!.querySelector(".row-link")!;
    const searchInput = m.doc.getElementById("q");

    // Focus in search input: must NOT hijack Ctrl+A.
    searchInput.focus();
    const searchPrevented = m.doc.dispatch("keydown", {
      key: "a",
      ctrlKey: true,
    });
    expect(searchPrevented).toBe(false);
    expect(m.doc.getElementById("bulk-bar").hidden).toBe(true);

    // Focus in sidebar (outside file list): must NOT hijack Ctrl+A.
    m.doc.sideFilesBtn.focus();
    const sidePrevented = m.doc.dispatch("keydown", {
      key: "a",
      metaKey: true,
    });
    expect(sidePrevented).toBe(false);
    expect(m.doc.getElementById("bulk-bar").hidden).toBe(true);

    // IME composing: must NOT trigger.
    firstLink.focus();
    const imePrevented = m.doc.dispatch("keydown", {
      key: "a",
      ctrlKey: true,
      isComposing: true,
    });
    expect(imePrevented).toBe(false);
    expect(m.doc.getElementById("bulk-bar").hidden).toBe(true);

    // Focus inside file list: Ctrl+A selects all visible items.
    const listPrevented = m.doc.dispatch("keydown", {
      key: "a",
      ctrlKey: true,
    });
    expect(listPrevented).toBe(true);
    expect(m.doc.getElementById("bulk-bar").hidden).toBe(false);
    expect(
      m.doc.getElementById("select-all").getAttribute("aria-checked"),
    ).toBe("true");

    // Escape clears selection, then Cmd+A on #select-all also selects all.
    m.doc.dispatch("keydown", { key: "Escape" });
    expect(m.doc.getElementById("bulk-bar").hidden).toBe(true);
    m.doc.getElementById("select-all").focus();
    const cmdPrevented = m.doc.dispatch("keydown", {
      key: "A",
      metaKey: true,
    });
    expect(cmdPrevented).toBe(true);
    expect(m.doc.getElementById("bulk-bar").hidden).toBe(false);

    // Open overlay blocks Ctrl+A so text inside preview/dialogs can still be selected natively.
    m.doc.dispatch("keydown", { key: "Escape" });
    m.doc.getElementById("shortcuts-dialog").showModal();
    firstLink.focus();
    const dialogPrevented = m.doc.dispatch("keydown", {
      key: "a",
      ctrlKey: true,
    });
    expect(dialogPrevented).toBe(false);
    expect(m.doc.getElementById("bulk-bar").hidden).toBe(true);
    m.doc.getElementById("shortcuts-dialog").close();
  });

  test("preview plays audio and video inline with safe MIME types, size bounds, seek-safe arrows, error fallback, and pause+revoke cleanup", async () => {
    const m = await mount();
    const track = m.ctrl.items().find((i) => i.name === "track.mp3")!;
    const clip = m.ctrl.items().find((i) => i.name === "clip.mp4")!;

    // Audio preview creates typed audio/mpeg blob URL and <audio controls>.
    m.ctrl.openPreview(track);
    await until(
      () =>
        m.doc.getElementById("preview-body").querySelector("audio") !== null,
    );
    const audioEl = m.doc
      .getElementById("preview-body")
      .querySelector("audio")!;
    expect(audioEl.controls).toBe(true);
    expect(audioEl.getAttribute("aria-label")).toBe(
      "Media playback: track.mp3",
    );
    expect(m.createdUrls.at(-1)).toEqual({
      url: "blob:w5-1",
      type: "audio/mpeg",
    });

    // ArrowLeft/Right on focused <audio> does NOT jump to adjacent preview file.
    audioEl.focus();
    const arrowPrevented = m.doc.dispatch("keydown", { key: "ArrowRight" });
    expect(arrowPrevented).toBe(false);
    expect(m.doc.getElementById("preview-name").textContent).toBe("track.mp3");

    // Tab focus trap includes <audio controls>, allows forward Tab through native
    // media sub-controls without early wrap, and wraps to first via #preview-focus-end.
    const focusEnd = m.doc.getElementById("preview-focus-end");
    expect(focusEnd.hidden).toBe(false);
    m.doc.getElementById("preview-close").focus();
    const tabFromClose = m.doc.dispatch("keydown", { key: "Tab" });
    expect(tabFromClose).toBe(false);
    audioEl.focus();
    const tabInsideAudio = m.doc.dispatch("keydown", { key: "Tab" });
    expect(tabInsideAudio).toBe(false);
    expect(m.doc.activeElement).toBe(audioEl);
    // Exiting <audio> lands on #preview-focus-end, which wraps focus to first enabled control.
    focusEnd.focus();
    const expectedFirst = m.doc.getElementById("preview-prev").disabled
      ? m.doc.getElementById("preview-next").disabled
        ? m.doc.getElementById("preview-download")
        : m.doc.getElementById("preview-next")
      : m.doc.getElementById("preview-prev");
    expect(m.doc.activeElement).toBe(expectedFirst);

    // Closing preview pauses, detaches src, reloads media, hides sentinel, and revokes the blob URL.
    m.ctrl.closePreview(true);
    expect(focusEnd.hidden).toBe(true);
    expect(audioEl.pauseCalls).toBe(1);
    expect(audioEl.loadCalls).toBe(1);
    expect(audioEl.src).toBe("");
    expect(m.revokedUrls).toContain("blob:w5-1");

    // Video preview creates typed video/mp4 blob URL and <video controls playsinline>.
    m.ctrl.openPreview(clip);
    await until(
      () =>
        m.doc.getElementById("preview-body").querySelector("video") !== null,
    );
    const videoEl = m.doc
      .getElementById("preview-body")
      .querySelector("video")!;
    expect(videoEl.controls).toBe(true);
    expect(videoEl.playsInline).toBe(true);
    expect(focusEnd.hidden).toBe(false);
    expect(m.createdUrls.at(-1)).toEqual({
      url: "blob:w5-2",
      type: "video/mp4",
    });

    // Forward Tab on focused <video> is not intercepted so native controls stay reachable.
    videoEl.focus();
    expect(m.doc.dispatch("keydown", { key: "Tab" })).toBe(false);
    expect(m.doc.activeElement).toBe(videoEl);

    // MEDIA_ERR_SRC_NOT_SUPPORTED (code 4) immediately revokes previewUrl, hides sentinel,
    // and falls back cleanly to unsupported message + Download.
    videoEl.error = { code: 4 };
    videoEl.dispatch("error");
    expect(m.revokedUrls).toContain("blob:w5-2");
    expect(focusEnd.hidden).toBe(true);
    expect(
      m.doc
        .getElementById("preview-body")
        .children[0]?.children.map((c) => c.textContent),
    ).toEqual(["No preview available.", "Download"]);

    // Oversized media skips fetch (cached item.size) and shows previewTooBig.
    const urlCountBefore = m.createdUrls.length;
    m.ctrl.openPreview({
      type: "file",
      name: "huge.mp4",
      path: "huge.mp4",
      size: 30 * 1024 * 1024,
      etag: '"big"',
    });
    expect(m.createdUrls.length).toBe(urlCountBefore);
    expect(
      m.doc
        .getElementById("preview-body")
        .children[0]?.children.map((c) => c.textContent),
    ).toEqual(["Too large to preview.", "Download"]);

    // Concurrently grown media (small cached item.size, oversized fetched blob) also shows previewTooBig without allocating a blob URL.
    await m.bucket.put(
      "drive/grew.mp4",
      new Uint8Array(25 * 1024 * 1024 + 16),
      { httpMetadata: { contentType: "video/mp4" } },
    );
    const urlsBeforeGrown = m.createdUrls.length;
    m.ctrl.openPreview({
      type: "file",
      name: "grew.mp4",
      path: "grew.mp4",
      size: 1024,
      etag: '"stale"',
    });
    await until(
      () =>
        m.doc.getElementById("preview-body").children[0]?.children[0]
          ?.textContent === "Too large to preview.",
    );
    expect(m.createdUrls.length).toBe(urlsBeforeGrown);
    m.ctrl.closePreview(false);
  });

  test("English singular/plural grammar and smart Rename stem selection work cleanly", async () => {
    const m = await mount({
      initialFiles: [
        ["drive/Photos/", ""],
        ["drive/Photos/only.png", new Uint8Array([1, 2, 3])],
      ],
    });
    // Usage says "1 file" and Photos folder says "1 item".
    expect(m.doc.getElementById("usage-text").textContent).toBe("1 file · 3 B");
    expect(m.doc.getElementById("rows").children[0]!.innerHTML).toContain(
      "1 item",
    );
    expect(m.doc.getElementById("rows").children[0]!.innerHTML).not.toContain(
      "1 items",
    );

    // Switching to JA uses JA singular strings (not English fallback).
    m.doc.getElementById("lang-toggle").click();
    expect(m.doc.getElementById("usage-text").textContent).toBe(
      "1 個のファイル · 3 B",
    );
    expect(m.doc.getElementById("rows").children[0]!.innerHTML).toContain(
      "1 件",
    );
    m.doc.getElementById("lang-toggle").click();

    // Open Photos folder and trigger Rename on only.png -> selects stem "only" (0..4).
    const photos = m.ctrl.items().find((i) => i.name === "Photos")!;
    m.ctrl.openItem(photos);
    const onlyRow = m.doc.getElementById("rows").children[0]!;
    const kebab = onlyRow.querySelector(".kebab")!;
    kebab.click();
    const renameAction = m.doc.menuActions.find(
      (a) => a.getAttribute("data-action") === "rename",
    )!;
    renameAction.click();
    const nameInput = m.doc.getElementById("name-input");
    expect(nameInput.value).toBe("only.png");
    expect(nameInput.selectionStart).toBe(0);
    expect(nameInput.selectionEnd).toBe(4);
    m.doc.getElementById("name-dialog").close();

    // Renaming a dotfile (.env) or folder selects full name instead of empty stem.
    await m.bucket.put("drive/.env", "X=1");
    m.doc.sideFilesBtn.click();
    // Refresh via folder list reload by mounting directly with .env at root
    const m2 = await mount({
      initialFiles: [
        ["drive/.env", "X=1"],
        ["drive/v1.0/", ""],
        ["drive/v1.0/a.txt", "a"],
      ],
    });
    const folderIdx = m2.ctrl.items().findIndex((i) => i.name === "v1.0");
    m2.doc
      .getElementById("rows")
      .children[folderIdx]!.querySelector(".kebab")!
      .click();
    m2.doc.menuActions
      .find((a) => a.getAttribute("data-action") === "rename")!
      .click();
    expect(m2.doc.getElementById("name-input").selectionStart).toBe(0);
    expect(m2.doc.getElementById("name-input").selectionEnd).toBe(4);
    m2.doc.getElementById("name-dialog").close();

    const envIdx = m2.ctrl.items().findIndex((i) => i.name === ".env");
    m2.doc
      .getElementById("rows")
      .children[envIdx]!.querySelector(".kebab")!
      .click();
    m2.doc.menuActions
      .find((a) => a.getAttribute("data-action") === "rename")!
      .click();
    expect(m2.doc.getElementById("name-input").selectionStart).toBe(0);
    expect(m2.doc.getElementById("name-input").selectionEnd).toBe(4);
    m2.doc.getElementById("name-dialog").close();
  });
});

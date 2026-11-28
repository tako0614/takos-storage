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
  pageSize = 1000;

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
    body: ArrayBuffer | ReadableStream | string,
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
    const bytes = new Uint8Array(await new Response(body).arrayBuffer());
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
    if (selector === ".tray-status") {
      return descendants.filter((el) => el.classes.has("tray-status"));
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
    if (selector === "[hidden]" && this.hidden) return this;
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
    const preview = this.getElementById("preview");
    const previewNav = this.getElementById("preview-nav");
    previewNav.appendChild(this.getElementById("preview-prev"));
    previewNav.appendChild(this.getElementById("preview-next"));
    preview.appendChild(previewNav);
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
            : id === "brand-link"
              ? "A"
              : id === "lang-toggle" ||
                  id === "preview-prev" ||
                  id === "preview-next" ||
                  id === "preview-download" ||
                  id === "preview-close" ||
                  id === "splash-retry" ||
                  id === "splash-logout" ||
                  id === "logout" ||
                  id === "load-more" ||
                  id === "refresh-btn"
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
  const deadline = Date.now() + 2000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("console did not settle");
    await Bun.sleep(5);
  }
}

async function mount(
  opts: {
    authMeStatus?: number;
    authMeBody?: Record<string, unknown>;
    listStatus?: number;
    pageSize?: number;
    empty?: boolean;
    putStatus?: number;
    waitSettled?: boolean;
  } = {},
) {
  const bucket = new MemoryBucket();
  bucket.pageSize = opts.pageSize ?? 1000;
  if (!opts.empty) {
    await bucket.put("drive/Documents/", "", {
      httpMetadata: { contentType: "application/x-directory" },
      uploaded: new Date(10_000),
    });
    await bucket.put("drive/Documents/note.txt", "doc note", {
      httpMetadata: { contentType: "text/plain" },
      uploaded: new Date(20_000),
    });
    await bucket.put("drive/Photos/", "", {
      httpMetadata: { contentType: "application/x-directory" },
      uploaded: new Date(30_000),
    });
    await bucket.put("drive/Photos/note.txt", "photo note", {
      httpMetadata: { contentType: "text/plain" },
      uploaded: new Date(40_000),
    });
    await bucket.put("drive/alpha.txt", "alpha body", {
      httpMetadata: { contentType: "text/plain" },
      uploaded: new Date(50_000),
    });
    await bucket.put("drive/logo.svg", "<svg/>", {
      httpMetadata: { contentType: "image/svg+xml" },
      uploaded: new Date(60_000),
    });
    await bucket.put("drive/pic.png", "badpng", {
      httpMetadata: { contentType: "image/png" },
      uploaded: new Date(70_000),
    });
  }

  const env: Env = { BUCKET: bucket, ALLOW_UNAUTHENTICATED_DRIVE: "1" };
  const doc = new FakeDoc();
  let authMeStatus = opts.authMeStatus ?? 200;
  let listStatus = opts.listStatus ?? 200;
  let putStatus = opts.putStatus ?? 0;
  let objectUrlCalls = 0;

  class TrackedURL extends URL {
    static createObjectURL() {
      objectUrlCalls += 1;
      return `blob:mock-${objectUrlCalls}`;
    }
    static revokeObjectURL() {}
  }

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
    window: { addEventListener() {}, innerWidth: 1200, innerHeight: 800 },
    location: { pathname: "/", search: "", href: "", reload() {} },
    fetch: async (path: string, init?: RequestInit) => {
      if (path === "/api/auth/me") {
        if (authMeStatus !== 200) {
          return new Response(JSON.stringify({ error: "auth_error" }), {
            status: authMeStatus,
          });
        }
        return Response.json(opts.authMeBody ?? { required: false });
      }
      if (path.startsWith("/api/drive/list") && listStatus !== 200) {
        return Response.json({ error: "denied" }, { status: listStatus });
      }
      if ((init?.method ?? "GET") === "PUT" && putStatus) {
        return Response.json({ error: "forced" }, { status: putStatus });
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
      `\n  globalThis.ctrl = { state: state, items: visibleItems, render: render, load: load, openItem: openItem, openPreview: openPreview, closePreview: closePreview, uploadFiles: uploadFiles, setNameMode: function(m) { nameMode = m; }, folderResult: folderResult };\n  boot();`,
    ),
    context,
  );

  const ctrl = context.ctrl as {
    state: {
      loading: boolean;
      loadedOnce: boolean;
      failed: boolean;
      failStatus: number | null;
      nav: string;
      path: string;
      view: string;
      query: string;
    };
    items: () => Array<{
      name: string;
      path: string;
      type: "file" | "folder";
      size?: number;
      etag?: string;
    }>;
    render: () => void;
    load: (more?: boolean) => void;
    openItem: (item: unknown, trigger?: FakeEl) => void;
    openPreview: (item: unknown, trigger?: FakeEl) => void;
    closePreview: (restore?: boolean) => void;
    uploadFiles: (files: File[]) => void;
    setNameMode: (mode: string) => void;
    folderResult: (data: unknown, unknown: boolean) => void;
  };
  if (opts.waitSettled !== false) {
    await until(() => !ctrl.state.loading);
  }
  return {
    doc,
    ctrl,
    bucket,
    setAuthMeStatus: (s: number) => {
      authMeStatus = s;
    },
    setListStatus: (s: number) => {
      listStatus = s;
    },
    setPutStatus: (s: number) => {
      putStatus = s;
    },
    getObjectUrlCalls: () => objectUrlCalls,
  };
}

describe("Takos Storage Wave 3 UI/UX improvements", () => {
  test("HTML & CSS include semantic h1/h2, 44px mobile touch targets, reduced-motion, disabled states, danger contrast, splash recovery, and preview nav", () => {
    const html = storageConsoleHtml();
    expect(html).toContain("h1.crumb-heading");
    expect(html).toContain(".state h2 {");
    expect(html).not.toContain(".state h3 {");
    expect(html).toContain(".list-head.as-grid");
    expect(html).toContain(".skel-rows");
    expect(html).toContain("button:disabled { opacity: .45;");
    expect(html).toContain(".menu-item.danger { color: var(--danger); }");
    expect(html).toContain(".btn.danger { background: #b91c1c; color: #fff; }");
    expect(html).toContain("@media (prefers-reduced-motion: reduce)");
    expect(html).toContain('id="splash-retry"');
    expect(html).toContain('id="splash-logout"');
    expect(html).toContain('id="brand-link"');
    expect(html).toContain('id="preview-prev"');
    expect(html).toContain('id="preview-next"');
    expect(html).toContain('id="preview-meta"');
    expect(html).toContain(".kebab { width: 44px; height: 44px; }");
    expect(html).toContain(".tray-retry { min-height: 44px;");
    expect(html).toContain(
      'dialog input[type="text"], dialog select { min-height: 44px; }',
    );
    expect(html).toContain(
      'class="user-chip" id="user-chip" role="img" hidden><span class="avatar" id="user-avatar" aria-hidden="true"></span>',
    );
    expect(html).toContain(
      'class="list-head" id="list-head" role="group" data-i18n-label="sortLabel" aria-label="Sort"',
    );
    expect(html).toContain(
      ".list-head:not(.as-grid), .row { grid-template-columns: minmax(0,1fr) 94px 44px;",
    );
  });

  test("boot handles 403 access denied and 500 errors on splash with recovery actions, and /api/drive/list 403 shows access-denied copy", async () => {
    const denied = await mount({ authMeStatus: 403, waitSettled: false });
    await until(() => !denied.doc.getElementById("splash-logout").hidden);
    expect(denied.doc.getElementById("app").hidden).toBe(true);
    expect(denied.doc.getElementById("splash-text").textContent).toContain(
      "don't have access",
    );
    expect(denied.doc.getElementById("splash-text").getAttribute("role")).toBe(
      "alert",
    );
    expect(
      denied.doc.getElementById("splash-text").getAttribute("aria-live"),
    ).toBe("assertive");
    expect(denied.doc.getElementById("splash-retry").hidden).toBe(true);

    const broken = await mount({ authMeStatus: 500, waitSettled: false });
    await until(() => !broken.doc.getElementById("splash-retry").hidden);
    expect(broken.doc.getElementById("splash-text").textContent).toContain(
      "Couldn't check your session",
    );
    broken.setAuthMeStatus(200);
    broken.doc.getElementById("splash-retry").click();
    await until(() => !broken.ctrl.state.loading);
    expect(broken.doc.getElementById("app").hidden).toBe(false);

    const listDenied = await mount({ listStatus: 403 });
    expect(listDenied.ctrl.state.failed).toBe(true);
    expect(listDenied.ctrl.state.failStatus).toBe(403);
    expect(listDenied.doc.getElementById("state").innerHTML).toContain(
      "don&#39;t have access",
    );
  });

  test("per-screen document.title, single h1 with search match count, brand SPA nav, folder focus, and localized user-chip label", async () => {
    const m = await mount({
      authMeBody: { required: true, sub: "u1", name: "Alice" },
    });
    expect(m.doc.title).toBe("My Drive — Takos Storage");
    expect(m.doc.getElementById("user-chip").getAttribute("aria-label")).toBe(
      "Signed in as Alice",
    );
    expect(
      m.doc
        .getElementById("crumbs")
        .all()
        .some((el) => el.tagName === "H1" && el.textContent === "My Drive"),
    ).toBe(true);

    const docs = m.ctrl.items().find((i) => i.name === "Documents")!;
    m.ctrl.openItem(docs);
    expect(m.doc.title).toBe("Documents — Takos Storage");
    expect(m.doc.activeElement).toBe(m.doc.getElementById("main"));

    // Brand link navigates back to My Drive root and focuses #main.
    const prevented = m.doc.getElementById("brand-link").dispatch("click");
    expect(prevented).toBe(true);
    expect(m.ctrl.state.path).toBe("");
    expect(m.doc.title).toBe("My Drive — Takos Storage");

    // Search shows match count in h1 and updates title.
    m.ctrl.state.query = "note";
    m.ctrl.render();
    expect(m.doc.title).toBe("note — Search results — Takos Storage");
    expect(m.doc.getElementById("crumbs").innerHTML).toContain(
      '<h1 class="crumb crumb-heading" aria-current="page">Search results (2)</h1>',
    );

    // Switching language updates title and user-chip aria-label.
    m.doc.getElementById("lang-toggle").click();
    expect(m.doc.getElementById("user-chip").getAttribute("aria-label")).toBe(
      "Alice としてサインイン中",
    );
    expect(m.doc.title).toContain("検索結果");
  });

  test("Recent view honors sorting, Grid view keeps sort bar and shows path/size, and Grid supports ArrowRight/ArrowLeft", async () => {
    const m = await mount();
    const recentBtn = m.doc.navButtons.find(
      (b) => b.getAttribute("data-nav") === "recent",
    )!;
    const nameSort = m.doc.sortButtons.find(
      (b) => b.getAttribute("data-sort") === "name",
    )!;

    recentBtn.click();
    expect(m.doc.title).toBe("Recent — Takos Storage");
    const byUploaded = m.ctrl.items().map((i) => i.name);
    nameSort.click();
    const byName = m.ctrl.items().map((i) => i.name);
    expect(byName).not.toEqual(byUploaded);
    expect(byName[0]).toBe("alpha.txt");

    // Grid view keeps #list-head visible with .as-grid and renders .card-sub for nested files.
    const gridBtn = m.doc.viewButtons.find(
      (b) => b.getAttribute("data-view") === "grid",
    )!;
    gridBtn.click();
    expect(m.doc.getElementById("list-head").hidden).toBe(false);
    expect(
      m.doc.getElementById("list-head").classList.contains("as-grid"),
    ).toBe(true);
    const cardsHtml = m.doc
      .getElementById("cards")
      .children.map((c) => c.innerHTML)
      .join("\n");
    expect(cardsHtml).toContain('<div class="card-sub" title="Documents/">');

    // ArrowRight / ArrowLeft navigate grid cards.
    m.doc.getElementById("main").focus();
    const cardLinks = m.doc
      .getElementById("cards")
      .querySelectorAll(".row-link");
    m.doc.dispatchDoc("keydown", { key: "ArrowRight" });
    expect(m.doc.activeElement).toBe(cardLinks[0]!);
    m.doc.dispatchDoc("keydown", { key: "ArrowRight" });
    expect(m.doc.activeElement).toBe(cardLinks[1]!);
    m.doc.dispatchDoc("keydown", { key: "ArrowLeft" });
    expect(m.doc.activeElement).toBe(cardLinks[0]!);
  });

  test("preview handles SVG safely without blob URL, falls back on img error, makes text <pre> focusable, and navigates prev/next via buttons & arrows", async () => {
    const m = await mount();
    const svgItem = m.ctrl.items().find((i) => i.name === "logo.svg")!;
    const opener = m.doc.createElement("button");
    opener.focus();

    m.ctrl.openPreview(svgItem, opener);
    expect(m.getObjectUrlCalls()).toBe(0);
    expect(
      m.doc
        .getElementById("preview-body")
        .children[0]?.children.map((c) => c.textContent),
    ).toEqual(["No preview available.", "Download"]);
    expect(m.doc.getElementById("preview-nav").hidden).toBe(false);

    // Step to next file via ArrowRight (preserves opener).
    const beforeName = m.doc.getElementById("preview-name").textContent;
    m.doc.dispatchDoc("keydown", { key: "ArrowRight" });
    const afterName = m.doc.getElementById("preview-name").textContent;
    expect(afterName).not.toBe(beforeName);

    // Escape restores focus to original opener (guarded against IME).
    m.doc.dispatchDoc("keydown", { key: "Escape", isComposing: true });
    expect(m.doc.getElementById("preview").classList.contains("open")).toBe(
      true,
    );
    m.doc.dispatchDoc("keydown", { key: "Escape", isComposing: false });
    expect(m.doc.getElementById("preview").classList.contains("open")).toBe(
      false,
    );
    expect(m.doc.activeElement).toBe(opener);

    // Raster image error triggers previewReadFailed fallback with Retry.
    const pngItem = m.ctrl.items().find((i) => i.name === "pic.png")!;
    m.ctrl.openPreview(pngItem);
    await until(
      () => m.doc.getElementById("preview-body").children[0]?.tagName === "IMG",
    );
    m.doc.getElementById("preview-body").children[0]!.dispatch("error");
    expect(
      m.doc
        .getElementById("preview-body")
        .children[0]?.children.map((c) => c.textContent),
    ).toEqual(["Couldn't load the preview.", "Retry", "Download"]);
    m.ctrl.closePreview(false);

    // Text preview renders focusable <pre role="region">.
    const txtItem = m.ctrl.items().find((i) => i.name === "alpha.txt")!;
    m.ctrl.openPreview(txtItem);
    await until(
      () => m.doc.getElementById("preview-body").children[0]?.tagName === "PRE",
    );
    const pre = m.doc.getElementById("preview-body").children[0]!;
    expect(pre.tabIndex).toBe(0);
    expect(pre.getAttribute("role")).toBe("region");
    expect(pre.getAttribute("aria-label")).toContain("alpha.txt");
    m.ctrl.closePreview(false);
  });

  test("empty states provide CTAs, inline name dialog rejects dot/backslash, folder from Recent switches view with toast, upload reports 412/413, and dialog IME/focus work", async () => {
    const emptyDrive = await mount({ empty: true });
    expect(emptyDrive.doc.getElementById("state").innerHTML).toContain(
      "<h2>Your drive is empty</h2>",
    );
    const emptyBtns = emptyDrive.doc
      .getElementById("state")
      .all()
      .filter((el) => el.tagName === "BUTTON");
    expect(emptyBtns.map((b) => b.textContent)).toEqual([
      "Upload files",
      "New folder",
    ]);

    // Empty Recent has dedicated copy & Upload CTA.
    emptyDrive.doc.navButtons
      .find((b) => b.getAttribute("data-nav") === "recent")!
      .click();
    expect(emptyDrive.doc.getElementById("state").innerHTML).toContain(
      "No recent files",
    );

    const m = await mount();
    // Name dialog inline validation for "." / ".." / "\" and IME Enter guard.
    m.ctrl.setNameMode("folder");
    const nameInput = m.doc.getElementById("name-input");
    const nameForm = m.doc.getElementById("name-form");
    const nameError = m.doc.getElementById("name-error");
    expect(
      nameInput.dispatch("keydown", { key: "Enter", isComposing: true }),
    ).toBe(true);
    nameInput.value = "..";
    expect(nameForm.dispatch("submit")).toBe(true);
    expect(nameError.hidden).toBe(false);
    nameInput.value = "a\\b";
    expect(nameForm.dispatch("submit")).toBe(true);
    expect(nameError.hidden).toBe(false);

    // Creating a folder while in Recent switches back to My Drive and toasts.
    m.ctrl.state.nav = "recent";
    nameInput.value = "BrandNew";
    expect(nameForm.dispatch("submit")).toBe(false);
    await until(
      () =>
        !m.ctrl.state.loading &&
        m.ctrl.items().some((i) => i.name === "BrandNew"),
    );
    expect(m.ctrl.state.nav).toBe("files");
    expect(m.doc.getElementById("toast").textContent).toBe("Folder created.");

    // Upload 413 shows "Too large" and specific toast.
    m.setPutStatus(413);
    m.ctrl.uploadFiles([new File(["x"], "huge.bin")]);
    await until(
      () =>
        m.doc.getElementById("tray-list").querySelector(".tray-status")
          ?.textContent === "Too large",
    );
    expect(m.doc.getElementById("toast").textContent).toContain("too large");

    // Folder result dialog restores focus to opener on close.
    const trigger = m.doc.createElement("button");
    trigger.focus();
    m.ctrl.folderResult({ completed: [], remaining: ["x"] }, true);
    m.doc.activeElement = m.doc.body;
    m.doc.getElementById("folder-result-dialog").close();
    expect(m.doc.activeElement).toBe(trigger);
  });
});

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

class MemoryBucket implements R2Bucket {
  objects = new Map<
    string,
    { bytes: Uint8Array; etag: string; type: string }
  >();
  seq = 0;

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
    if (selector === '[role="menuitem"]') {
      return descendants.filter((el) => el.getAttribute("role") === "menuitem");
    }
    if (selector.startsWith(".menu-item")) {
      return descendants.filter((el) => {
        if (!el.classes.has("menu-item")) return false;
        if (selector.includes(":not([hidden])") && el.hidden) return false;
        if (selector.includes(":not([disabled])") && el.disabled) return false;
        return true;
      });
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

class FakeDoc {
  nodes = new Map<string, FakeEl>();
  activeElement: FakeEl | null = null;
  docListeners = new Map<string, Array<{ fn: Listener; capture: boolean }>>();
  documentElement = { lang: "en", dataset: { theme: "light" } };
  sortButtons: FakeEl[] = [];

  constructor() {
    for (const key of ["name", "size", "uploaded"]) {
      const btn = new FakeEl(this, "BUTTON");
      btn.setAttribute("data-sort", key);
      btn.classes.add("sortable");
      this.sortButtons.push(btn);
    }
    const newMenu = this.getElementById("new-menu");
    for (const action of ["upload", "folder"]) {
      const item = new FakeEl(this, "BUTTON");
      item.setAttribute("role", "menuitem");
      item.setAttribute("data-new", action);
      item.classes.add("menu-item");
      newMenu.appendChild(item);
    }
    const itemMenu = this.getElementById("item-menu");
    for (const action of ["open", "download", "rename", "delete"]) {
      const item = new FakeEl(this, "BUTTON");
      item.setAttribute("role", "menuitem");
      item.setAttribute("data-action", action);
      item.classes.add("menu-item");
      itemMenu.appendChild(item);
    }
  }

  getElementById = (id: string): FakeEl => {
    if (!this.nodes.has(id)) {
      const tag = id === "q" || id === "name-input" ? "INPUT" : "DIV";
      this.nodes.set(id, new FakeEl(this, tag));
    }
    return this.nodes.get(id)!;
  };

  querySelector = () => null;
  querySelectorAll = (selector: string): FakeEl[] => {
    if (selector === "[data-sort]") return this.sortButtons;
    return [];
  };

  addEventListener = (type: string, fn: Listener, capture = false) => {
    this.docListeners.set(type, [
      ...(this.docListeners.get(type) ?? []),
      { fn, capture: Boolean(capture) },
    ]);
  };

  dispatchDoc = (type: string, extra: Record<string, unknown> = {}) => {
    let stopped = false;
    const all = this.docListeners.get(type) ?? [];
    const ordered = [
      ...all.filter((entry) => entry.capture),
      ...all.filter((entry) => !entry.capture),
    ];
    for (const entry of ordered) {
      if (stopped) break;
      entry.fn({
        preventDefault() {},
        stopPropagation() {
          stopped = true;
        },
        ...extra,
      });
    }
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

async function mount(opts: { failList?: boolean } = {}) {
  const bucket = new MemoryBucket();
  await bucket.put("drive/empty-dir/", "", {
    httpMetadata: { contentType: "application/x-directory" },
  });
  await bucket.put("drive/note.txt", "hello storage", {
    httpMetadata: { contentType: "text/plain" },
  });
  await bucket.put(`drive/a"b'c<d>&e.txt`, "special chars", {
    httpMetadata: { contentType: "text/plain" },
  });
  const env: Env = { BUCKET: bucket, ALLOW_UNAUTHENTICATED_DRIVE: "1" };
  const doc = new FakeDoc();
  let failList = opts.failList ?? false;
  let listCalls = 0;
  let writeCalls = 0;

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
    location: { pathname: "/", search: "", href: "" },
    fetch: async (path: string, init?: RequestInit) => {
      if (path.startsWith("/api/drive/list")) {
        listCalls += 1;
        if (failList) return new Response("unavailable", { status: 503 });
      }
      if (init?.method && init.method !== "GET") writeCalls += 1;
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
      `\n  globalThis.ctrl = { state: state, openItem: openItem, openPreview: openPreview, closePreview: closePreview, items: visibleItems, setNameMode: function(m) { nameMode = m; } };\n  boot();`,
    ),
    context,
  );
  const ctrl = context.ctrl as {
    state: {
      loading: boolean;
      failed: boolean;
      path: string;
      query: string;
    };
    openItem: (item: unknown) => void;
    openPreview: (item: unknown) => void;
    closePreview: (restore?: boolean) => void;
    items: () => Array<{ name: string; path: string; type: string }>;
    setNameMode: (mode: string) => void;
  };
  await until(() => !ctrl.state.loading);
  return {
    doc,
    ctrl,
    setFailList: (v: boolean) => {
      failList = v;
    },
    getListCalls: () => listCalls,
    getWriteCalls: () => writeCalls,
  };
}

describe("Takos Storage Wave 1 UI/UX improvements", () => {
  test("HTML includes skip link, mobile nav strip, labelled search/dialogs, preview dialog role, and localized close controls", () => {
    const html = storageConsoleHtml();
    expect(html).toContain('class="skip-link" href="#main"');
    expect(html).toContain('<main id="main" tabindex="-1">');
    expect(html).toContain('<nav class="mobile-nav"');
    expect(html).toContain('id="mobile-usage-text"');
    expect(html).toContain('id="q" name="q" type="search"');
    expect(html).toContain('id="q-clear"');
    expect(html).toContain('id="refresh-btn"');
    expect(html).toContain(
      '<dialog id="name-dialog" aria-labelledby="name-dialog-title">',
    );
    expect(html).toContain('<label for="name-input" id="name-input-label">');
    expect(html).toContain('id="name-error" role="alert"');
    expect(html).toContain(
      '<dialog id="delete-dialog" aria-labelledby="delete-title">',
    );
    expect(html).toContain(
      '<div class="preview" id="preview" role="dialog" aria-modal="true" aria-labelledby="preview-name" tabindex="-1">',
    );
    expect(html).toContain('id="preview-close" data-i18n-label="close"');
    expect(html).toContain('id="tray-close" data-i18n-label="close"');
    expect(html).not.toContain("aria-sort");
    expect(html).toContain(
      'data-sort="uploaded" aria-pressed="true" aria-label="Last modified, sorted descending"',
    );
    expect(html).toContain(
      '<nav class="mobile-nav" data-i18n-label="navLabel" aria-label="Drive navigation">',
    );
    expect(html).toContain(
      '<nav id="side-nav" data-i18n-label="navLabel" aria-label="Drive navigation">',
    );
    expect(html).toContain(
      'id="mobile-usage-truncated" hidden role="img" data-i18n-label="usageTruncated"',
    );
    expect(html).toMatch(/\.toast\s*\{[^}]*z-index:\s*80;/u);
  });

  test("list load failure shows an inline Retry button that recovers on click", async () => {
    const m = await mount({ failList: true });
    expect(m.ctrl.state.failed).toBe(true);
    const stateEl = m.doc.getElementById("state");
    const retryBtn = stateEl
      .all()
      .find((el) => el.tagName === "BUTTON" && el.textContent === "Retry");
    expect(retryBtn).toBeDefined();

    m.setFailList(false);
    retryBtn!.click();
    await until(() => !m.ctrl.state.loading);
    expect(m.ctrl.state.failed).toBe(false);
    expect(m.ctrl.items().some((item) => item.name === "note.txt")).toBe(true);
  });

  test("empty subfolder shows folder-specific empty copy instead of empty drive copy", async () => {
    const m = await mount();
    const folder = m.ctrl.items().find((item) => item.name === "empty-dir");
    expect(folder).toBeDefined();
    m.ctrl.openItem(folder);
    expect(m.ctrl.state.path).toBe("empty-dir/");
    expect(m.doc.getElementById("state").innerHTML).toContain(
      "This folder is empty",
    );
    expect(m.doc.getElementById("state").innerHTML).not.toContain(
      "Your drive is empty",
    );
  });

  test("name dialog validates blank and slash names inline without closing or writing", async () => {
    const m = await mount();
    m.ctrl.setNameMode("folder");
    const input = m.doc.getElementById("name-input");
    const form = m.doc.getElementById("name-form");
    const errorEl = m.doc.getElementById("name-error");

    input.value = "   ";
    expect(form.dispatch("submit")).toBe(true);
    expect(errorEl.hidden).toBe(false);
    expect(errorEl.textContent).toBe("Enter a name.");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(m.getWriteCalls()).toBe(0);

    input.value = "bad/name";
    expect(form.dispatch("submit")).toBe(true);
    expect(errorEl.hidden).toBe(false);
    expect(errorEl.textContent).toBe('Names can\'t contain "/".');
    expect(m.getWriteCalls()).toBe(0);

    input.dispatch("input");
    expect(errorEl.hidden).toBe(true);
    expect(input.getAttribute("aria-invalid")).toBeNull();
  });

  test("preview marks app/fab/tray inert (keeping toast active), restores opener or falls back to main", async () => {
    const m = await mount();
    const opener = m.doc.createElement("button");
    opener.focus();
    const note = m.ctrl.items().find((item) => item.name === "note.txt");
    expect(note).toBeDefined();

    m.ctrl.openPreview(note);
    expect(m.doc.getElementById("app").inert).toBe(true);
    expect(m.doc.getElementById("fab").inert).toBe(true);
    expect(m.doc.getElementById("tray").inert).toBe(true);
    expect(m.doc.getElementById("toast").inert).toBe(false);
    expect(m.doc.activeElement).toBe(m.doc.getElementById("preview-close"));

    m.ctrl.closePreview(true);
    expect(m.doc.getElementById("app").inert).toBe(false);
    expect(m.doc.getElementById("fab").inert).toBe(false);
    expect(m.doc.getElementById("tray").inert).toBe(false);
    expect(m.doc.activeElement).toBe(opener);

    // If opener is detached before close, focus falls back to #main.
    const detached = m.doc.createElement("button");
    detached.focus();
    m.ctrl.openPreview(note);
    detached.isConnected = false;
    m.ctrl.closePreview(true);
    expect(m.doc.activeElement).toBe(m.doc.getElementById("main"));
  });

  test("sort buttons use aria-pressed + localized aria-label without aria-sort", async () => {
    const m = await mount();
    const [nameBtn, sizeBtn, uploadedBtn] = m.doc.sortButtons;
    expect(uploadedBtn!.getAttribute("aria-sort")).toBeNull();
    expect(uploadedBtn!.getAttribute("aria-pressed")).toBe("true");
    expect(uploadedBtn!.getAttribute("aria-label")).toBe(
      "Last modified, sorted descending",
    );
    expect(nameBtn!.getAttribute("aria-pressed")).toBe("false");
    expect(nameBtn!.getAttribute("aria-label")).toBe("Sort by Name");

    nameBtn!.click();
    expect(nameBtn!.getAttribute("aria-pressed")).toBe("true");
    expect(nameBtn!.getAttribute("aria-label")).toBe("Name, sorted ascending");
    expect(uploadedBtn!.getAttribute("aria-pressed")).toBe("false");
    expect(sizeBtn!.getAttribute("aria-sort")).toBeNull();

    nameBtn!.click();
    expect(nameBtn!.getAttribute("aria-label")).toBe("Name, sorted descending");
  });

  test("search clear button, Escape IME guard, / guards, refresh button, and escaped kebab labels work", async () => {
    const m = await mount();
    const rowsHtml = m.doc
      .getElementById("rows")
      .children.map((row) => row.innerHTML)
      .join("\n");
    expect(rowsHtml).toContain('aria-label="More actions for note.txt"');
    expect(rowsHtml).toContain(
      'aria-label="More actions for a&quot;b&#39;c&lt;d&gt;&amp;e.txt"',
    );

    const q = m.doc.getElementById("q");
    const qClear = m.doc.getElementById("q-clear");
    q.value = "note";
    q.dispatch("input");
    expect(qClear.hidden).toBe(false);
    qClear.click();
    expect(q.value).toBe("");
    expect(qClear.hidden).toBe(true);
    expect(m.doc.activeElement).toBe(q);

    // Escape during IME composition must NOT clear #q.
    q.value = "note";
    q.dispatch("keydown", { key: "Escape", isComposing: true });
    expect(q.value).toBe("note");
    q.dispatch("keydown", { key: "Escape", keyCode: 229 });
    expect(q.value).toBe("note");
    q.dispatch("keydown", { key: "Escape", isComposing: false, keyCode: 27 });
    expect(q.value).toBe("");

    // "/" shortcut respects modifier, IME, and open menu guards.
    const other = m.doc.createElement("button");
    other.focus();
    m.doc.dispatchDoc("keydown", { key: "/", ctrlKey: true });
    m.doc.dispatchDoc("keydown", { key: "/", metaKey: true });
    m.doc.dispatchDoc("keydown", { key: "/", altKey: true });
    m.doc.dispatchDoc("keydown", { key: "/", isComposing: true });
    expect(m.doc.activeElement).toBe(other);

    m.doc.getElementById("new-menu").classList.add("open");
    m.doc.dispatchDoc("keydown", { key: "/" });
    expect(m.doc.activeElement).toBe(other);
    m.doc.getElementById("new-menu").classList.remove("open");

    m.doc.getElementById("item-menu").classList.add("open");
    m.doc.dispatchDoc("keydown", { key: "/" });
    expect(m.doc.activeElement).toBe(other);
    m.doc.getElementById("item-menu").classList.remove("open");

    m.doc.dispatchDoc("keydown", { key: "/" });
    expect(m.doc.activeElement).toBe(q);

    const beforeRefresh = m.getListCalls();
    m.doc.getElementById("refresh-btn").click();
    await until(
      () => m.getListCalls() > beforeRefresh && !m.ctrl.state.loading,
    );
    expect(m.getListCalls()).toBe(beforeRefresh + 1);
  });

  test("floating menus support arrow/Home/End nav, close on Tab, toggle on kebab click, and pass kebab trigger to preview", async () => {
    const m = await mount();
    const newBtn = m.doc.getElementById("new-btn");
    const newMenu = m.doc.getElementById("new-menu");
    const newItems = newMenu.querySelectorAll('[role="menuitem"]');
    expect(newItems).toHaveLength(2);

    newBtn.click();
    expect(newMenu.classList.contains("open")).toBe(true);
    expect(m.doc.activeElement).toBe(newItems[0]!);

    newMenu.dispatch("keydown", { key: "ArrowDown" });
    expect(m.doc.activeElement).toBe(newItems[1]!);
    newMenu.dispatch("keydown", { key: "Home" });
    expect(m.doc.activeElement).toBe(newItems[0]!);
    newMenu.dispatch("keydown", { key: "End" });
    expect(m.doc.activeElement).toBe(newItems[1]!);
    newMenu.dispatch("keydown", { key: "ArrowUp" });
    expect(m.doc.activeElement).toBe(newItems[0]!);

    // Tab closes the open floating menu.
    newMenu.dispatch("keydown", { key: "Tab" });
    expect(newMenu.classList.contains("open")).toBe(false);
    expect(newBtn.getAttribute("aria-expanded")).toBe("false");

    // Kebab opens item-menu, clicking same kebab toggles it closed, and Open -> Preview restores focus to kebab.
    const noteIndex = m.ctrl
      .items()
      .findIndex((item) => item.name === "note.txt");
    expect(noteIndex).toBeGreaterThanOrEqual(0);
    const kebab = m.doc.createElement("button");
    kebab.classes.add("kebab");
    kebab.setAttribute("data-item", String(noteIndex));
    const itemMenu = m.doc.getElementById("item-menu");

    m.doc.dispatchDoc("click", { target: kebab });
    expect(itemMenu.classList.contains("open")).toBe(true);
    expect(kebab.getAttribute("aria-expanded")).toBe("true");

    // Second click on same kebab toggles menu closed and restores focus to kebab.
    m.doc.dispatchDoc("click", { target: kebab });
    expect(itemMenu.classList.contains("open")).toBe(false);
    expect(kebab.getAttribute("aria-expanded")).toBe("false");
    expect(m.doc.activeElement).toBe(kebab);

    // Reopen item-menu and click Open -> Preview opens and closing restores focus to kebab.
    m.doc.dispatchDoc("click", { target: kebab });
    const openAction = itemMenu.querySelector('[data-action="open"]');
    expect(openAction).not.toBeNull();
    openAction!.click();
    expect(m.doc.getElementById("preview").classList.contains("open")).toBe(
      true,
    );
    expect(m.doc.getElementById("tray").inert).toBe(true);
    m.ctrl.closePreview(true);
    expect(m.doc.activeElement).toBe(kebab);
  });
});

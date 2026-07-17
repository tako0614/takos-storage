/**
 * The workspace drive UI served at `/` and `/ui`.
 *
 * A self-contained, dependency-free HTML page shaped like a drive-style file
 * manager over the session-authenticated `/api/drive` surface: open the app,
 * sign in with Takosumi Accounts (when APP_AUTH_REQUIRED is on), and browse
 * the workspace's shared drive — folders over "/"-separated paths, upload /
 * download / preview / rename / delete, list & grid views, client-side
 * search, and an upload tray. Strings ship in en/ja; theme follows the
 * shared `takos-theme` key. App-to-app access stays on the `/o` token API
 * and never flows through this page.
 */

const CATALOGS = {
  en: {
    signinRedirect: "Redirecting to sign-in…",
    authBroken: "Sign-in is not configured for this service.",
    logout: "Sign out",
    searchPlaceholder: "Search in Drive",
    toggleTheme: "Toggle theme",
    newButton: "New",
    actionUpload: "Upload files",
    actionNewFolder: "New folder",
    navFiles: "My Drive",
    navRecent: "Recent",
    usage: "{count} files · {size}",
    usageTruncated: "Showing the first 1000 files only.",
    home: "My Drive",
    headingRecent: "Recent",
    headingResults: "Search results",
    viewList: "List view",
    viewGrid: "Grid view",
    colName: "Name",
    colSize: "Size",
    colUpdated: "Last modified",
    folder: "Folder",
    folderCount: "{count} items",
    itemMenu: "More actions",
    menuDownload: "Download",
    menuRename: "Rename",
    menuDelete: "Delete",
    menuOpen: "Open",
    renameTitle: "Rename",
    renameLabel: "New name",
    newFolderTitle: "New folder",
    newFolderLabel: "Folder name",
    nameInvalid: 'Names can\'t contain "/".',
    save: "OK",
    cancel: "Cancel",
    deleteTitle: "Delete forever?",
    deleteBody: "“{name}” will be deleted forever. This can’t be undone.",
    deleteFolderBody:
      "“{name}” and the {count} files inside will be deleted forever. This can’t be undone.",
    deleteConfirm: "Delete",
    renameFolderBody:
      "{count} files will be copied to the new name and removed.",
    loading: "Loading…",
    emptyTitle: "Your drive is empty",
    emptyBody: "Drop files here or use “New” to upload.",
    emptySearchTitle: "No matching files",
    emptySearchBody: "Try a different search term.",
    errLoad: "Couldn't load your files.",
    errUpload: "Upload failed: {name}",
    errAction: "The operation failed.",
    upTrayTitle: "Uploads",
    upDone: "Done",
    upFailed: "Failed",
    previewNone: "No preview available.",
    previewTooBig: "Too large to preview.",
    download: "Download",
    dropHint: "Drop files to upload",
    justNow: "just now",
    minAgo: "{n}m ago",
    hourAgo: "{n}h ago",
    dayAgo: "{n}d ago",
  },
  ja: {
    signinRedirect: "サインインへ移動しています…",
    authBroken: "このサービスのサインインが設定されていません。",
    logout: "ログアウト",
    searchPlaceholder: "ドライブ内を検索",
    toggleTheme: "テーマを切り替え",
    newButton: "新規",
    actionUpload: "ファイルをアップロード",
    actionNewFolder: "新しいフォルダ",
    navFiles: "マイドライブ",
    navRecent: "最近",
    usage: "{count} 個のファイル · {size}",
    usageTruncated: "先頭 1000 件のみ表示しています。",
    home: "マイドライブ",
    headingRecent: "最近",
    headingResults: "検索結果",
    viewList: "リスト表示",
    viewGrid: "ギャラリー表示",
    colName: "名前",
    colSize: "サイズ",
    colUpdated: "最終更新",
    folder: "フォルダ",
    folderCount: "{count} 件",
    itemMenu: "その他の操作",
    menuDownload: "ダウンロード",
    menuRename: "名前を変更",
    menuDelete: "削除",
    menuOpen: "開く",
    renameTitle: "名前を変更",
    renameLabel: "新しい名前",
    newFolderTitle: "新しいフォルダ",
    newFolderLabel: "フォルダ名",
    nameInvalid: "名前に「/」は使えません。",
    save: "OK",
    cancel: "キャンセル",
    deleteTitle: "完全に削除しますか？",
    deleteBody: "「{name}」を完全に削除します。この操作は元に戻せません。",
    deleteFolderBody:
      "「{name}」と中の {count} 件のファイルを完全に削除します。この操作は元に戻せません。",
    deleteConfirm: "削除",
    renameFolderBody:
      "{count} 件のファイルを新しい名前へコピーして削除します。",
    loading: "読み込み中…",
    emptyTitle: "ドライブはまだ空です",
    emptyBody:
      "ここにファイルをドロップするか、「新規」からアップロードしてください。",
    emptySearchTitle: "一致するファイルはありません",
    emptySearchBody: "別のキーワードで検索してください。",
    errLoad: "ファイルを読み込めませんでした。",
    errUpload: "アップロードに失敗: {name}",
    errAction: "操作に失敗しました。",
    upTrayTitle: "アップロード",
    upDone: "完了",
    upFailed: "失敗",
    previewNone: "プレビューできない形式です。",
    previewTooBig: "サイズが大きいためプレビューできません。",
    download: "ダウンロード",
    dropHint: "ドロップしてアップロード",
    justNow: "たった今",
    minAgo: "{n}分前",
    hourAgo: "{n}時間前",
    dayAgo: "{n}日前",
  },
} as const;

function svg(paths: string, size = 20): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

const ICON_PLUS = '<path d="M12 5v14"/><path d="M5 12h14"/>';
const ICON_SEARCH = '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>';
const ICON_LIST =
  '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>';
const ICON_GRID =
  '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>';
const ICON_SUN =
  '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
const ICON_MOON = '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>';
const ICON_FOLDER =
  '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.2 3.9A2 2 0 0 0 7.5 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>';
const ICON_FILE =
  '<path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z"/>';
const ICON_UPLOAD =
  '<path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 21h14"/>';
const ICON_CLOCK = '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>';
const ICON_HDD =
  '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 14h18"/><path d="M7 18h.01"/>';

export function storageConsoleHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Takos Storage</title>
<script>
  // Apply the shared suite theme before paint (no flash).
  (function () {
    try {
      var s = localStorage.getItem("takos-theme");
      var dark = s ? s === "dark"
        : (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
    } catch (e) { document.documentElement.dataset.theme = "light"; }
  })();
</script>
<style>
  :root {
    color-scheme: light;
    --bg: #f6f8fc;
    --panel: #ffffff;
    --text: #1f1f1f;
    --text-soft: #5f6368;
    --text-faint: #80868b;
    --line: #e3e7ee;
    --hover: #eef1f6;
    --active-pill: #dbe9fb;
    --active-text: #0b57d0;
    --accent: #7c3aed;
    --focus: #7c3aed;
    --shadow: 0 1px 2px rgba(60,64,67,.14), 0 1px 6px rgba(60,64,67,.12);
    --shadow-lg: 0 4px 8px rgba(60,64,67,.18), 0 8px 24px rgba(60,64,67,.14);
  }
  [data-theme="dark"] {
    color-scheme: dark;
    --bg: #0f1115;
    --panel: #161a22;
    --text: #e5e7eb;
    --text-soft: #9ca3af;
    --text-faint: #6b7280;
    --line: #262b36;
    --hover: #20262f;
    --active-pill: rgba(139,92,246,.24);
    --active-text: #c4b5fd;
    --accent: #a78bfa;
    --shadow: 0 1px 2px rgba(0,0,0,.5), 0 1px 6px rgba(0,0,0,.4);
    --shadow-lg: 0 4px 12px rgba(0,0,0,.55), 0 10px 28px rgba(0,0,0,.45);
  }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  html, body { height: 100%; }
  body {
    margin: 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Hiragino Sans", "Noto Sans JP", sans-serif;
    background: var(--bg); color: var(--text);
    display: flex; flex-direction: column;
  }
  a { color: inherit; }
  button { font: inherit; color: inherit; }
  :is(button, input, .row-link):focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }

  /* ---- Boot splash (auth redirect / hard errors) ---- */
  .splash { flex: 1; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .splash-card {
    display: flex; flex-direction: column; align-items: center; gap: 14px;
    color: var(--text-soft); font-size: 14px; text-align: center;
  }

  /* ---- App chrome ---- */
  .mark {
    width: 30px; height: 30px; border-radius: 8px; flex-shrink: 0;
    background: linear-gradient(135deg, #7c3aed, #a78bfa);
    display: inline-flex; align-items: center; justify-content: center; color: #fff;
  }
  header.app {
    display: flex; align-items: center; gap: 16px;
    padding: 10px 20px; flex-shrink: 0;
  }
  .brand { display: flex; align-items: center; gap: 10px; font-size: 19px; text-decoration: none; flex-shrink: 0; }
  .brand b { font-weight: 600; }
  .search { position: relative; flex: 1; max-width: 720px; }
  .search .search-icon { position: absolute; left: 16px; top: 50%; transform: translateY(-50%); color: var(--text-soft); pointer-events: none; display: inline-flex; }
  .search input {
    width: 100%; padding: 12px 18px 12px 48px; font-size: 15px; color: var(--text);
    border: none; border-radius: 999px; outline: none; background: #e9eef6;
  }
  [data-theme="dark"] .search input { background: #20262f; }
  .search input::placeholder { color: var(--text-soft); }
  .search input:focus { background: var(--panel); box-shadow: var(--shadow); }
  .header-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  .user-chip {
    display: inline-flex; align-items: center; gap: 8px; max-width: 260px;
    font-size: 13px; color: var(--text-soft); white-space: nowrap;
  }
  .user-chip .user-name { overflow: hidden; text-overflow: ellipsis; }
  .avatar {
    width: 30px; height: 30px; border-radius: 50%; flex-shrink: 0;
    background: var(--active-pill); color: var(--active-text);
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 13px; font-weight: 600;
  }
  .icon-btn {
    display: inline-flex; align-items: center; justify-content: center;
    width: 40px; height: 40px; border-radius: 50%; border: none;
    background: transparent; color: var(--text-soft); cursor: pointer;
  }
  .icon-btn:hover { background: var(--hover); color: var(--text); }
  .text-btn {
    border: none; background: transparent; color: var(--active-text);
    font-size: 13px; cursor: pointer; padding: 6px 10px; border-radius: 8px; white-space: nowrap;
  }
  .text-btn:hover { background: var(--hover); }

  .layout { display: flex; flex: 1; min-height: 0; }
  aside {
    width: 244px; flex-shrink: 0; padding: 4px 12px 16px 16px;
    display: flex; flex-direction: column; gap: 4px; overflow-y: auto;
  }
  .new-btn {
    display: inline-flex; align-items: center; gap: 12px; align-self: flex-start;
    margin: 4px 0 14px; padding: 0 22px 0 16px; height: 54px;
    border: none; border-radius: 16px; cursor: pointer;
    background: var(--panel); color: var(--text); font-size: 15px; font-weight: 500;
    box-shadow: var(--shadow);
  }
  .new-btn:hover { box-shadow: var(--shadow-lg); }
  .nav-item {
    display: flex; align-items: center; gap: 14px; width: 100%;
    padding: 8px 16px; border: none; border-radius: 999px; cursor: pointer;
    background: transparent; font-size: 14px; text-align: left; color: var(--text);
  }
  .nav-item:hover { background: var(--hover); }
  .nav-item[aria-pressed="true"] { background: var(--active-pill); color: var(--active-text); font-weight: 600; }
  .nav-icon { display: inline-flex; color: var(--text-soft); }
  .nav-item[aria-pressed="true"] .nav-icon { color: var(--active-text); }
  .usage { margin-top: auto; padding: 14px 16px 0; font-size: 12px; color: var(--text-soft); display: flex; flex-direction: column; gap: 4px; }
  .usage .usage-line { display: flex; align-items: center; gap: 8px; }
  .usage .warn { color: #d97706; }

  main {
    flex: 1; min-width: 0; margin: 0 16px 16px 4px; padding: 8px 8px 24px;
    background: var(--panel); border-radius: 16px; overflow-y: auto; position: relative;
  }
  .main-head {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 16px 6px; position: sticky; top: 0; background: var(--panel);
    border-radius: 16px 16px 0 0; z-index: 5; min-height: 52px;
  }
  .crumbs { display: flex; align-items: center; gap: 2px; flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; font-size: 20px; }
  .crumb { border: none; background: transparent; cursor: pointer; font-size: 20px; color: var(--text-soft); padding: 4px 8px; border-radius: 8px; max-width: 240px; overflow: hidden; text-overflow: ellipsis; }
  .crumb:hover { background: var(--hover); color: var(--text); }
  .crumb[aria-current="page"] { color: var(--text); cursor: default; }
  .crumb[aria-current="page"]:hover { background: transparent; }
  .crumb-sep { color: var(--text-faint); font-size: 16px; }
  .view-toggle { display: inline-flex; border: 1px solid var(--line); border-radius: 999px; overflow: hidden; flex-shrink: 0; }
  .seg {
    display: inline-flex; align-items: center; justify-content: center;
    width: 44px; height: 32px; border: none; background: transparent; cursor: pointer; color: var(--text-soft);
  }
  .seg + .seg { border-left: 1px solid var(--line); }
  .seg[aria-pressed="true"] { background: var(--active-pill); color: var(--active-text); }

  .list-head, .row { display: grid; grid-template-columns: minmax(0,1fr) 110px 170px 48px; align-items: center; gap: 8px; }
  .list-head {
    padding: 6px 16px; font-size: 12.5px; color: var(--text-soft); font-weight: 500;
    border-bottom: 1px solid var(--line); position: sticky; top: 52px; background: var(--panel); z-index: 4;
  }
  .list-head .sortable { display: inline-flex; align-items: center; gap: 4px; border: none; background: none; padding: 4px 0; cursor: pointer; color: inherit; font: inherit; font-weight: 500; }
  .list-head .sortable:hover { color: var(--text); }
  .sort-arrow { font-size: 10px; }
  .rows { list-style: none; margin: 0; padding: 0; }
  .row { position: relative; padding: 0 16px; height: 48px; border-bottom: 1px solid var(--line); }
  .row:hover { background: var(--hover); }
  .row-link { position: absolute; inset: 0; border: none; background: transparent; cursor: pointer; border-radius: 4px; z-index: 1; }
  .row-name { display: flex; align-items: center; gap: 12px; min-width: 0; font-size: 14px; }
  .row-name .name-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row-name .name-sub { font-size: 12px; color: var(--text-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row-size, .row-time { font-size: 13px; color: var(--text-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kebab {
    position: relative; z-index: 2; justify-self: end;
    display: inline-flex; align-items: center; justify-content: center;
    width: 34px; height: 34px; border: none; border-radius: 50%;
    background: transparent; color: var(--text-soft); cursor: pointer;
  }
  .kebab:hover { background: color-mix(in srgb, var(--text-soft) 16%, transparent); color: var(--text); }

  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(208px, 1fr)); gap: 14px; padding: 12px 16px; }
  .card {
    position: relative; border: 1px solid var(--line); border-radius: 12px; overflow: hidden;
    background: var(--panel); transition: box-shadow .12s, background .12s;
  }
  .card:hover { background: var(--hover); box-shadow: var(--shadow); }
  .card-thumb {
    height: 110px; display: flex; align-items: center; justify-content: center;
    background: color-mix(in srgb, var(--card-accent, var(--accent)) 9%, var(--bg));
    color: var(--card-accent, var(--accent));
  }
  .card-foot { display: flex; align-items: center; gap: 8px; padding: 10px 6px 10px 12px; }
  .card-meta { flex: 1; min-width: 0; }
  .card-name { font-size: 13.5px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .card-time { font-size: 12px; color: var(--text-soft); margin-top: 1px; }
  .type-icon {
    width: 26px; height: 26px; border-radius: 7px; align-items: center; justify-content: center;
    display: inline-flex; color: #fff; flex-shrink: 0;
  }

  .state { text-align: center; color: var(--text-soft); padding: 64px 24px; }
  .state .state-icon { color: var(--text-faint); margin-bottom: 12px; }
  .state h3 { margin: 0 0 4px; font-size: 16px; font-weight: 500; color: var(--text); }
  .state p { margin: 0; font-size: 13.5px; }

  .float-menu {
    position: fixed; z-index: 50; min-width: 210px; padding: 6px;
    background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
    box-shadow: var(--shadow-lg); display: none; flex-direction: column;
  }
  .float-menu.open { display: flex; }
  .menu-item {
    display: flex; align-items: center; gap: 12px; width: 100%;
    padding: 9px 14px; border: none; border-radius: 8px; background: transparent;
    font-size: 14px; text-align: left; cursor: pointer; color: var(--text);
  }
  .menu-item:hover { background: var(--hover); }
  .menu-item.danger { color: #dc2626; }
  [data-theme="dark"] .menu-item.danger { color: #f87171; }
  .menu-icon { display: inline-flex; color: var(--text-soft); }
  .menu-item.danger .menu-icon { color: inherit; }
  .menu-sep { height: 1px; margin: 5px 8px; background: var(--line); border: none; }

  dialog {
    border: none; border-radius: 16px; padding: 22px 24px; width: min(400px, calc(100vw - 48px));
    background: var(--panel); color: var(--text); box-shadow: var(--shadow-lg);
  }
  dialog::backdrop { background: rgba(15,17,21,.4); }
  dialog h2 { margin: 0 0 14px; font-size: 17px; font-weight: 600; }
  dialog p { margin: 0 0 8px; font-size: 14px; color: var(--text-soft); line-height: 1.5; overflow-wrap: anywhere; }
  dialog input[type="text"] {
    width: 100%; padding: 10px 12px; font-size: 14px; color: var(--text);
    border: 1px solid var(--line); border-radius: 8px; background: var(--bg); outline: none;
  }
  dialog input[type="text"]:focus { border-color: var(--focus); box-shadow: 0 0 0 3px color-mix(in srgb, var(--focus) 18%, transparent); }
  .dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
  .btn {
    padding: 8px 18px; border-radius: 999px; border: none; cursor: pointer;
    font-size: 14px; font-weight: 500; background: transparent; color: var(--active-text);
  }
  .btn:hover { background: var(--hover); }
  .btn.primary { background: var(--active-text); color: var(--panel); }
  .btn.primary:hover { filter: brightness(1.08); }
  .btn.danger { background: #dc2626; color: #fff; }
  .btn.danger:hover { filter: brightness(1.08); }

  /* ---- Preview overlay ---- */
  .preview {
    position: fixed; inset: 0; z-index: 70; background: rgba(10,12,16,.86);
    display: none; flex-direction: column;
  }
  .preview.open { display: flex; }
  .preview-bar { display: flex; align-items: center; gap: 12px; padding: 12px 18px; color: #e5e7eb; }
  .preview-bar .preview-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14.5px; }
  .preview-bar .icon-btn { color: #cbd5e1; }
  .preview-bar .icon-btn:hover { background: rgba(255,255,255,.12); color: #fff; }
  .preview-body { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; padding: 0 24px 24px; }
  .preview-body img { max-width: 100%; max-height: 100%; border-radius: 8px; box-shadow: var(--shadow-lg); }
  .preview-body pre {
    width: min(860px, 100%); max-height: 100%; overflow: auto; margin: 0;
    background: var(--panel); color: var(--text); border-radius: 12px; padding: 18px;
    font-size: 13px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere;
  }
  .preview-body .preview-fallback { color: #cbd5e1; text-align: center; display: flex; flex-direction: column; gap: 14px; align-items: center; }

  /* ---- Upload tray ---- */
  .tray {
    position: fixed; right: 18px; bottom: 18px; z-index: 55; width: min(340px, calc(100vw - 36px));
    background: var(--panel); border: 1px solid var(--line); border-radius: 14px;
    box-shadow: var(--shadow-lg); overflow: hidden; display: none;
  }
  .tray.open { display: block; }
  .tray-head { display: flex; align-items: center; padding: 10px 14px; font-size: 13.5px; font-weight: 600; border-bottom: 1px solid var(--line); }
  .tray-head .spacer { flex: 1; }
  .tray-list { list-style: none; margin: 0; padding: 6px 0; max-height: 240px; overflow-y: auto; }
  .tray-list li { display: flex; align-items: center; gap: 10px; padding: 7px 14px; font-size: 13px; }
  .tray-list .tray-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tray-list .tray-status { font-size: 12px; color: var(--text-soft); flex-shrink: 0; }
  .tray-list .ok { color: #16a34a; } .tray-list .fail { color: #dc2626; }
  .spin {
    width: 14px; height: 14px; border-radius: 50%; flex-shrink: 0;
    border: 2px solid var(--line); border-top-color: var(--accent);
    animation: spin .8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ---- Drop overlay ---- */
  .drop-overlay {
    position: absolute; inset: 8px; z-index: 30; border: 2px dashed var(--accent); border-radius: 14px;
    background: color-mix(in srgb, var(--accent) 8%, var(--panel));
    display: none; align-items: center; justify-content: center;
    color: var(--accent); font-size: 16px; font-weight: 600; pointer-events: none;
  }
  .drop-overlay.active { display: flex; }

  .toast {
    position: fixed; left: 20px; bottom: 20px; z-index: 60;
    padding: 12px 20px; border-radius: 10px; font-size: 14px;
    background: #1f2937; color: #f9fafb; box-shadow: var(--shadow-lg);
    opacity: 0; transform: translateY(8px); transition: opacity .18s, transform .18s;
    pointer-events: none; max-width: min(420px, calc(100vw - 40px));
  }
  [data-theme="dark"] .toast { background: #e5e7eb; color: #111827; }
  .toast.show { opacity: 1; transform: none; }

  .fab {
    display: none; position: fixed; right: 18px; bottom: 18px; z-index: 40;
    width: 56px; height: 56px; border-radius: 16px; border: none; cursor: pointer;
    background: var(--panel); color: var(--active-text); box-shadow: var(--shadow-lg);
    align-items: center; justify-content: center;
  }

  @media (max-width: 820px) {
    aside { display: none; }
    main { margin: 0 10px 10px; }
    .fab { display: inline-flex; }
    header.app { padding: 10px 12px; gap: 8px; }
    .user-chip .user-name { display: none; }
    .brand .brand-text { display: none; }
    .tray { bottom: 84px; }
  }
  @media (max-width: 640px) {
    .list-head, .row { grid-template-columns: minmax(0,1fr) 96px 40px; }
    .list-head .sortable.col-size, .row-size { display: none; }
    .cards { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
    .card-thumb { height: 84px; }
  }
</style>
</head>
<body>
  <!-- ---- Boot splash: shown until the session check settles ---- -->
  <div class="splash" id="splash">
    <div class="splash-card">
      <span class="mark">${svg(ICON_HDD, 17)}</span>
      <span id="splash-text" data-i18n="loading">${CATALOGS.en.loading}</span>
    </div>
  </div>

  <!-- ---- Drive ---- -->
  <div id="app" hidden style="display:flex;flex-direction:column;flex:1;min-height:0">
  <header class="app">
    <a class="brand" href="/"><span class="mark">${svg(ICON_HDD, 17)}</span><span class="brand-text"><b>Takos</b> <span style="color:var(--text-soft);font-weight:400">Storage</span></span></a>
    <div class="search">
      <span class="search-icon">${svg(ICON_SEARCH, 18)}</span>
      <input id="q" type="search" data-i18n-placeholder="searchPlaceholder" placeholder="${CATALOGS.en.searchPlaceholder}" autocomplete="off">
    </div>
    <div class="header-actions">
      <span class="user-chip" id="user-chip" hidden><span class="avatar" id="user-avatar"></span><span class="user-name" id="user-name"></span></span>
      <button type="button" class="text-btn" id="logout" hidden data-i18n="logout">${CATALOGS.en.logout}</button>
      <button id="theme-toggle" class="icon-btn" type="button" data-i18n-label="toggleTheme" aria-label="${CATALOGS.en.toggleTheme}"></button>
    </div>
  </header>

  <div class="layout">
    <aside>
      <button type="button" class="new-btn" id="new-btn" aria-haspopup="menu" aria-expanded="false">
        ${svg(ICON_PLUS, 22)}<span data-i18n="newButton">${CATALOGS.en.newButton}</span>
      </button>
      <nav id="side-nav">
        <button type="button" class="nav-item" data-nav="files" aria-pressed="true">
          <span class="nav-icon">${svg(ICON_FOLDER, 18)}</span><span data-i18n="navFiles">${CATALOGS.en.navFiles}</span>
        </button>
        <button type="button" class="nav-item" data-nav="recent" aria-pressed="false">
          <span class="nav-icon">${svg(ICON_CLOCK, 18)}</span><span data-i18n="navRecent">${CATALOGS.en.navRecent}</span>
        </button>
      </nav>
      <div class="usage">
        <span class="usage-line">${svg(ICON_HDD, 15)}<span id="usage-text"></span></span>
        <span class="usage-line warn" id="usage-truncated" hidden data-i18n="usageTruncated">${CATALOGS.en.usageTruncated}</span>
      </div>
    </aside>

    <main id="main">
      <div class="main-head">
        <nav class="crumbs" id="crumbs" aria-label="Breadcrumb"></nav>
        <div class="view-toggle" role="group">
          <button type="button" class="seg" data-view="list" aria-pressed="true" data-i18n-label="viewList" aria-label="${CATALOGS.en.viewList}">${svg(ICON_LIST, 18)}</button>
          <button type="button" class="seg" data-view="grid" aria-pressed="false" data-i18n-label="viewGrid" aria-label="${CATALOGS.en.viewGrid}">${svg(ICON_GRID, 18)}</button>
        </div>
      </div>

      <div class="list-head" id="list-head">
        <button type="button" class="sortable" data-sort="name"><span data-i18n="colName">${CATALOGS.en.colName}</span><span class="sort-arrow" data-arrow="name"></span></button>
        <button type="button" class="sortable col-size" data-sort="size"><span data-i18n="colSize">${CATALOGS.en.colSize}</span><span class="sort-arrow" data-arrow="size"></span></button>
        <button type="button" class="sortable" data-sort="uploaded"><span data-i18n="colUpdated">${CATALOGS.en.colUpdated}</span><span class="sort-arrow" data-arrow="uploaded">▼</span></button>
        <span></span>
      </div>
      <ul class="rows" id="rows"></ul>
      <div class="cards" id="cards" hidden></div>
      <div class="state" id="state" hidden></div>
      <div class="drop-overlay" id="drop-overlay"><span data-i18n="dropHint">${CATALOGS.en.dropHint}</span></div>
    </main>
  </div>
  </div>

  <button type="button" class="fab" id="fab" data-i18n-label="newButton" aria-label="${CATALOGS.en.newButton}" hidden>${svg(ICON_PLUS, 24)}</button>

  <input type="file" id="file-input" multiple hidden>

  <div class="float-menu" id="new-menu" role="menu">
    <button type="button" role="menuitem" class="menu-item" data-new="upload"><span class="menu-icon">${svg(ICON_UPLOAD, 18)}</span><span data-i18n="actionUpload">${CATALOGS.en.actionUpload}</span></button>
    <button type="button" role="menuitem" class="menu-item" data-new="folder"><span class="menu-icon">${svg(ICON_FOLDER, 18)}</span><span data-i18n="actionNewFolder">${CATALOGS.en.actionNewFolder}</span></button>
  </div>

  <div class="float-menu" id="item-menu" role="menu">
    <button type="button" role="menuitem" class="menu-item" data-action="open"><span class="menu-icon">${svg('<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>', 18)}</span><span data-i18n="menuOpen">${CATALOGS.en.menuOpen}</span></button>
    <button type="button" role="menuitem" class="menu-item" data-action="download"><span class="menu-icon">${svg('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>', 18)}</span><span data-i18n="menuDownload">${CATALOGS.en.menuDownload}</span></button>
    <button type="button" role="menuitem" class="menu-item" data-action="rename"><span class="menu-icon">${svg('<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>', 18)}</span><span data-i18n="menuRename">${CATALOGS.en.menuRename}</span></button>
    <hr class="menu-sep">
    <button type="button" role="menuitem" class="menu-item danger" data-action="delete"><span class="menu-icon">${svg('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>', 18)}</span><span data-i18n="menuDelete">${CATALOGS.en.menuDelete}</span></button>
  </div>

  <dialog id="name-dialog">
    <h2 id="name-dialog-title"></h2>
    <p id="name-dialog-note" hidden></p>
    <form method="dialog" id="name-form">
      <input type="text" id="name-input" autocomplete="off">
      <div class="dialog-actions">
        <button type="button" class="btn" data-close data-i18n="cancel">${CATALOGS.en.cancel}</button>
        <button type="submit" class="btn primary" data-i18n="save">${CATALOGS.en.save}</button>
      </div>
    </form>
  </dialog>

  <dialog id="delete-dialog">
    <h2 data-i18n="deleteTitle">${CATALOGS.en.deleteTitle}</h2>
    <p id="delete-body"></p>
    <div class="dialog-actions">
      <button type="button" class="btn" data-close data-i18n="cancel">${CATALOGS.en.cancel}</button>
      <button type="button" class="btn danger" id="delete-confirm" data-i18n="deleteConfirm">${CATALOGS.en.deleteConfirm}</button>
    </div>
  </dialog>

  <div class="preview" id="preview">
    <div class="preview-bar">
      <span class="preview-name" id="preview-name"></span>
      <button type="button" class="icon-btn" id="preview-download" data-i18n-label="download" aria-label="${CATALOGS.en.download}">${svg('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>', 18)}</button>
      <button type="button" class="icon-btn" id="preview-close" aria-label="Close">${svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', 18)}</button>
    </div>
    <div class="preview-body" id="preview-body"></div>
  </div>

  <div class="tray" id="tray">
    <div class="tray-head"><span data-i18n="upTrayTitle">${CATALOGS.en.upTrayTitle}</span><span class="spacer"></span>
      <button type="button" class="icon-btn" id="tray-close" aria-label="Close" style="width:30px;height:30px">${svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', 15)}</button>
    </div>
    <ul class="tray-list" id="tray-list"></ul>
  </div>

  <div class="toast" id="toast" role="status" aria-live="polite"></div>

<script>
(function () {
  "use strict";
  var I18N = ${JSON.stringify(CATALOGS)};

  // ---- Language ----
  var lang = "en";
  try {
    var storedLang = localStorage.getItem("takos-lang");
    if (storedLang === "ja" || storedLang === "en") lang = storedLang;
    else lang = ((navigator.language || "").toLowerCase().indexOf("ja") === 0) ? "ja" : "en";
  } catch (e) { /* keep en */ }
  function t(key, params) {
    var msg = (I18N[lang] && I18N[lang][key]) || I18N.en[key] || key;
    if (params) {
      Object.keys(params).forEach(function (p) {
        msg = msg.split("{" + p + "}").join(String(params[p]));
      });
    }
    return msg;
  }
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-i18n]").forEach(function (el) {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(function (el) {
    el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder")));
  });
  document.querySelectorAll("[data-i18n-label]").forEach(function (el) {
    el.setAttribute("aria-label", t(el.getAttribute("data-i18n-label")));
    el.setAttribute("title", t(el.getAttribute("data-i18n-label")));
  });

  // ---- Theme ----
  var SUN = ${JSON.stringify(svg(ICON_SUN, 18))};
  var MOON = ${JSON.stringify(svg(ICON_MOON, 18))};
  var themeBtn = document.getElementById("theme-toggle");
  function paintTheme() {
    themeBtn.innerHTML = document.documentElement.dataset.theme === "dark" ? SUN : MOON;
  }
  paintTheme();
  themeBtn.addEventListener("click", function () {
    var next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("takos-theme", next); } catch (e) { /* ignore */ }
    paintTheme();
  });

  // ---- State ----
  var state = {
    files: [],            // [{path,size,uploaded}] relative to the drive root
    truncated: false,
    nav: "files",        // files | recent
    path: "",            // current folder, "" or "a/b/"
    view: "list",
    sort: { key: "uploaded", dir: "desc" },
    query: "",
    loading: true,
    failed: false,
  };
  try {
    var storedView = localStorage.getItem("takos-storage-view");
    if (storedView === "grid" || storedView === "list") state.view = storedView;
  } catch (e) { /* keep list */ }

  var splashEl = document.getElementById("splash");
  var appEl = document.getElementById("app");
  var fabEl = document.getElementById("fab");
  var rowsEl = document.getElementById("rows");
  var cardsEl = document.getElementById("cards");
  var listHeadEl = document.getElementById("list-head");
  var stateEl = document.getElementById("state");
  var crumbsEl = document.getElementById("crumbs");
  var toastEl = document.getElementById("toast");
  var searchInput = document.getElementById("q");
  var currentVisible = [];

  // ---- Helpers ----
  function esc(s) { var d = document.createElement("div"); d.textContent = s == null ? "" : s; return d.innerHTML; }
  function relTime(s) {
    var time = Date.parse(s); if (!time) return "";
    var diff = (Date.now() - time) / 1000;
    if (diff < 60) return t("justNow");
    if (diff < 3600) return t("minAgo", { n: Math.floor(diff / 60) });
    if (diff < 86400) return t("hourAgo", { n: Math.floor(diff / 3600) });
    if (diff < 604800) return t("dayAgo", { n: Math.floor(diff / 86400) });
    return new Date(time).toLocaleDateString(lang === "ja" ? "ja-JP" : undefined, { year: "numeric", month: "short", day: "numeric" });
  }
  function fmtBytes(n) {
    if (typeof n !== "number" || !isFinite(n)) return "";
    if (n < 1024) return n + " B";
    var units = ["KB", "MB", "GB", "TB"], v = n;
    for (var i = 0; i < units.length; i++) {
      v = v / 1024;
      if (v < 1024 || i === units.length - 1) return (v >= 100 ? Math.round(v) : v.toFixed(1)) + " " + units[i];
    }
  }
  var EXT_KIND = {
    png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", svg: "image", avif: "image", ico: "image",
    mp4: "video", webm: "video", mov: "video", mkv: "video",
    mp3: "audio", wav: "audio", ogg: "audio", flac: "audio", m4a: "audio",
    txt: "text", md: "text", json: "text", js: "text", ts: "text", css: "text", html: "text",
    csv: "text", log: "text", yaml: "text", yml: "text", toml: "text", xml: "text", tf: "text",
    pdf: "pdf", zip: "archive", gz: "archive", tar: "archive", "7z": "archive", rar: "archive",
  };
  var KIND_ACCENT = {
    folder: "#7c3aed", image: "#dc2626", video: "#db2777", audio: "#ea580c",
    text: "#2563eb", pdf: "#b91c1c", archive: "#a16207", file: "#5f6368",
  };
  var KIND_ICON = {
    folder: ${JSON.stringify(ICON_FOLDER)},
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
    video: '<path d="m10 8 6 4-6 4Z"/><rect x="2" y="4" width="20" height="16" rx="2"/>',
    audio: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    text: ${JSON.stringify(ICON_FILE + '<path d="M9 13h6"/><path d="M9 17h6"/>')},
    pdf: ${JSON.stringify(ICON_FILE)},
    archive: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18"/><path d="M12 7h2M10 5h2M12 11h2M10 9h2"/>',
    file: ${JSON.stringify(ICON_FILE)},
  };
  function kindOf(name) {
    var dot = name.lastIndexOf(".");
    if (dot < 0) return "file";
    return EXT_KIND[name.slice(dot + 1).toLowerCase()] || "file";
  }
  function typeIcon(kind, size) {
    return '<span class="type-icon" style="background:' + (KIND_ACCENT[kind] || KIND_ACCENT.file) + '">' +
      '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (KIND_ICON[kind] || KIND_ICON.file) + "</svg></span>";
  }
  var toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 4000);
  }
  function redirectToLogin() {
    document.getElementById("splash-text").textContent = t("signinRedirect");
    location.href = "/api/auth/login?return_to=" + encodeURIComponent(location.pathname + location.search);
  }
  function api(path, init) {
    init = init || {};
    init.credentials = "same-origin";
    return fetch(path, init).then(function (r) {
      if (r.status === 401) { redirectToLogin(); return new Promise(function () {}); }
      return r;
    });
  }
  function fileUrl(path) {
    return "/api/drive/file/" + encodeURIComponent(path);
  }

  // ---- Session boot ----
  function boot() {
    api("/api/auth/me").then(function (r) {
      if (r.status === 503) {
        document.getElementById("splash-text").textContent = t("authBroken");
        throw new Error("auth_misconfigured");
      }
      return r.json();
    }).then(function (me) {
      splashEl.hidden = true;
      appEl.hidden = false;
      fabEl.hidden = false;
      if (me && me.required) {
        var name = me.name || me.sub || "";
        document.getElementById("user-chip").hidden = false;
        document.getElementById("user-name").textContent = name;
        document.getElementById("user-avatar").textContent = (name || "?").slice(0, 1).toUpperCase();
        document.getElementById("logout").hidden = false;
      }
      load();
    }).catch(function () { /* splash keeps the error text */ });
  }
  document.getElementById("logout").addEventListener("click", function () {
    api("/api/auth/logout", { method: "POST" }).then(function () { location.reload(); });
  });

  // ---- Listing / tree ----
  function load() {
    state.loading = true;
    state.failed = false;
    render();
    api("/api/drive/list").then(function (r) {
      if (!r.ok) throw new Error("http " + r.status);
      return r.json();
    }).then(function (data) {
      state.files = (data && data.files) || [];
      state.truncated = !!(data && data.truncated);
      state.loading = false;
      renderUsage();
      render();
    }).catch(function () {
      state.loading = false;
      state.failed = true;
      render();
    });
  }
  function renderUsage() {
    var total = 0, count = 0;
    state.files.forEach(function (f) {
      if (f.path.slice(-1) === "/") return; // folder markers aren't files
      total += f.size || 0;
      count += 1;
    });
    document.getElementById("usage-text").textContent =
      t("usage", { count: count, size: fmtBytes(total) || "0 B" });
    document.getElementById("usage-truncated").hidden = !state.truncated;
  }

  // Items for the current view. Each item:
  //   {type:"folder"|"file", name, path, size, uploaded, count, sub}
  function visibleItems() {
    var items = [];
    if (state.query) {
      var q = state.query.toLowerCase();
      state.files.forEach(function (f) {
        if (!f.path || f.path.slice(-1) === "/") return;
        var name = f.path.slice(f.path.lastIndexOf("/") + 1);
        if (name.toLowerCase().indexOf(q) < 0) return;
        items.push({ type: "file", name: name, path: f.path, size: f.size, uploaded: f.uploaded, sub: f.path.slice(0, f.path.lastIndexOf("/") + 1) });
      });
    } else if (state.nav === "recent") {
      state.files.forEach(function (f) {
        if (!f.path || f.path.slice(-1) === "/") return;
        var name = f.path.slice(f.path.lastIndexOf("/") + 1);
        items.push({ type: "file", name: name, path: f.path, size: f.size, uploaded: f.uploaded, sub: f.path.slice(0, f.path.lastIndexOf("/") + 1) });
      });
      items.sort(function (a, b) { return (Date.parse(b.uploaded) || 0) - (Date.parse(a.uploaded) || 0); });
      return items.slice(0, 50);
    } else {
      var base = state.path;
      var folders = {};
      state.files.forEach(function (f) {
        if (f.path.indexOf(base) !== 0) return;
        var rest = f.path.slice(base.length);
        if (!rest) return; // marker for this folder itself
        var slash = rest.indexOf("/");
        if (slash < 0) {
          items.push({ type: "file", name: rest, path: f.path, size: f.size, uploaded: f.uploaded });
        } else {
          var name = rest.slice(0, slash);
          var folder = folders[name];
          if (!folder) folder = folders[name] = { type: "folder", name: name, path: base + name + "/", size: 0, count: 0, uploaded: "" };
          if (rest.length > slash + 1) { folder.count += 1; folder.size += f.size || 0; }
          if (!folder.uploaded || Date.parse(f.uploaded) > Date.parse(folder.uploaded)) folder.uploaded = f.uploaded;
        }
      });
      items = Object.keys(folders).map(function (k) { return folders[k]; }).concat(items);
    }
    var key = state.sort.key, dir = state.sort.dir === "asc" ? 1 : -1;
    items.sort(function (a, b) {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1; // folders first
      if (key === "name") return a.name.localeCompare(b.name, lang === "ja" ? "ja" : undefined) * dir;
      if (key === "size") return ((a.size || 0) - (b.size || 0)) * dir;
      return ((Date.parse(a.uploaded) || 0) - (Date.parse(b.uploaded) || 0)) * dir;
    });
    return items;
  }

  // ---- Rendering ----
  function renderCrumbs() {
    crumbsEl.innerHTML = "";
    if (state.query) {
      crumbsEl.innerHTML = '<span class="crumb" aria-current="page">' + esc(t("headingResults")) + "</span>";
      return;
    }
    if (state.nav === "recent") {
      crumbsEl.innerHTML = '<span class="crumb" aria-current="page">' + esc(t("headingRecent")) + "</span>";
      return;
    }
    var parts = state.path ? state.path.slice(0, -1).split("/") : [];
    var frag = document.createDocumentFragment();
    var home = document.createElement("button");
    home.type = "button"; home.className = "crumb"; home.textContent = t("home");
    if (!parts.length) home.setAttribute("aria-current", "page");
    home.addEventListener("click", function () { state.path = ""; render(); });
    frag.appendChild(home);
    var acc = "";
    parts.forEach(function (part, i) {
      acc += part + "/";
      var target = acc;
      var sep = document.createElement("span");
      sep.className = "crumb-sep"; sep.textContent = "›";
      frag.appendChild(sep);
      var btn = document.createElement("button");
      btn.type = "button"; btn.className = "crumb"; btn.textContent = part;
      if (i === parts.length - 1) btn.setAttribute("aria-current", "page");
      else btn.addEventListener("click", function () { state.path = target; render(); });
      frag.appendChild(btn);
    });
    crumbsEl.appendChild(frag);
  }
  function renderState(iconPaths, titleKey, bodyKey) {
    stateEl.innerHTML = '<div class="state-icon"><svg viewBox="0 0 24 24" width="52" height="52" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + iconPaths + "</svg></div>" +
      (titleKey ? "<h3>" + esc(t(titleKey)) + "</h3>" : "") +
      (bodyKey ? "<p>" + esc(t(bodyKey)) + "</p>" : "");
    stateEl.hidden = false;
  }
  function render() {
    renderCrumbs();
    document.querySelectorAll("[data-nav]").forEach(function (el) {
      el.setAttribute("aria-pressed", String(!state.query && el.getAttribute("data-nav") === state.nav));
    });
    document.querySelectorAll("[data-view]").forEach(function (el) {
      el.setAttribute("aria-pressed", String(el.getAttribute("data-view") === state.view));
    });
    document.querySelectorAll(".sort-arrow").forEach(function (el) {
      var key = el.getAttribute("data-arrow");
      el.textContent = state.sort.key === key ? (state.sort.dir === "asc" ? "\\u25B2" : "\\u25BC") : "";
    });

    var items = visibleItems();
    var isList = state.view === "list";
    rowsEl.innerHTML = "";
    cardsEl.innerHTML = "";
    stateEl.hidden = true;
    currentVisible = items;

    if (state.loading || state.failed || !items.length) {
      listHeadEl.hidden = true; rowsEl.hidden = true; cardsEl.hidden = true;
      if (state.loading) {
        renderState('<circle cx="12" cy="12" r="9" stroke-dasharray="42 14"/>', "loading", null);
      } else if (state.failed) {
        renderState('<circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><path d="M12 16h.01"/>', "errLoad", null);
      } else if (state.query) {
        renderState('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>', "emptySearchTitle", "emptySearchBody");
      } else {
        renderState(${JSON.stringify(ICON_FOLDER)}, "emptyTitle", "emptyBody");
      }
      return;
    }

    listHeadEl.hidden = !isList;
    rowsEl.hidden = !isList;
    cardsEl.hidden = isList;

    items.forEach(function (item, index) {
      var kind = item.type === "folder" ? "folder" : kindOf(item.name);
      var sub = item.sub ? '<span class="name-sub">' + esc(item.sub) + "</span>" : "";
      var sizeText = item.type === "folder"
        ? (item.count ? t("folderCount", { count: item.count }) : t("folder"))
        : (fmtBytes(item.size) || "");
      var kebab = '<button type="button" class="kebab" data-item="' + index + '" aria-haspopup="menu" aria-label="' + esc(t("itemMenu")) + '" title="' + esc(t("itemMenu")) + '">' +
        '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg></button>';
      if (isList) {
        var li = document.createElement("li");
        li.className = "row";
        li.innerHTML =
          '<button type="button" class="row-link" data-open="' + index + '" aria-label="' + esc(item.name) + '"></button>' +
          '<span class="row-name">' + typeIcon(kind, 14) + '<span style="min-width:0">' +
          '<span class="name-text" style="display:block">' + esc(item.name) + "</span>" + sub + "</span></span>" +
          '<span class="row-size">' + esc(sizeText) + "</span>" +
          '<span class="row-time">' + esc(relTime(item.uploaded)) + "</span>" +
          kebab;
        rowsEl.appendChild(li);
      } else {
        var card = document.createElement("div");
        card.className = "card";
        card.style.setProperty("--card-accent", KIND_ACCENT[kind] || KIND_ACCENT.file);
        card.innerHTML =
          '<button type="button" class="row-link" data-open="' + index + '" aria-label="' + esc(item.name) + '"></button>' +
          '<div class="card-thumb"><svg viewBox="0 0 24 24" width="42" height="42" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (KIND_ICON[kind] || KIND_ICON.file) + "</svg></div>" +
          '<div class="card-foot">' + typeIcon(kind, 13) +
          '<div class="card-meta"><div class="card-name">' + esc(item.name) + '</div><div class="card-time">' + esc(item.type === "folder" ? sizeText : relTime(item.uploaded)) + "</div></div>" +
          kebab + "</div>";
        cardsEl.appendChild(card);
      }
    });
  }

  // ---- Open (navigate / preview) ----
  function openItem(item) {
    if (item.type === "folder") {
      state.nav = "files";
      state.query = "";
      searchInput.value = "";
      state.path = item.path;
      render();
      return;
    }
    openPreview(item);
  }
  document.addEventListener("click", function (e) {
    var opener = e.target.closest ? e.target.closest("[data-open]") : null;
    if (!opener) return;
    var item = currentVisible[Number(opener.getAttribute("data-open"))];
    if (item) openItem(item);
  });

  // ---- Preview ----
  var previewEl = document.getElementById("preview");
  var previewBody = document.getElementById("preview-body");
  var previewName = document.getElementById("preview-name");
  var previewTarget = null;
  var previewUrl = null;
  var PREVIEW_TEXT_MAX = 1024 * 1024;
  function closePreview() {
    previewEl.classList.remove("open");
    previewBody.innerHTML = "";
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
    previewTarget = null;
  }
  function openPreview(item) {
    previewTarget = item;
    previewName.textContent = item.name;
    previewBody.innerHTML = '<div class="preview-fallback">' + esc(t("loading")) + "</div>";
    previewEl.classList.add("open");
    var kind = kindOf(item.name);
    if (kind === "image") {
      api(fileUrl(item.path)).then(function (r) {
        if (!r.ok) throw new Error("http " + r.status);
        return r.blob();
      }).then(function (blob) {
        if (previewTarget !== item) return;
        previewUrl = URL.createObjectURL(blob);
        previewBody.innerHTML = "";
        var img = document.createElement("img");
        img.src = previewUrl;
        img.alt = item.name;
        previewBody.appendChild(img);
      }).catch(function () { fallbackPreview(); });
      return;
    }
    if (kind === "text" && (item.size || 0) <= PREVIEW_TEXT_MAX) {
      api(fileUrl(item.path)).then(function (r) {
        if (!r.ok) throw new Error("http " + r.status);
        return r.text();
      }).then(function (text) {
        if (previewTarget !== item) return;
        previewBody.innerHTML = "";
        var pre = document.createElement("pre");
        pre.textContent = text;
        previewBody.appendChild(pre);
      }).catch(function () { fallbackPreview(); });
      return;
    }
    fallbackPreview(kind === "text" ? "previewTooBig" : "previewNone");
  }
  function fallbackPreview(msgKey) {
    previewBody.innerHTML = "";
    var box = document.createElement("div");
    box.className = "preview-fallback";
    var msg = document.createElement("span");
    msg.textContent = t(msgKey || "previewNone");
    var btn = document.createElement("button");
    btn.type = "button"; btn.className = "btn primary"; btn.textContent = t("download");
    btn.addEventListener("click", function () { if (previewTarget) download(previewTarget); });
    box.appendChild(msg); box.appendChild(btn);
    previewBody.appendChild(box);
  }
  document.getElementById("preview-close").addEventListener("click", closePreview);
  document.getElementById("preview-download").addEventListener("click", function () {
    if (previewTarget) download(previewTarget);
  });
  previewEl.addEventListener("click", function (e) {
    if (e.target === previewEl || e.target === previewBody) closePreview();
  });

  // ---- Download ----
  function download(item) {
    api(fileUrl(item.path)).then(function (r) {
      if (!r.ok) throw new Error("http " + r.status);
      return r.blob();
    }).then(function (blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = item.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    }).catch(function () { toast(t("errAction")); });
  }

  // ---- Floating menus ----
  var newMenu = document.getElementById("new-menu");
  var itemMenu = document.getElementById("item-menu");
  var newBtn = document.getElementById("new-btn");
  var menuTarget = null;

  function closeMenus() {
    newMenu.classList.remove("open");
    itemMenu.classList.remove("open");
    newBtn.setAttribute("aria-expanded", "false");
  }
  function openMenuAt(menu, anchor) {
    closeMenus();
    menu.classList.add("open");
    var r = anchor.getBoundingClientRect();
    var mw = menu.offsetWidth, mh = menu.offsetHeight;
    var x = Math.min(r.left, window.innerWidth - mw - 8);
    var y = r.bottom + 6;
    if (y + mh > window.innerHeight - 8) y = Math.max(8, r.top - mh - 6);
    menu.style.left = Math.max(8, x) + "px";
    menu.style.top = y + "px";
    var first = menu.querySelector(".menu-item:not([hidden])");
    if (first) first.focus();
  }
  newBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    if (newMenu.classList.contains("open")) { closeMenus(); return; }
    openMenuAt(newMenu, newBtn);
    newBtn.setAttribute("aria-expanded", "true");
  });
  fabEl.addEventListener("click", function (e) {
    e.stopPropagation();
    if (newMenu.classList.contains("open")) { closeMenus(); return; }
    openMenuAt(newMenu, fabEl);
  });
  document.addEventListener("click", function (e) {
    if (!newMenu.contains(e.target) && !itemMenu.contains(e.target)) closeMenus();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { closeMenus(); closePreview(); }
  });
  window.addEventListener("resize", closeMenus);
  document.getElementById("main").addEventListener("scroll", closeMenus);

  document.addEventListener("click", function (e) {
    var kebab = e.target.closest ? e.target.closest(".kebab") : null;
    if (!kebab) return;
    e.preventDefault();
    e.stopPropagation();
    var item = currentVisible[Number(kebab.getAttribute("data-item"))];
    if (!item) return;
    menuTarget = item;
    itemMenu.querySelector('[data-action="download"]').hidden = item.type === "folder";
    openMenuAt(itemMenu, kebab);
  }, true);

  // ---- Navigation ----
  document.querySelectorAll("[data-nav]").forEach(function (el) {
    el.addEventListener("click", function () {
      state.nav = el.getAttribute("data-nav");
      state.path = "";
      state.query = "";
      searchInput.value = "";
      render();
    });
  });
  document.querySelectorAll("[data-view]").forEach(function (el) {
    el.addEventListener("click", function () {
      state.view = el.getAttribute("data-view");
      try { localStorage.setItem("takos-storage-view", state.view); } catch (e) { /* ignore */ }
      render();
    });
  });
  document.querySelectorAll("[data-sort]").forEach(function (el) {
    el.addEventListener("click", function () {
      var key = el.getAttribute("data-sort");
      if (state.sort.key === key) {
        state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
      } else {
        state.sort = { key: key, dir: key === "name" ? "asc" : "desc" };
      }
      render();
    });
  });

  // ---- Search ----
  var searchTimer;
  searchInput.addEventListener("input", function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      state.query = searchInput.value.trim();
      render();
    }, 150);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "/" && document.activeElement !== searchInput &&
        !(document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName))) {
      e.preventDefault();
      searchInput.focus();
    }
  });

  // ---- Upload ----
  var fileInput = document.getElementById("file-input");
  var tray = document.getElementById("tray");
  var trayList = document.getElementById("tray-list");
  document.getElementById("tray-close").addEventListener("click", function () {
    tray.classList.remove("open");
    trayList.innerHTML = "";
  });
  function uploadFiles(files) {
    if (!files || !files.length) return;
    tray.classList.add("open");
    var pending = files.length;
    Array.prototype.forEach.call(files, function (file) {
      var li = document.createElement("li");
      li.innerHTML = '<span class="spin"></span><span class="tray-name">' + esc(file.name) + '</span><span class="tray-status"></span>';
      trayList.appendChild(li);
      api(fileUrl(state.path + file.name), {
        method: "PUT",
        headers: { "content-type": file.type || "application/octet-stream" },
        body: file,
      }).then(function (r) {
        if (!r.ok) throw new Error("http " + r.status);
        li.querySelector(".spin").remove();
        li.querySelector(".tray-status").textContent = t("upDone");
        li.querySelector(".tray-status").className = "tray-status ok";
      }).catch(function () {
        li.querySelector(".spin").remove();
        li.querySelector(".tray-status").textContent = t("upFailed");
        li.querySelector(".tray-status").className = "tray-status fail";
        toast(t("errUpload", { name: file.name }));
      }).finally(function () {
        pending -= 1;
        if (pending === 0) load();
      });
    });
  }
  fileInput.addEventListener("change", function () {
    uploadFiles(fileInput.files);
    fileInput.value = "";
  });

  // Drag & drop upload (files view only).
  var mainEl = document.getElementById("main");
  var dropOverlay = document.getElementById("drop-overlay");
  var dragDepth = 0;
  mainEl.addEventListener("dragenter", function (e) {
    if (state.nav !== "files" || state.query) return;
    e.preventDefault();
    dragDepth += 1;
    dropOverlay.classList.add("active");
  });
  mainEl.addEventListener("dragover", function (e) { e.preventDefault(); });
  mainEl.addEventListener("dragleave", function () {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) dropOverlay.classList.remove("active");
  });
  mainEl.addEventListener("drop", function (e) {
    e.preventDefault();
    dragDepth = 0;
    dropOverlay.classList.remove("active");
    if (state.nav !== "files" || state.query) return;
    if (e.dataTransfer && e.dataTransfer.files) uploadFiles(e.dataTransfer.files);
  });

  // ---- New menu / dialogs ----
  var nameDialog = document.getElementById("name-dialog");
  var nameForm = document.getElementById("name-form");
  var nameInput = document.getElementById("name-input");
  var nameDialogTitle = document.getElementById("name-dialog-title");
  var nameDialogNote = document.getElementById("name-dialog-note");
  var nameMode = null; // "folder" | "rename"
  var actionTarget = null;

  document.querySelectorAll("[data-close]").forEach(function (el) {
    el.addEventListener("click", function () { el.closest("dialog").close(); });
  });

  document.querySelectorAll("[data-new]").forEach(function (el) {
    el.addEventListener("click", function () {
      var mode = el.getAttribute("data-new");
      closeMenus();
      if (mode === "upload") { fileInput.click(); return; }
      nameMode = "folder";
      nameDialogTitle.textContent = t("newFolderTitle");
      nameDialogNote.hidden = true;
      nameInput.value = "";
      nameInput.setAttribute("aria-label", t("newFolderLabel"));
      nameDialog.showModal();
    });
  });

  var deleteDialog = document.getElementById("delete-dialog");
  var deleteBody = document.getElementById("delete-body");
  var deleteConfirm = document.getElementById("delete-confirm");

  itemMenu.querySelectorAll("[data-action]").forEach(function (el) {
    el.addEventListener("click", function () {
      var action = el.getAttribute("data-action");
      var item = menuTarget;
      closeMenus();
      if (!item) return;
      if (action === "open") { openItem(item); return; }
      if (action === "download") { download(item); return; }
      actionTarget = item;
      if (action === "rename") {
        nameMode = "rename";
        nameDialogTitle.textContent = t("renameTitle");
        if (item.type === "folder" && item.count) {
          nameDialogNote.textContent = t("renameFolderBody", { count: item.count });
          nameDialogNote.hidden = false;
        } else {
          nameDialogNote.hidden = true;
        }
        nameInput.value = item.name;
        nameInput.setAttribute("aria-label", t("renameLabel"));
        nameDialog.showModal();
        nameInput.select();
      } else if (action === "delete") {
        deleteBody.textContent = item.type === "folder"
          ? t("deleteFolderBody", { name: item.name, count: item.count || 0 })
          : t("deleteBody", { name: item.name });
        deleteDialog.showModal();
      }
    });
  });

  function pathsUnder(prefix) {
    return state.files.filter(function (f) { return f.path.indexOf(prefix) === 0; })
      .map(function (f) { return f.path; });
  }
  function sequential(paths, fn) {
    return paths.reduce(function (p, path) {
      return p.then(function () { return fn(path); });
    }, Promise.resolve());
  }
  function copyFile(fromPath, toPath) {
    // The drive surface has no server-side copy; stream through the browser.
    return api(fileUrl(fromPath)).then(function (r) {
      if (!r.ok) throw new Error("http " + r.status);
      var contentType = r.headers.get("content-type") || "application/octet-stream";
      return r.blob().then(function (blob) {
        return api(fileUrl(toPath), {
          method: "PUT",
          headers: { "content-type": contentType },
          body: blob,
        });
      });
    }).then(function (r) {
      if (!r.ok) throw new Error("http " + r.status);
    });
  }

  nameForm.addEventListener("submit", function (e) {
    var name = nameInput.value.trim();
    if (!name) return;
    if (name.indexOf("/") >= 0) {
      e.preventDefault();
      toast(t("nameInvalid"));
      return;
    }
    if (nameMode === "folder") {
      api(fileUrl(state.path + name + "/"), {
        method: "PUT",
        headers: { "content-type": "application/x-directory" },
        body: "",
      }).then(function (r) {
        if (!r.ok) throw new Error("http " + r.status);
        load();
      }).catch(function () { toast(t("errAction")); });
      return;
    }
    // rename
    var item = actionTarget;
    if (!item || name === item.name) return;
    if (item.type === "file") {
      var parent = item.path.slice(0, item.path.lastIndexOf("/") + 1);
      copyFile(item.path, parent + name).then(function () {
        return api(fileUrl(item.path), { method: "DELETE" });
      }).then(function () { load(); }).catch(function () { toast(t("errAction")); load(); });
    } else {
      var oldPrefix = item.path;
      var parentPrefix = oldPrefix.slice(0, oldPrefix.slice(0, -1).lastIndexOf("/") + 1);
      var newPrefix = parentPrefix + name + "/";
      sequential(pathsUnder(oldPrefix), function (path) {
        var target = newPrefix + path.slice(oldPrefix.length);
        var move = path === oldPrefix
          ? api(fileUrl(newPrefix), { method: "PUT", headers: { "content-type": "application/x-directory" }, body: "" }).then(function () {})
          : copyFile(path, target);
        return move.then(function () {
          return api(fileUrl(path), { method: "DELETE" });
        });
      }).then(function () { load(); }).catch(function () { toast(t("errAction")); load(); });
    }
  });

  deleteConfirm.addEventListener("click", function () {
    var item = actionTarget;
    deleteDialog.close();
    if (!item) return;
    var paths = item.type === "folder" ? pathsUnder(item.path) : [item.path];
    sequential(paths, function (path) {
      return api(fileUrl(path), { method: "DELETE" }).then(function (r) {
        if (!r.ok && r.status !== 404) throw new Error("http " + r.status);
      });
    }).then(function () { load(); }).catch(function () { toast(t("errAction")); load(); });
  });

  // ---- Boot ----
  boot();
})();
</script>
</body>
</html>`;
}

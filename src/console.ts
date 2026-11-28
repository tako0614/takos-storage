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

import {
  MAX_FOLDER_OBJECTS,
  MAX_FOLDER_TOTAL_BYTES,
} from "./drive-folder-operations.ts";

const CATALOGS = {
  en: {
    appName: "Takos Storage",
    signinRedirect: "Redirecting to sign-in…",
    authBroken: "Sign-in is not configured for this service.",
    authDenied: "You don't have access to this drive.",
    authDeniedBody:
      "Sign in with an authorized account or contact the workspace owner.",
    errBoot: "Couldn't check your session.",
    errBootBody: "Check your connection and try again.",
    signedInAs: "Signed in as {name}",
    logout: "Sign out",
    skipToContent: "Skip to content",
    searchPlaceholder: "Search in Drive",
    clearSearch: "Clear search",
    refresh: "Refresh",
    toggleTheme: "Toggle theme",
    switchLang: "Switch language to Japanese",
    breadcrumbLabel: "Breadcrumb",
    close: "Close",
    newButton: "New",
    actionUpload: "Upload files",
    actionNewFolder: "New folder",
    navLabel: "Drive navigation",
    navFiles: "My Drive",
    navRecent: "Recent",
    usage: "{count} files · {size}",
    usageTruncated: "More items are available. Load more to include them.",
    loadMore: "Load more",
    retry: "Retry",
    pendingTitle: "Finish interrupted deletions",
    pendingBody:
      "These deletions need cleanup before their paths can be reused.",
    cleanupAction: "Finish cleanup",
    cleanupReview: "Review cleanup",
    cleanupChecking: "Checking this deletion…",
    cleanupCheckFailed:
      "The deletion could not be checked. Close this dialog and review it again.",
    cleanupTitle: "Finish this deletion?",
    cleanupBody:
      "Finish cleanup for “{name}”? Only a pending deletion can be cleaned up. Review the refreshed list if its state has changed.",
    cleanupOperator:
      "This deletion needs operator review. No automatic cleanup is available.",
    cleanupDone: "Deletion cleanup finished.",
    cleanupChanged:
      "The deletion state changed. Review the refreshed list before another action.",
    cleanupUnknown:
      "Cleanup could not be confirmed. Review the refreshed list before another action. No automatic retry was sent.",
    cleanupResultTitle: "Review deletion cleanup",
    cleanupWorking: "Finishing the selected deletion…",
    home: "My Drive",
    headingRecent: "Recent",
    headingResults: "Search results",
    headingResultsCount: "Search results ({count})",
    viewLabel: "View",
    viewList: "List view",
    viewGrid: "Grid view",
    sortLabel: "Sort",
    colName: "Name",
    colSize: "Size",
    colUpdated: "Last modified",
    sortAsc: "ascending",
    sortDesc: "descending",
    sortBy: "{label}, sorted {dir}",
    sortAction: "Sort by {label}",
    folder: "Folder",
    folderCount: "{count} items",
    itemMenu: "More actions",
    itemMenuFor: "More actions for {name}",
    menuDownload: "Download",
    menuRename: "Rename",
    menuMove: "Move to folder…",
    menuDelete: "Delete",
    menuOpen: "Open",
    moveTitle: "Move to folder",
    moveItemPrompt: "Choose a destination for “{name}”.",
    moveFolderLabel: "Destination folder",
    moveCurrentSuffix: "{label} (current)",
    moveCustomOption: "Other folder path…",
    moveCustomLabel: "Folder path",
    moveCustomPlaceholder: "e.g. Documents/Archive",
    movePathRequired: "Enter a folder path.",
    movePathInvalid: "Enter a valid folder path.",
    moveSameFolder: "Already in this folder.",
    moveIntoSelf: "Can't move a folder into itself or a conflicting path.",
    moveConfirm: "Move",
    moveFolderBody:
      "Move {count} reviewed entries to the destination folder. Entries are copied and removed individually. A conflict can leave both copies; review the results before another attempt.",
    renameTitle: "Rename",
    renameLabel: "New name",
    newFolderTitle: "New folder",
    newFolderLabel: "Folder name",
    nameRequired: "Enter a name.",
    nameInvalid: 'Names can\'t contain "/".',
    nameInvalidPath: 'Names can\'t be "." or ".." or contain "/" or "\\".',
    folderCreated: "Folder created.",
    itemRenamed: "Renamed.",
    itemMoved: "Moved.",
    itemDeleted: "Deleted.",
    selectAll: "Select all items",
    deselectAll: "Deselect all items",
    selectItem: "Select {name}",
    bulkRegionLabel: "Bulk actions",
    bulkSelected: "{count} selected",
    bulkClear: "Clear",
    bulkMove: "Move",
    bulkDelete: "Delete",
    bulkMovePrompt: "Choose a destination for {count} selected items.",
    bulkMoveNote:
      "Move {count} reviewed entries to the destination folder. Items are moved individually with revision checks; partial results require review.",
    bulkMoveCollision:
      "Two or more selected items have the same name and would collide in the destination folder.",
    bulkDeleteBody:
      "Delete {count} selected items ({entries} reviewed entries) forever? This can’t be undone. Items are removed individually; conflicts can leave partial results that require review.",
    bulkWorkingMove: "Moving {done} / {total}…",
    bulkWorkingDelete: "Deleting {done} / {total}…",
    bulkMoved: "Moved {count} items.",
    bulkDeleted: "Deleted {count} items.",
    bulkResultTitle: "Review batch operation",
    bulkIncomplete:
      "Some items could not be updated. Review the refreshed list before trying again; no automatic retry was sent.",
    bulkUnknown:
      "The batch result could not be confirmed. Review the refreshed list before trying again; no automatic retry was sent.",
    shortcutsTitle: "Keyboard shortcuts",
    shortcutSearch: "Focus search",
    shortcutNewFolder: "New folder",
    shortcutUpload: "Upload files",
    shortcutNav: "Navigate items or preview files",
    shortcutUp: "Go to parent folder",
    shortcutEsc: "Close menu, preview, or clear selection",
    shortcutHelp: "Show keyboard shortcuts",
    save: "OK",
    cancel: "Cancel",
    deleteTitle: "Delete forever?",
    deleteBody: "“{name}” will be deleted forever. This can’t be undone.",
    deleteFolderBody:
      "Delete the {count} reviewed entries in “{name}” forever? This cannot be undone. Entries are removed individually; a conflict can leave partial results that must be reviewed.",
    deleteConfirm: "Delete",
    renameFolderBody:
      "Move {count} reviewed entries to the new name. Entries are copied and removed individually. A conflict can leave both copies; review the results before another attempt.",
    loading: "Loading…",
    emptyTitle: "Your drive is empty",
    emptyBody: "Drop files here or use “New” to upload.",
    emptyFolderTitle: "This folder is empty",
    emptyFolderBody: "Drop files here or use “New” to add items.",
    emptyRecentTitle: "No recent files",
    emptyRecentBody: "Files you upload will appear here.",
    emptySearchTitle: "No matching files",
    emptySearchBody: "Try a different search term.",
    searchTruncated:
      "Searching loaded items only. Load more to search the rest of your drive.",
    errLoad: "Couldn't load your files.",
    errLoadBody: "Check your connection and try again.",
    errUpload: "Upload failed: {name}",
    errTooLarge: "{name} is too large to upload.",
    errAction: "The operation failed.",
    errConflict:
      "The file revision or destination no longer matches this action. Review the refreshed list before trying again.",
    errRevision:
      "The file revision is unavailable. Refresh the list before trying again.",
    folderUnavailable:
      "Refresh a complete list before this action. Folder actions support up to {count} entries; rename supports at most {size} in total.",
    folderWorking: "Updating the reviewed folder entries…",
    folderDone: "{count} reviewed entries completed.",
    folderResultTitle: "Review the folder operation",
    folderIncomplete:
      "The operation stopped before completion. Some entries may have moved or been deleted. Review both paths in the refreshed list before another attempt.",
    folderUnknown:
      "The result could not be confirmed. Review both paths in the refreshed list before another attempt; no automatic retry was sent.",
    folderCompleted: "Confirmed entries: {count}",
    folderRemaining: "Unprocessed or uncertain entries:",
    folderDismiss: "Close and review files",
    upTrayTitle: "Uploads",
    upProgress: "{done} / {total}",
    upProgressFailed: "{done} / {total} · {failed} failed",
    upUploading: "Uploading…",
    upDone: "Done",
    upFailed: "Failed",
    upConflict: "Already exists",
    upTooLarge: "Too large",
    upRetry: "Retry",
    upRetryFor: "Retry uploading {name}",
    previewNone: "No preview available.",
    previewTooBig: "Too large to preview.",
    previewReadFailed: "Couldn't load the preview.",
    previewRetry: "Retry",
    previewPrev: "Previous file",
    previewNext: "Next file",
    previewTextLabel: "File contents: {name}",
    download: "Download",
    dropHint: "Drop files to upload",
    justNow: "just now",
    minAgo: "{n}m ago",
    hourAgo: "{n}h ago",
    dayAgo: "{n}d ago",
  },
  ja: {
    appName: "Takos Storage",
    signinRedirect: "サインインへ移動しています…",
    authBroken: "このサービスのサインインが設定されていません。",
    authDenied: "このドライブへのアクセス権がありません。",
    authDeniedBody:
      "権限のあるアカウントでサインインし直すか、ワークスペースの管理者にお問い合わせください。",
    errBoot: "サインイン状態を確認できませんでした。",
    errBootBody: "接続を確認してもう一度お試しください。",
    signedInAs: "{name} としてサインイン中",
    logout: "ログアウト",
    skipToContent: "本文へ移動",
    searchPlaceholder: "ドライブ内を検索",
    clearSearch: "検索をクリア",
    refresh: "更新",
    toggleTheme: "テーマを切り替え",
    switchLang: "英語に切り替え",
    breadcrumbLabel: "パンくずリスト",
    close: "閉じる",
    newButton: "新規",
    actionUpload: "ファイルをアップロード",
    actionNewFolder: "新しいフォルダ",
    navLabel: "ドライブのナビゲーション",
    navFiles: "マイドライブ",
    navRecent: "最近",
    usage: "{count} 個のファイル · {size}",
    usageTruncated: "続きの項目があります。「さらに読み込む」で表示できます。",
    loadMore: "さらに読み込む",
    retry: "再試行",
    pendingTitle: "削除の後処理",
    pendingBody:
      "同じパスを再び使うには、残っている削除の後処理を完了してください。",
    cleanupAction: "後処理を完了",
    cleanupReview: "後処理を確認",
    cleanupChecking: "削除の状態を確認しています…",
    cleanupCheckFailed:
      "削除の状態を確認できませんでした。この画面を閉じて、もう一度確認してください。",
    cleanupTitle: "削除の後処理を完了しますか？",
    cleanupBody:
      "「{name}」の後処理を完了しますか？ 削除途中の項目だけが対象です。状態が変わっている場合は、更新された一覧を確認してください。",
    cleanupOperator:
      "この削除は管理者による確認が必要です。自動では後処理できません。",
    cleanupDone: "削除の後処理が完了しました。",
    cleanupChanged:
      "削除の状態が変わりました。更新された一覧を確認してください。",
    cleanupUnknown:
      "後処理の結果を確認できませんでした。更新された一覧を確認してください。自動再送はしていません。",
    cleanupResultTitle: "削除の後処理を確認",
    cleanupWorking: "選択した削除の後処理をしています…",
    home: "マイドライブ",
    headingRecent: "最近",
    headingResults: "検索結果",
    headingResultsCount: "検索結果（{count}件）",
    viewLabel: "表示形式",
    viewList: "リスト表示",
    viewGrid: "ギャラリー表示",
    sortLabel: "並び替え",
    colName: "名前",
    colSize: "サイズ",
    colUpdated: "最終更新",
    sortAsc: "昇順",
    sortDesc: "降順",
    sortBy: "{label}（{dir}で並び替え中）",
    sortAction: "{label}で並び替え",
    folder: "フォルダ",
    folderCount: "{count} 件",
    itemMenu: "その他の操作",
    itemMenuFor: "「{name}」のその他の操作",
    menuDownload: "ダウンロード",
    menuRename: "名前を変更",
    menuMove: "フォルダへ移動…",
    menuDelete: "削除",
    menuOpen: "開く",
    moveTitle: "フォルダへ移動",
    moveItemPrompt: "「{name}」の移動先を選んでください。",
    moveFolderLabel: "移動先フォルダ",
    moveCurrentSuffix: "{label}（現在）",
    moveCustomOption: "その他のフォルダパス…",
    moveCustomLabel: "フォルダパス",
    moveCustomPlaceholder: "例: Documents/Archive",
    movePathRequired: "フォルダパスを入力してください。",
    movePathInvalid: "有効なフォルダパスを入力してください。",
    moveSameFolder: "すでにこのフォルダにあります。",
    moveIntoSelf: "フォルダを自分自身や競合するパスへ移動できません。",
    moveConfirm: "移動",
    moveFolderBody:
      "確認済み {count} 件を移動先フォルダへ移動します。1件ずつコピー・削除するため、競合すると両方に残ることがあります。結果を確認してから次の操作をしてください。",
    renameTitle: "名前を変更",
    renameLabel: "新しい名前",
    newFolderTitle: "新しいフォルダ",
    newFolderLabel: "フォルダ名",
    nameRequired: "名前を入力してください。",
    nameInvalid: "名前に「/」は使えません。",
    nameInvalidPath: "名前に「/」「\\」は使えず、「.」「..」も指定できません。",
    folderCreated: "フォルダを作成しました。",
    itemRenamed: "名前を変更しました。",
    itemMoved: "移動しました。",
    itemDeleted: "削除しました。",
    selectAll: "すべての項目を選択",
    deselectAll: "すべての選択を解除",
    selectItem: "「{name}」を選択",
    bulkRegionLabel: "一括操作",
    bulkSelected: "{count}件を選択中",
    bulkClear: "選択解除",
    bulkMove: "移動",
    bulkDelete: "削除",
    bulkMovePrompt: "選択した {count} 件の移動先を選んでください。",
    bulkMoveNote:
      "確認済み {count} 件を移動先フォルダへ移動します。1件ずつ版を確認しながら移動するため、競合すると途中までの結果が残り、確認が必要です。",
    bulkMoveCollision:
      "同じ名前の項目が複数選択されているため、同じ移動先フォルダへ移動できません。",
    bulkDeleteBody:
      "選択した {count} 件（確認済み {entries} 件）を完全に削除しますか？ 元に戻せません。1件ずつ削除するため、競合すると途中までの結果が残り、確認が必要です。",
    bulkWorkingMove: "移動中 {done} / {total}…",
    bulkWorkingDelete: "削除中 {done} / {total}…",
    bulkMoved: "{count}件を移動しました。",
    bulkDeleted: "{count}件を削除しました。",
    bulkResultTitle: "一括操作の結果を確認",
    bulkIncomplete:
      "一部の項目を更新できませんでした。更新された一覧を確認してからやり直してください。自動再送はしていません。",
    bulkUnknown:
      "一括操作の結果を確認できませんでした。更新された一覧を確認してからやり直してください。自動再送はしていません。",
    shortcutsTitle: "キーボードショートカット",
    shortcutSearch: "検索欄にフォーカス",
    shortcutNewFolder: "新しいフォルダを作成",
    shortcutUpload: "ファイルをアップロード",
    shortcutNav: "一覧の移動・プレビューの前/次",
    shortcutUp: "親フォルダへ移動",
    shortcutEsc: "メニュー・プレビューを閉じる / 選択解除",
    shortcutHelp: "ショートカット一覧を表示",
    save: "OK",
    cancel: "キャンセル",
    deleteTitle: "完全に削除しますか？",
    deleteBody: "「{name}」を完全に削除します。この操作は元に戻せません。",
    deleteFolderBody:
      "「{name}」の確認済み {count} 件を完全に削除しますか？ 元に戻せません。1件ずつ削除するため、競合すると途中までの結果が残り、確認が必要です。",
    deleteConfirm: "削除",
    renameFolderBody:
      "確認済み {count} 件を新しい名前へ移動します。1件ずつコピー・削除するため、競合すると両方に残ることがあります。結果を確認してから次の操作をしてください。",
    loading: "読み込み中…",
    emptyTitle: "ドライブはまだ空です",
    emptyBody:
      "ここにファイルをドロップするか、「新規」からアップロードしてください。",
    emptyFolderTitle: "このフォルダは空です",
    emptyFolderBody:
      "ここにファイルをドロップするか、「新規」から追加してください。",
    emptyRecentTitle: "最近のファイルはありません",
    emptyRecentBody: "アップロードしたファイルがここに表示されます。",
    emptySearchTitle: "一致するファイルはありません",
    emptySearchBody: "別のキーワードで検索してください。",
    searchTruncated:
      "読み込み済みの項目のみを検索しています。残りを検索するには「さらに読み込む」を押してください。",
    errLoad: "ファイルを読み込めませんでした。",
    errLoadBody: "接続を確認してもう一度お試しください。",
    errUpload: "アップロードに失敗: {name}",
    errTooLarge: "「{name}」はサイズが大きすぎるためアップロードできません。",
    errAction: "操作に失敗しました。",
    errConflict:
      "ファイルの版または保存先の条件が一致しません。更新された一覧を確認してやり直してください。",
    errRevision:
      "ファイルの版を確認できません。一覧を更新してやり直してください。",
    folderUnavailable:
      "完全な一覧を更新してから操作してください。フォルダ操作は {count} 件まで、名前変更は合計 {size} までです。",
    folderWorking: "確認済みのフォルダ内容を処理しています…",
    folderDone: "確認済み {count} 件の処理が完了しました。",
    folderResultTitle: "フォルダ操作の結果を確認",
    folderIncomplete:
      "操作は途中で停止しました。移動・削除が済んだ項目もあります。更新された一覧で両方のパスを確認してから次の操作をしてください。",
    folderUnknown:
      "結果を確認できませんでした。更新された一覧で両方のパスを確認してください。自動再送はしていません。",
    folderCompleted: "完了を確認した項目: {count} 件",
    folderRemaining: "未処理または結果未確定の項目:",
    folderDismiss: "閉じてファイルを確認",
    upTrayTitle: "アップロード",
    upProgress: "{done} / {total}",
    upProgressFailed: "{done} / {total} · {failed}件失敗",
    upUploading: "アップロード中…",
    upDone: "完了",
    upFailed: "失敗",
    upConflict: "同名あり",
    upTooLarge: "サイズ超過",
    upRetry: "再試行",
    upRetryFor: "「{name}」のアップロードを再試行",
    previewNone: "プレビューできない形式です。",
    previewTooBig: "サイズが大きいためプレビューできません。",
    previewReadFailed: "プレビューを読み込めませんでした。",
    previewRetry: "再試行",
    previewPrev: "前のファイル",
    previewNext: "次のファイル",
    previewTextLabel: "ファイルの内容: {name}",
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
const ICON_REFRESH =
  '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>';
const ICON_MOVE =
  '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.2 3.9A2 2 0 0 0 7.5 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/><path d="m12 10 3 3-3 3"/><path d="M9 13h6"/>';
const ICON_X = '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>';
const ICON_CHEVRON_LEFT = '<path d="m15 18-6-6 6-6"/>';
const ICON_CHEVRON_RIGHT = '<path d="m9 18 6-6-6-6"/>';
const ICON_LOCK =
  '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>';
const ICON_HELP =
  '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 4.8.9c0 1.6-2.3 2-2.3 3.1"/><path d="M12 17h.01"/>';
const ICON_CHECK = '<path d="M5 12.5 9.5 17 19 7.5"/>';
const ICON_MINUS = '<path d="M6 12h12"/>';

export function storageConsoleHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Takos Storage</title>
<link rel="icon" href="/icons/takos-storage.svg" type="image/svg+xml">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<meta name="theme-color" content="#f6f8fc" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0f1115" media="(prefers-color-scheme: dark)">
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
    --text-faint: #6c7075;
    --line: #e3e7ee;
    --hover: #eef1f6;
    --active-pill: #dbe9fb;
    --active-text: #0b57d0;
    --accent: #7c3aed;
    --focus: #7c3aed;
    --warn: #9a5200;
    --ok: #15803d;
    --danger: #b91c1c;
    --shadow: 0 1px 2px rgba(60,64,67,.14), 0 1px 6px rgba(60,64,67,.12);
    --shadow-lg: 0 4px 8px rgba(60,64,67,.18), 0 8px 24px rgba(60,64,67,.14);
  }
  [data-theme="dark"] {
    color-scheme: dark;
    --bg: #0f1115;
    --panel: #161a22;
    --text: #e5e7eb;
    --text-soft: #9ca3af;
    --text-faint: #8e96a3;
    --line: #262b36;
    --hover: #20262f;
    --active-pill: rgba(139,92,246,.24);
    --active-text: #c4b5fd;
    --accent: #a78bfa;
    --warn: #fbbf24;
    --ok: #4ade80;
    --danger: #f87171;
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
  :is(a, button, input, select, pre, .row-link):focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
  button:disabled { opacity: .45; cursor: not-allowed; }
  button:disabled:hover { background: transparent; filter: none; }
  .sr-only {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
  }
  .skip-link {
    position: fixed; top: 8px; left: 8px; z-index: 90;
    padding: 8px 14px; border-radius: 8px; border: 2px solid var(--focus);
    background: var(--panel); color: var(--text); font-size: 13px; font-weight: 600;
    text-decoration: none; transform: translateY(-200%);
  }
  .skip-link:focus-visible { transform: translateY(0); }

  /* ---- Boot splash (auth redirect / hard errors) ---- */
  .splash { flex: 1; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .splash-card {
    display: flex; flex-direction: column; align-items: center; gap: 10px;
    max-width: 360px; color: var(--text); font-size: 15px; font-weight: 500; text-align: center;
  }
  .splash-card p { margin: 0; }
  .splash-card .splash-body { font-size: 13.5px; font-weight: 400; color: var(--text-soft); line-height: 1.5; }
  .splash-actions { display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 6px; flex-wrap: wrap; }
  .splash-actions .btn:not(.primary) { border: 1px solid var(--line); }

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
  .search { position: relative; flex: 1; max-width: 720px; min-width: 0; }
  .search .search-icon { position: absolute; left: 16px; top: 50%; transform: translateY(-50%); color: var(--text-soft); pointer-events: none; display: inline-flex; }
  .search input {
    width: 100%; padding: 11px 40px 11px 46px; font-size: 15px; color: var(--text);
    border: none; border-radius: 999px; outline: none; background: #e9eef6;
  }
  .search input::-webkit-search-cancel-button { -webkit-appearance: none; appearance: none; }
  [data-theme="dark"] .search input { background: #20262f; }
  .search input::placeholder { color: var(--text-soft); }
  .search input:focus { background: var(--panel); box-shadow: var(--shadow); }
  .search-clear {
    position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
    width: 32px; height: 32px; border: none; border-radius: 50%;
    background: transparent; color: var(--text-soft); cursor: pointer;
    display: inline-flex; align-items: center; justify-content: center;
  }
  .search-clear:hover { background: var(--hover); color: var(--text); }
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
  .icon-btn.spinning svg { animation: spin .8s linear infinite; }
  .tray-close { width: 36px; height: 36px; }
  .lang-btn {
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 40px; height: 36px; padding: 0 10px;
    border: 1px solid var(--line); border-radius: 999px;
    background: transparent; color: var(--text-soft); cursor: pointer;
    font-size: 12px; font-weight: 600; letter-spacing: .04em;
  }
  .lang-btn:hover { background: var(--hover); color: var(--text); }
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
  .usage .warn, .mobile-usage .warn { color: var(--warn); }

  .mobile-nav {
    display: none; align-items: center; gap: 6px; padding: 0 12px 8px;
    flex-wrap: wrap; flex-shrink: 0;
  }
  .mobile-nav .nav-item { width: auto; padding: 7px 14px; min-height: 40px; font-size: 13.5px; }
  .mobile-usage {
    margin-left: auto; font-size: 12px; color: var(--text-soft);
    display: inline-flex; align-items: center; gap: 6px;
  }

  main {
    flex: 1; min-width: 0; margin: 0 16px 16px 4px; padding: 8px 8px 24px;
    background: var(--panel); border-radius: 16px; overflow-y: auto; position: relative;
  }
  .main-head {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 16px 6px; position: sticky; top: 0; background: var(--panel);
    border-radius: 16px 16px 0 0; z-index: 5; min-height: 56px;
  }
  .main-head-actions { display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; }
  .pending-deletions { padding: 16px; margin-bottom: 16px; border: 1px solid var(--line); border-radius: 12px; }
  .pending-deletions h2 { font-size: 16px; margin: 0 0 8px; }
  .pending-deletions p { margin: 0 0 12px; color: var(--text-soft); }
  .pending-list { list-style: none; margin: 0; padding: 0; }
  .pending-list li { display: flex; align-items: center; gap: 12px; justify-content: space-between; padding: 8px 0; flex-wrap: wrap; }
  .pending-list .pending-path { min-width: 0; flex: 1 1 160px; overflow-wrap: anywhere; }
  .search-notice {
    display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
    margin: 4px 16px 10px; padding: 10px 14px;
    border: 1px solid color-mix(in srgb, var(--warn) 35%, var(--line));
    border-radius: 12px;
    background: color-mix(in srgb, var(--warn) 8%, var(--panel));
    font-size: 13px; color: var(--text);
  }
  .search-notice-text { flex: 1 1 200px; min-width: 0; }
  #load-more { display: block; margin: 16px auto; }
  .crumbs { display: flex; align-items: center; gap: 2px; flex: 1; min-width: 0; overflow-x: auto; scrollbar-width: none; white-space: nowrap; font-size: 20px; }
  .crumbs::-webkit-scrollbar { display: none; }
  .crumb { border: none; background: transparent; cursor: pointer; font-size: 20px; color: var(--text-soft); padding: 4px 8px; border-radius: 8px; max-width: 240px; overflow: hidden; text-overflow: ellipsis; flex-shrink: 0; }
  .crumb:hover { background: var(--hover); color: var(--text); }
  .crumb[aria-current="page"] { color: var(--text); cursor: default; }
  .crumb[aria-current="page"]:hover { background: transparent; }
  h1.crumb-heading { margin: 0; font-weight: 500; line-height: 1.3; max-width: 280px; }
  .crumb-sep { color: var(--text-soft); font-size: 16px; flex-shrink: 0; }
  .view-toggle { display: inline-flex; border: 1px solid var(--line); border-radius: 999px; overflow: hidden; flex-shrink: 0; }
  .seg {
    display: inline-flex; align-items: center; justify-content: center;
    width: 44px; height: 36px; border: none; background: transparent; cursor: pointer; color: var(--text-soft);
  }
  .seg + .seg { border-left: 1px solid var(--line); }
  .seg[aria-pressed="true"] { background: var(--active-pill); color: var(--active-text); }

  .list-head, .row { display: grid; grid-template-columns: minmax(0,1fr) 110px 170px 48px; align-items: center; gap: 8px; }
  .list-head {
    padding: 6px 16px; font-size: 12.5px; color: var(--text-soft); font-weight: 500;
    border-bottom: 1px solid var(--line); position: sticky; top: 56px; background: var(--panel); z-index: 4;
  }
  .list-head-name { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
  .list-head .sortable { display: inline-flex; align-items: center; gap: 4px; border: none; background: none; padding: 4px 0; cursor: pointer; color: inherit; font: inherit; font-weight: 500; white-space: nowrap; }
  .list-head .sortable:hover { color: var(--text); }
  .list-head.as-grid {
    display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
    padding: 6px 16px 10px;
  }
  .list-head.as-grid .list-head-name { display: contents; }
  .list-head.as-grid .sortable {
    padding: 5px 12px; border: 1px solid var(--line); border-radius: 999px;
  }
  .list-head.as-grid .sortable:hover { background: var(--hover); }
  .list-head.as-grid .sortable[aria-pressed="true"] {
    background: var(--active-pill); color: var(--active-text); border-color: transparent;
  }
  .list-head.as-grid > span { display: none; }
  .sort-arrow { font-size: 10px; }
  .bulk-bar {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    margin: 4px 16px 8px; padding: 8px 12px;
    border: 1px solid color-mix(in srgb, var(--active-text) 28%, var(--line));
    border-radius: 12px;
    background: color-mix(in srgb, var(--active-pill) 72%, var(--panel));
  }
  .bulk-count { font-size: 13.5px; font-weight: 600; color: var(--active-text); margin-right: auto; white-space: nowrap; }
  .bulk-actions { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .bulk-bar .btn { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; font-size: 13.5px; }
  .bulk-bar .btn:not(.danger) { border: 1px solid color-mix(in srgb, var(--active-text) 28%, var(--line)); background: var(--panel); }
  .select-check {
    position: relative; z-index: 2; flex-shrink: 0;
    display: inline-flex; align-items: center; justify-content: center;
    width: 30px; height: 30px; padding: 0; border: none; border-radius: 8px;
    background: transparent; color: var(--text-soft); cursor: pointer;
  }
  .select-check:hover { background: color-mix(in srgb, var(--text-soft) 16%, transparent); }
  .select-check .check-box {
    width: 18px; height: 18px; border-radius: 5px;
    border: 1.5px solid var(--text-soft); background: var(--panel);
    display: inline-flex; align-items: center; justify-content: center;
    color: transparent; transition: background .12s, border-color .12s, color .12s;
  }
  .select-check[aria-checked="true"] .check-box,
  .select-check[aria-checked="mixed"] .check-box {
    background: var(--active-text); border-color: var(--active-text); color: var(--panel);
  }
  .select-check .check-mark, .select-check .check-mixed { display: none; }
  .select-check[aria-checked="true"] .check-mark { display: inline-flex; }
  .select-check[aria-checked="mixed"] .check-mixed { display: inline-flex; }
  .rows { list-style: none; margin: 0; padding: 0; }
  .row { position: relative; padding: 0 16px; height: 48px; border-bottom: 1px solid var(--line); }
  .row:hover { background: var(--hover); }
  .row.selected { background: color-mix(in srgb, var(--active-pill) 52%, var(--panel)); }
  .row.selected:hover { background: color-mix(in srgb, var(--active-pill) 70%, var(--panel)); }
  .row.is-dragging, .card.is-dragging { opacity: .48; }
  .drop-target {
    outline: 2px dashed var(--accent) !important; outline-offset: -2px;
    background: var(--active-pill) !important;
  }
  .row-link { position: absolute; inset: 0; border: none; background: transparent; cursor: pointer; border-radius: 4px; z-index: 1; }
  .row-name { display: flex; align-items: center; gap: 10px; min-width: 0; font-size: 14px; }
  .row-name .name-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row-name .name-sub { display: block; font-size: 12px; color: var(--text-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row-name .row-mobile-size { display: none; }
  .row-size, .row-time { font-size: 13px; color: var(--text-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kebab {
    position: relative; z-index: 2; justify-self: end;
    display: inline-flex; align-items: center; justify-content: center;
    width: 38px; height: 38px; border: none; border-radius: 50%;
    background: transparent; color: var(--text-soft); cursor: pointer;
  }
  .kebab:hover { background: color-mix(in srgb, var(--text-soft) 16%, transparent); color: var(--text); }

  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(208px, 1fr)); gap: 14px; padding: 12px 16px; }
  .card {
    position: relative; border: 1px solid var(--line); border-radius: 12px; overflow: hidden;
    background: var(--panel); transition: box-shadow .12s, background .12s, border-color .12s;
  }
  .card:hover { background: var(--hover); box-shadow: var(--shadow); }
  .card.selected { border-color: var(--active-text); background: color-mix(in srgb, var(--active-pill) 45%, var(--panel)); }
  .card-check {
    position: absolute; top: 6px; left: 6px; z-index: 2;
    background: color-mix(in srgb, var(--panel) 84%, transparent);
    border-radius: 8px;
  }
  .card-thumb {
    position: relative; height: 110px; display: flex; align-items: center; justify-content: center;
    background: color-mix(in srgb, var(--card-accent, var(--accent)) 9%, var(--bg));
    color: var(--card-accent, var(--accent)); overflow: hidden;
  }
  .card-thumb-img {
    position: absolute; inset: 0; width: 100%; height: 100%;
    object-fit: cover; display: block; background: var(--bg);
  }
  .card-foot { display: flex; align-items: center; gap: 8px; padding: 10px 6px 10px 12px; }
  .card-meta { flex: 1; min-width: 0; }
  .card-name { font-size: 13.5px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .card-sub { font-size: 11.5px; color: var(--text-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 1px; }
  .card-time { font-size: 12px; color: var(--text-soft); margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .type-icon {
    width: 26px; height: 26px; border-radius: 7px; align-items: center; justify-content: center;
    display: inline-flex; color: #fff; flex-shrink: 0;
  }

  .state { text-align: center; color: var(--text-soft); padding: 64px 24px; }
  .state .state-icon { color: var(--text-soft); margin-bottom: 12px; }
  .state h2 { margin: 0 0 4px; font-size: 16px; font-weight: 500; color: var(--text); }
  .state p { margin: 0; font-size: 13.5px; }
  .state .state-actions { margin-top: 16px; display: flex; align-items: center; justify-content: center; gap: 8px; flex-wrap: wrap; }
  .state.is-skeleton { text-align: left; padding: 8px 16px; }
  .skel-rows { display: flex; flex-direction: column; }
  .skel-row { display: flex; align-items: center; gap: 12px; height: 48px; border-bottom: 1px solid var(--line); }
  .skel-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(208px, 1fr)); gap: 14px; padding: 4px 0; }
  .skel-card { border: 1px solid var(--line); border-radius: 12px; overflow: hidden; padding-bottom: 12px; }
  .skel-box { background: var(--hover); border-radius: 6px; animation: skel-pulse 1.4s ease-in-out infinite; }
  @keyframes skel-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .45; } }

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
  .menu-item.danger { color: var(--danger); }
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
  dialog label { display: block; margin: 0 0 6px; font-size: 13px; font-weight: 500; color: var(--text-soft); }
  dialog input[type="text"], dialog select {
    width: 100%; padding: 10px 12px; font-size: 14px; color: var(--text);
    border: 1px solid var(--line); border-radius: 8px; background: var(--bg); outline: none;
  }
  dialog input[type="text"]:focus, dialog select:focus { border-color: var(--focus); box-shadow: 0 0 0 3px color-mix(in srgb, var(--focus) 18%, transparent); }
  .dialog-field { margin-top: 12px; }
  .field-error { margin: 6px 0 0; font-size: 13px; color: var(--danger); }
  .dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
  .btn {
    padding: 8px 18px; border-radius: 999px; border: none; cursor: pointer;
    font-size: 14px; font-weight: 500; background: transparent; color: var(--active-text);
  }
  .btn:hover { background: var(--hover); }
  .btn.primary { background: var(--active-text); color: var(--panel); }
  .btn.primary:hover { filter: brightness(1.08); }
  .btn.primary:disabled:hover { background: var(--active-text); }
  .btn.danger { background: #b91c1c; color: #fff; }
  .btn.danger:hover { filter: brightness(1.08); }
  .btn.danger:disabled:hover { background: #b91c1c; }
  .shortcut-list { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 10px 16px; align-items: center; }
  .shortcut-list dt { margin: 0; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
  .shortcut-list dd { margin: 0; font-size: 13.5px; color: var(--text-soft); line-height: 1.4; }
  kbd {
    display: inline-flex; align-items: center; justify-content: center; min-width: 24px;
    padding: 2px 7px; border-radius: 6px; border: 1px solid var(--line);
    background: var(--bg); color: var(--text);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px; font-weight: 600; line-height: 1.4;
  }

  /* ---- Preview overlay ---- */
  .preview {
    position: fixed; inset: 0; z-index: 70; background: rgba(10,12,16,.88);
    display: none; flex-direction: column;
  }
  .preview.open { display: flex; }
  .preview-bar { display: flex; align-items: center; gap: 8px; padding: 12px 18px; color: #e5e7eb; }
  .preview-title-wrap { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .preview-bar .preview-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14.5px; font-weight: 500; }
  .preview-bar .preview-meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: #cbd5e1; }
  .preview-nav { display: inline-flex; align-items: center; gap: 2px; flex-shrink: 0; }
  .preview-pos { font-size: 12.5px; color: #cbd5e1; min-width: 42px; text-align: center; white-space: nowrap; }
  .preview-bar .icon-btn { color: #cbd5e1; }
  .preview-bar .icon-btn:hover { background: rgba(255,255,255,.12); color: #fff; }
  .preview-bar .icon-btn:disabled { opacity: .35; }
  .preview-bar .icon-btn:disabled:hover { background: transparent; color: #cbd5e1; }
  .preview-body { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; padding: 0 24px 24px; }
  .preview-body img { max-width: 100%; max-height: 100%; border-radius: 8px; box-shadow: var(--shadow-lg); }
  .preview-body pre {
    width: min(860px, 100%); max-height: 100%; overflow: auto; margin: 0;
    background: var(--panel); color: var(--text); border-radius: 12px; padding: 18px;
    font-size: 13px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere;
  }
  .preview-body .preview-fallback { color: #e5e7eb; text-align: center; display: flex; flex-direction: column; gap: 14px; align-items: center; }
  .preview-body .preview-fallback .btn { color: #e5e7eb; border: 1px solid rgba(255,255,255,.28); }
  .preview-body .preview-fallback .btn:hover { background: rgba(255,255,255,.14); }
  .preview-body .preview-fallback .btn.primary { background: #ffffff; color: #0f1115; border-color: transparent; }

  /* ---- Upload tray ---- */
  .tray {
    position: fixed; right: 18px; bottom: 18px; z-index: 55; width: min(340px, calc(100vw - 36px));
    background: var(--panel); border: 1px solid var(--line); border-radius: 14px;
    box-shadow: var(--shadow-lg); overflow: hidden; display: none;
  }
  .tray.open { display: block; }
  .tray-head { display: flex; align-items: center; gap: 8px; padding: 10px 14px; font-size: 13.5px; font-weight: 600; border-bottom: 1px solid var(--line); }
  .tray-head .tray-progress { font-size: 12px; font-weight: 500; color: var(--text-soft); white-space: nowrap; }
  .tray-head .spacer { flex: 1; }
  .tray-list { list-style: none; margin: 0; padding: 6px 0; max-height: 240px; overflow-y: auto; }
  .tray-list li { display: flex; align-items: center; gap: 8px; padding: 7px 14px; font-size: 13px; }
  .tray-list .tray-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tray-list .tray-status { font-size: 12px; color: var(--text-soft); flex-shrink: 0; }
  .tray-list .ok { color: var(--ok); } .tray-list .fail { color: var(--danger); }
  .tray-retry {
    padding: 4px 10px; border-radius: 999px; border: 1px solid var(--line);
    background: transparent; color: var(--active-text); font-size: 12px; font-weight: 500;
    cursor: pointer; flex-shrink: 0;
  }
  .tray-retry:hover { background: var(--hover); }
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
    position: fixed; left: 20px; bottom: 20px; z-index: 80;
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
    .mobile-nav { display: flex; }
    main { margin: 0 10px 10px; }
    .main-head { padding: 6px 8px 6px 12px; min-height: 58px; }
    .list-head { top: 58px; }
    .fab { display: inline-flex; }
    header.app { padding: 8px 12px; gap: 6px; }
    .brand { min-width: 44px; min-height: 44px; justify-content: center; border-radius: 10px; }
    .user-chip .user-name { display: none; }
    .brand .brand-text { display: none; }
    .search input { min-height: 44px; padding: 11px 48px 11px 44px; }
    .search-clear { width: 44px; height: 44px; right: 0; }
    .icon-btn { width: 44px; height: 44px; }
    .tray-close { width: 44px; height: 44px; }
    .text-btn { min-height: 44px; min-width: 44px; padding: 10px 10px; display: inline-flex; align-items: center; justify-content: center; }
    .lang-btn { min-width: 44px; height: 44px; }
    .mobile-nav .nav-item { min-height: 44px; padding: 8px 14px; }
    button.crumb { min-height: 44px; min-width: 44px; display: inline-flex; align-items: center; justify-content: center; }
    .tray-retry { min-height: 44px; padding: 10px 14px; }
    .seg { width: 44px; height: 44px; }
    .list-head .sortable { min-width: 44px; min-height: 44px; padding: 8px 4px; justify-content: flex-start; }
    .list-head.as-grid .sortable { min-width: 44px; min-height: 44px; padding: 8px 14px; justify-content: center; }
    .select-check { width: 44px; height: 44px; }
    .row .select-check { margin: 0 -6px 0 -10px; }
    .list-head:not(.as-grid) .select-check { margin: 0 -6px 0 -10px; }
    .card-check { top: 4px; left: 4px; }
    .bulk-bar { margin: 4px 10px 8px; padding: 8px 10px; }
    .bulk-bar .btn { min-height: 44px; padding: 8px 12px; }
    .kebab { width: 44px; height: 44px; }
    .row { min-height: 52px; height: auto; padding: 4px 12px 4px 16px; }
    .btn { min-height: 44px; padding: 10px 18px; display: inline-flex; align-items: center; justify-content: center; }
    .menu-item { min-height: 44px; padding: 10px 14px; }
    dialog input[type="text"], dialog select { min-height: 44px; }
    .tray { bottom: 84px; }
    .toast { bottom: 84px; }
  }
  @media (max-width: 640px) {
    header.app { flex-wrap: wrap; }
    .header-actions { gap: 4px; }
    .search { order: 3; flex: 1 0 100%; max-width: none; }
    .crumbs, .crumb, h1.crumb-heading { font-size: 17px; }
    .crumb { padding: 4px 6px; }
    .list-head, .row { grid-template-columns: minmax(0,1fr) 108px 44px; }
    .list-head:not(.as-grid) .sortable.col-size, .row-size { display: none; }
    .row-name { gap: 6px; }
    .row-name .row-mobile-size { display: block; }
    .cards, .skel-cards { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
    .card-thumb { height: 84px; }
    .preview-bar { padding: 8px 10px; gap: 4px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .spin, .icon-btn.spinning svg, .skel-box { animation: none; }
    .card, .toast, .select-check .check-box { transition: none; }
  }
</style>
</head>
<body>
  <!-- ---- Boot splash: shown until the session check settles ---- -->
  <div class="splash" id="splash">
    <div class="splash-card">
      <span class="mark">${svg(ICON_HDD, 17)}</span>
      <p id="splash-text" role="status" aria-live="polite" data-i18n="loading">${CATALOGS.en.loading}</p>
      <p id="splash-body" class="splash-body" hidden></p>
      <div class="splash-actions" id="splash-actions" hidden>
        <button type="button" class="btn primary" id="splash-retry" hidden data-i18n="retry">${CATALOGS.en.retry}</button>
        <button type="button" class="btn" id="splash-logout" hidden data-i18n="logout">${CATALOGS.en.logout}</button>
      </div>
    </div>
  </div>

  <!-- ---- Drive ---- -->
  <div id="app" hidden style="display:flex;flex-direction:column;flex:1;min-height:0">
  <a class="skip-link" href="#main" data-i18n="skipToContent">${CATALOGS.en.skipToContent}</a>
  <header class="app">
    <a class="brand" id="brand-link" href="/" aria-label="Takos Storage"><span class="mark">${svg(ICON_HDD, 17)}</span><span class="brand-text"><b>Takos</b> <span style="color:var(--text-soft);font-weight:400">Storage</span></span></a>
    <div class="search">
      <span class="search-icon">${svg(ICON_SEARCH, 18)}</span>
      <input id="q" name="q" type="search" data-i18n-placeholder="searchPlaceholder" data-i18n-label="searchPlaceholder" placeholder="${CATALOGS.en.searchPlaceholder}" aria-label="${CATALOGS.en.searchPlaceholder}" autocomplete="off">
      <button type="button" class="search-clear" id="q-clear" data-i18n-label="clearSearch" aria-label="${CATALOGS.en.clearSearch}" hidden>${svg(ICON_X, 15)}</button>
    </div>
    <div class="header-actions">
      <span class="user-chip" id="user-chip" role="img" hidden><span class="avatar" id="user-avatar" aria-hidden="true"></span><span class="user-name" id="user-name"></span></span>
      <button type="button" class="text-btn" id="logout" hidden data-i18n="logout">${CATALOGS.en.logout}</button>
      <button id="shortcuts-btn" class="icon-btn" type="button" data-i18n-label="shortcutsTitle" aria-label="${CATALOGS.en.shortcutsTitle}" title="${CATALOGS.en.shortcutsTitle}">${svg(ICON_HELP, 18)}</button>
      <button id="lang-toggle" class="lang-btn" type="button" aria-label="${CATALOGS.en.switchLang}" title="${CATALOGS.en.switchLang}">EN</button>
      <button id="theme-toggle" class="icon-btn" type="button" data-i18n-label="toggleTheme" aria-label="${CATALOGS.en.toggleTheme}"></button>
    </div>
  </header>

  <nav class="mobile-nav" data-i18n-label="navLabel" aria-label="${CATALOGS.en.navLabel}">
    <button type="button" class="nav-item" data-nav="files" aria-pressed="true">
      <span class="nav-icon">${svg(ICON_FOLDER, 16)}</span><span data-i18n="navFiles">${CATALOGS.en.navFiles}</span>
    </button>
    <button type="button" class="nav-item" data-nav="recent" aria-pressed="false">
      <span class="nav-icon">${svg(ICON_CLOCK, 16)}</span><span data-i18n="navRecent">${CATALOGS.en.navRecent}</span>
    </button>
    <span class="mobile-usage"><span id="mobile-usage-text"></span><span class="warn" id="mobile-usage-truncated" hidden role="img" data-i18n-label="usageTruncated" aria-label="${CATALOGS.en.usageTruncated}" title="${CATALOGS.en.usageTruncated}">•</span></span>
  </nav>

  <div class="layout">
    <aside>
      <button type="button" class="new-btn" id="new-btn" aria-haspopup="menu" aria-expanded="false">
        ${svg(ICON_PLUS, 22)}<span data-i18n="newButton">${CATALOGS.en.newButton}</span>
      </button>
      <nav id="side-nav" data-i18n-label="navLabel" aria-label="${CATALOGS.en.navLabel}">
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

    <main id="main" tabindex="-1">
      <div class="main-head">
        <nav class="crumbs" id="crumbs" data-i18n-label="breadcrumbLabel" aria-label="${CATALOGS.en.breadcrumbLabel}"></nav>
        <div class="main-head-actions">
          <button type="button" class="icon-btn" id="refresh-btn" data-i18n-label="refresh" aria-label="${CATALOGS.en.refresh}">${svg(ICON_REFRESH, 17)}</button>
          <div class="view-toggle" role="group" data-i18n-label="viewLabel" aria-label="${CATALOGS.en.viewLabel}">
            <button type="button" class="seg" data-view="list" aria-pressed="true" data-i18n-label="viewList" aria-label="${CATALOGS.en.viewList}">${svg(ICON_LIST, 18)}</button>
            <button type="button" class="seg" data-view="grid" aria-pressed="false" data-i18n-label="viewGrid" aria-label="${CATALOGS.en.viewGrid}">${svg(ICON_GRID, 18)}</button>
          </div>
        </div>
      </div>

      <section id="pending-deletions" class="pending-deletions" aria-labelledby="pending-title" hidden>
        <h2 id="pending-title" data-i18n="pendingTitle">${CATALOGS.en.pendingTitle}</h2>
        <p data-i18n="pendingBody">${CATALOGS.en.pendingBody}</p>
        <ul id="pending-list" class="pending-list"></ul>
      </section>
      <div id="search-truncated" class="search-notice" role="status" aria-live="polite" hidden>
        <span class="search-notice-text" data-i18n="searchTruncated">${CATALOGS.en.searchTruncated}</span>
        <button type="button" class="btn primary" id="search-load-more" data-i18n="loadMore">${CATALOGS.en.loadMore}</button>
      </div>
      <div id="bulk-bar" class="bulk-bar" role="region" data-i18n-label="bulkRegionLabel" aria-label="${CATALOGS.en.bulkRegionLabel}" hidden>
        <span id="bulk-count" class="bulk-count" role="status" aria-live="polite"></span>
        <div class="bulk-actions">
          <button type="button" class="btn" id="bulk-move">${svg(ICON_MOVE, 16)}<span data-i18n="bulkMove">${CATALOGS.en.bulkMove}</span></button>
          <button type="button" class="btn danger" id="bulk-delete" data-i18n="bulkDelete">${CATALOGS.en.bulkDelete}</button>
          <button type="button" class="btn" id="bulk-clear" data-i18n="bulkClear">${CATALOGS.en.bulkClear}</button>
        </div>
      </div>
      <div class="list-head" id="list-head" role="group" data-i18n-label="sortLabel" aria-label="${CATALOGS.en.sortLabel}">
        <div class="list-head-name">
          <button type="button" role="checkbox" class="select-check" id="select-all" aria-checked="false" aria-label="${CATALOGS.en.selectAll}" title="${CATALOGS.en.selectAll}"><span class="check-box" aria-hidden="true"><span class="check-mark">${svg(ICON_CHECK, 13)}</span><span class="check-mixed">${svg(ICON_MINUS, 13)}</span></span></button>
          <button type="button" class="sortable" data-sort="name" aria-pressed="false" aria-label="${CATALOGS.en.sortAction.replace("{label}", CATALOGS.en.colName)}"><span data-i18n="colName">${CATALOGS.en.colName}</span><span class="sort-arrow" data-arrow="name" aria-hidden="true"></span></button>
        </div>
        <button type="button" class="sortable col-size" data-sort="size" aria-pressed="false" aria-label="${CATALOGS.en.sortAction.replace("{label}", CATALOGS.en.colSize)}"><span data-i18n="colSize">${CATALOGS.en.colSize}</span><span class="sort-arrow" data-arrow="size" aria-hidden="true"></span></button>
        <button type="button" class="sortable" data-sort="uploaded" aria-pressed="true" aria-label="${CATALOGS.en.sortBy.replace("{label}", CATALOGS.en.colUpdated).replace("{dir}", CATALOGS.en.sortDesc)}"><span data-i18n="colUpdated">${CATALOGS.en.colUpdated}</span><span class="sort-arrow" data-arrow="uploaded" aria-hidden="true">▼</span></button>
        <span></span>
      </div>
      <ul class="rows" id="rows"></ul>
      <div class="cards" id="cards" hidden></div>
      <div class="state" id="state" hidden></div>
      <button type="button" class="btn" id="load-more" hidden data-i18n="loadMore">${CATALOGS.en.loadMore}</button>
      <div class="drop-overlay" id="drop-overlay"><span data-i18n="dropHint">${CATALOGS.en.dropHint}</span></div>
    </main>
  </div>
  </div>

  <button type="button" class="fab" id="fab" aria-haspopup="menu" aria-expanded="false" data-i18n-label="newButton" aria-label="${CATALOGS.en.newButton}" hidden>${svg(ICON_PLUS, 24)}</button>

  <input type="file" id="file-input" multiple hidden>

  <div class="float-menu" id="new-menu" role="menu">
    <button type="button" role="menuitem" class="menu-item" data-new="upload"><span class="menu-icon">${svg(ICON_UPLOAD, 18)}</span><span data-i18n="actionUpload">${CATALOGS.en.actionUpload}</span></button>
    <button type="button" role="menuitem" class="menu-item" data-new="folder"><span class="menu-icon">${svg(ICON_FOLDER, 18)}</span><span data-i18n="actionNewFolder">${CATALOGS.en.actionNewFolder}</span></button>
  </div>

  <div class="float-menu" id="item-menu" role="menu">
    <button type="button" role="menuitem" class="menu-item" data-action="open"><span class="menu-icon">${svg('<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>', 18)}</span><span data-i18n="menuOpen">${CATALOGS.en.menuOpen}</span></button>
    <button type="button" role="menuitem" class="menu-item" data-action="download"><span class="menu-icon">${svg('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>', 18)}</span><span data-i18n="menuDownload">${CATALOGS.en.menuDownload}</span></button>
    <button type="button" role="menuitem" class="menu-item" data-action="rename"><span class="menu-icon">${svg('<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>', 18)}</span><span data-i18n="menuRename">${CATALOGS.en.menuRename}</span></button>
    <button type="button" role="menuitem" class="menu-item" data-action="move"><span class="menu-icon">${svg(ICON_MOVE, 18)}</span><span data-i18n="menuMove">${CATALOGS.en.menuMove}</span></button>
    <hr class="menu-sep">
    <button type="button" role="menuitem" class="menu-item danger" data-action="delete"><span class="menu-icon">${svg('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>', 18)}</span><span data-i18n="menuDelete">${CATALOGS.en.menuDelete}</span></button>
  </div>

  <dialog id="name-dialog" aria-labelledby="name-dialog-title">
    <h2 id="name-dialog-title"></h2>
    <p id="name-dialog-note" hidden></p>
    <form method="dialog" id="name-form">
      <label for="name-input" id="name-input-label"></label>
      <input type="text" id="name-input" name="name" autocomplete="off" aria-describedby="name-error">
      <p class="field-error" id="name-error" role="alert" hidden></p>
      <div class="dialog-actions">
        <button type="button" class="btn" data-close data-i18n="cancel">${CATALOGS.en.cancel}</button>
        <button type="submit" class="btn primary" data-i18n="save">${CATALOGS.en.save}</button>
      </div>
    </form>
  </dialog>

  <dialog id="move-dialog" aria-labelledby="move-dialog-title">
    <h2 id="move-dialog-title" data-i18n="moveTitle">${CATALOGS.en.moveTitle}</h2>
    <p id="move-dialog-item"></p>
    <p id="move-dialog-note" hidden></p>
    <form method="dialog" id="move-form">
      <label for="move-folder" data-i18n="moveFolderLabel">${CATALOGS.en.moveFolderLabel}</label>
      <select id="move-folder" name="folder" aria-describedby="move-error"></select>
      <div class="dialog-field" id="move-custom-wrap" hidden>
        <label for="move-custom-input" data-i18n="moveCustomLabel">${CATALOGS.en.moveCustomLabel}</label>
        <input type="text" id="move-custom-input" name="customFolder" autocomplete="off" data-i18n-placeholder="moveCustomPlaceholder" placeholder="${CATALOGS.en.moveCustomPlaceholder}" aria-describedby="move-error">
      </div>
      <p class="field-error" id="move-error" role="alert" hidden></p>
      <div class="dialog-actions">
        <button type="button" class="btn" data-close data-i18n="cancel">${CATALOGS.en.cancel}</button>
        <button type="submit" class="btn primary" data-i18n="moveConfirm">${CATALOGS.en.moveConfirm}</button>
      </div>
    </form>
  </dialog>

  <dialog id="delete-dialog" aria-labelledby="delete-title">
    <h2 id="delete-title" data-i18n="deleteTitle">${CATALOGS.en.deleteTitle}</h2>
    <p id="delete-body"></p>
    <div class="dialog-actions">
      <button type="button" class="btn" data-close data-i18n="cancel">${CATALOGS.en.cancel}</button>
      <button type="button" class="btn danger" id="delete-confirm" data-i18n="deleteConfirm">${CATALOGS.en.deleteConfirm}</button>
    </div>
  </dialog>

  <dialog id="cleanup-dialog" aria-labelledby="cleanup-title">
    <h2 id="cleanup-title" data-i18n="cleanupTitle">${CATALOGS.en.cleanupTitle}</h2>
    <p id="cleanup-body"></p>
    <div class="dialog-actions">
      <button type="button" class="btn" data-close data-i18n="cancel">${CATALOGS.en.cancel}</button>
      <button type="button" class="btn primary" id="cleanup-confirm" data-i18n="cleanupAction">${CATALOGS.en.cleanupAction}</button>
    </div>
  </dialog>

  <dialog id="folder-result-dialog" aria-labelledby="folder-result-title">
    <h2 id="folder-result-title" data-i18n="folderResultTitle">${CATALOGS.en.folderResultTitle}</h2>
    <p id="folder-result-message"></p>
    <pre id="folder-result-paths" style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:40vh;overflow:auto"></pre>
    <div class="dialog-actions">
      <button type="button" class="btn" data-close data-i18n="folderDismiss">${CATALOGS.en.folderDismiss}</button>
    </div>
  </dialog>

  <dialog id="shortcuts-dialog" aria-labelledby="shortcuts-title">
    <h2 id="shortcuts-title" data-i18n="shortcutsTitle">${CATALOGS.en.shortcutsTitle}</h2>
    <dl class="shortcut-list">
      <dt><kbd>/</kbd></dt><dd data-i18n="shortcutSearch">${CATALOGS.en.shortcutSearch}</dd>
      <dt><kbd>n</kbd></dt><dd data-i18n="shortcutNewFolder">${CATALOGS.en.shortcutNewFolder}</dd>
      <dt><kbd>u</kbd></dt><dd data-i18n="shortcutUpload">${CATALOGS.en.shortcutUpload}</dd>
      <dt><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd></dt><dd data-i18n="shortcutNav">${CATALOGS.en.shortcutNav}</dd>
      <dt><kbd>Backspace</kbd></dt><dd data-i18n="shortcutUp">${CATALOGS.en.shortcutUp}</dd>
      <dt><kbd>Esc</kbd></dt><dd data-i18n="shortcutEsc">${CATALOGS.en.shortcutEsc}</dd>
      <dt><kbd>?</kbd></dt><dd data-i18n="shortcutHelp">${CATALOGS.en.shortcutHelp}</dd>
    </dl>
    <div class="dialog-actions">
      <button type="button" class="btn primary" data-close data-i18n="close">${CATALOGS.en.close}</button>
    </div>
  </dialog>

  <div class="preview" id="preview" role="dialog" aria-modal="true" aria-labelledby="preview-name" tabindex="-1">
    <div class="preview-bar">
      <div class="preview-title-wrap">
        <span class="preview-name" id="preview-name"></span>
        <span class="preview-meta" id="preview-meta"></span>
      </div>
      <div class="preview-nav" id="preview-nav" hidden>
        <button type="button" class="icon-btn" id="preview-prev" data-i18n-label="previewPrev" aria-label="${CATALOGS.en.previewPrev}">${svg(ICON_CHEVRON_LEFT, 18)}</button>
        <span class="preview-pos" id="preview-pos"></span>
        <button type="button" class="icon-btn" id="preview-next" data-i18n-label="previewNext" aria-label="${CATALOGS.en.previewNext}">${svg(ICON_CHEVRON_RIGHT, 18)}</button>
      </div>
      <button type="button" class="icon-btn" id="preview-download" data-i18n-label="download" aria-label="${CATALOGS.en.download}">${svg('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>', 18)}</button>
      <button type="button" class="icon-btn" id="preview-close" data-i18n-label="close" aria-label="${CATALOGS.en.close}">${svg(ICON_X, 18)}</button>
    </div>
    <div class="preview-body" id="preview-body"></div>
  </div>

  <div class="tray" id="tray">
    <div class="tray-head"><span id="tray-title" data-i18n="upTrayTitle">${CATALOGS.en.upTrayTitle}</span><span class="tray-progress" id="tray-progress" aria-live="polite"></span><span class="spacer"></span>
      <button type="button" class="icon-btn tray-close" id="tray-close" data-i18n-label="close" aria-label="${CATALOGS.en.close}">${svg(ICON_X, 15)}</button>
    </div>
    <ul class="tray-list" id="tray-list"></ul>
  </div>

  <div class="toast" id="toast" role="status" aria-live="polite"></div>
  <div class="toast" id="folder-progress" role="status" aria-live="polite" hidden></div>

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
  var langBtn = document.getElementById("lang-toggle");
  function paintLang() {
    if (!langBtn) return;
    langBtn.textContent = lang.toUpperCase();
    langBtn.setAttribute("aria-label", t("switchLang"));
    langBtn.setAttribute("title", t("switchLang"));
  }
  function applyI18n() {
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
    paintLang();
  }
  applyI18n();
  if (langBtn) {
    langBtn.addEventListener("click", function () {
      lang = lang === "ja" ? "en" : "ja";
      try { localStorage.setItem("takos-lang", lang); } catch (e) { /* ignore */ }
      applyI18n();
      paintUserChip();
      renderUsage();
      renderTrayHeader();
      repaintUploadEntries();
      render();
    });
  }

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
    files: [],            // [{path,size,uploaded,etag}] relative to the drive root
    pending: [],
    cursor: null,
    truncated: false,
    nav: "files",        // files | recent
    path: "",            // current folder, "" or "a/b/"
    view: "list",
    sort: { key: "uploaded", dir: "desc" },
    query: "",
    loading: true,
    loadedOnce: false,
    loadingMore: false,
    failed: false,
    failStatus: null,
  };
  try {
    var storedView = localStorage.getItem("takos-storage-view");
    if (storedView === "grid" || storedView === "list") state.view = storedView;
  } catch (e) { /* keep list */ }

  var splashEl = document.getElementById("splash");
  var appEl = document.getElementById("app");
  var fabEl = document.getElementById("fab");
  var mainEl = document.getElementById("main");
  var tray = document.getElementById("tray");
  var rowsEl = document.getElementById("rows");
  var cardsEl = document.getElementById("cards");
  var listHeadEl = document.getElementById("list-head");
  var stateEl = document.getElementById("state");
  var crumbsEl = document.getElementById("crumbs");
  var toastEl = document.getElementById("toast");
  var searchInput = document.getElementById("q");
  var searchClearBtn = document.getElementById("q-clear");
  var refreshBtn = document.getElementById("refresh-btn");
  var brandLink = document.getElementById("brand-link");
  var bulkBarEl = document.getElementById("bulk-bar");
  var bulkCountEl = document.getElementById("bulk-count");
  var bulkMoveBtn = document.getElementById("bulk-move");
  var bulkDeleteBtn = document.getElementById("bulk-delete");
  var bulkClearBtn = document.getElementById("bulk-clear");
  var selectAllBtn = document.getElementById("select-all");
  var shortcutsBtn = document.getElementById("shortcuts-btn");
  var shortcutsDialog = document.getElementById("shortcuts-dialog");
  var CHECK_SVG = ${JSON.stringify(svg(ICON_CHECK, 13))};
  var currentVisible = [];
  var currentUserName = "";
  var folderBusy = false;
  var cleanupBusy = false;
  var cleanupTarget = null;
  var cleanupVerified = null;
  var cleanupOpener = null;
  var folderResultOpener = null;
  var shortcutsOpener = null;
  var actionEntries = null;
  var selectedPaths = Object.create(null);
  var lastSelectedIndex = -1;
  var bulkActionPlan = null;
  var dragItems = null;
  var activeDropTarget = null;

  // ---- URL state & history ----
  function normalizeUrlFolder(raw) {
    if (typeof raw !== "string") return "";
    var trimmed = raw.trim();
    if (!trimmed) return "";
    if (trimmed.charAt(0) === "/" || trimmed.indexOf("\\\\") >= 0 || /[\\u0000-\\u001f\\u007f]/.test(trimmed)) return "";
    var cleaned = trimmed.slice(-1) === "/" ? trimmed.slice(0, -1) : trimmed;
    var segments = cleaned.split("/");
    if (!segments.length) return "";
    for (var i = 0; i < segments.length; i++) {
      if (!segments[i] || segments[i] === "." || segments[i] === "..") return "";
    }
    return segments.join("/") + "/";
  }
  function readUrlState() {
    var search = (typeof location !== "undefined" && location && typeof location.search === "string") ? location.search : "";
    if (!search || typeof URLSearchParams !== "function") {
      return { nav: "files", path: "", query: "" };
    }
    var params;
    try { params = new URLSearchParams(search); } catch (e) { return { nav: "files", path: "", query: "" }; }
    var rawView = params.get("view");
    var nav = rawView === "recent" ? "recent" : "files";
    var path = nav === "files" ? normalizeUrlFolder(params.get("path") || "") : "";
    var query = (params.get("q") || "").trim();
    return { nav: nav, path: path, query: query };
  }
  function applyUrlState() {
    var parsed = readUrlState();
    state.nav = parsed.nav;
    state.path = parsed.path;
    state.query = parsed.query;
    if (searchInput) searchInput.value = parsed.query;
    if (state.nav === "recent" && !state.query) {
      state.sort = { key: "uploaded", dir: "desc" };
    }
  }
  function buildUrlSearch() {
    var parts = [];
    if (state.nav === "recent") {
      parts.push("view=recent");
    } else if (state.path) {
      parts.push("path=" + encodeURIComponent(state.path));
    }
    if (state.query) {
      parts.push("q=" + encodeURIComponent(state.query));
    }
    return parts.length ? "?" + parts.join("&") : "";
  }
  function syncUrl(mode) {
    if (typeof history === "undefined" || !history || typeof location === "undefined" || !location) return;
    var fn = mode === "replace" ? history.replaceState : history.pushState;
    if (typeof fn !== "function") return;
    var nextSearch = buildUrlSearch();
    var currentSearch = typeof location.search === "string" ? location.search : "";
    if (nextSearch === currentSearch) return;
    var pathname = typeof location.pathname === "string" && location.pathname ? location.pathname : "/";
    try {
      fn.call(history, null, "", pathname + nextSearch);
    } catch (e) { /* ignore restricted origins */ }
  }
  applyUrlState();

  // ---- Lazy grid thumbnails (strict blob URL lifecycle & bounds) ----
  var THUMB_MAX_BYTES = 4 * 1024 * 1024;
  var THUMB_MAX_CONCURRENCY = 3;
  var THUMB_MAX_ENTRIES = 48;
  var thumbUrls = Object.create(null);
  var thumbOrder = [];
  var thumbQueue = [];
  var thumbInFlight = 0;
  var thumbGeneration = 0;
  var thumbObserver = null;
  function isThumbEligible(item) {
    return Boolean(
      item &&
      item.type === "file" &&
      Object.prototype.hasOwnProperty.call(PREVIEW_IMAGE_EXT, extOf(item.name)) &&
      typeof item.size === "number" &&
      item.size > 0 &&
      item.size <= THUMB_MAX_BYTES
    );
  }
  function thumbKeyFor(item) {
    return item.path + "\\u0000" + (item.etag || "");
  }
  function revokeThumbKey(key) {
    if (!thumbUrls[key]) return;
    var url = thumbUrls[key];
    delete thumbUrls[key];
    var pos = thumbOrder.indexOf(key);
    if (pos >= 0) thumbOrder.splice(pos, 1);
    try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
  }
  function clearThumbs(keepKeys) {
    if (thumbObserver && typeof thumbObserver.disconnect === "function") {
      thumbObserver.disconnect();
    }
    thumbObserver = null;
    thumbQueue = [];
    thumbGeneration += 1;
    var existing = thumbOrder.slice();
    existing.forEach(function (key) {
      if (!keepKeys || !keepKeys[key]) revokeThumbKey(key);
    });
  }
  function mountThumbImg(thumbEl, url, cacheKey) {
    if (!thumbEl || (typeof thumbEl.isConnected === "boolean" && !thumbEl.isConnected)) return;
    var existingImg = typeof thumbEl.querySelector === "function" ? thumbEl.querySelector(".card-thumb-img") : null;
    if (existingImg) return;
    var img = document.createElement("img");
    img.className = "card-thumb-img";
    img.alt = "";
    img.src = url;
    img.addEventListener("error", function () {
      if (thumbUrls[cacheKey] === url) revokeThumbKey(cacheKey);
      if (typeof img.remove === "function") img.remove();
    });
    thumbEl.appendChild(img);
  }
  function drainThumbQueue() {
    while (thumbInFlight < THUMB_MAX_CONCURRENCY && thumbQueue.length) {
      var task = thumbQueue.shift();
      if (!task || task.gen !== thumbGeneration) continue;
      if (typeof task.el.isConnected === "boolean" && !task.el.isConnected) continue;
      if (thumbUrls[task.cacheKey]) {
        mountThumbImg(task.el, thumbUrls[task.cacheKey], task.cacheKey);
        continue;
      }
      (function (job) {
        thumbInFlight += 1;
        function isCurrentThumb() {
          return job.gen === thumbGeneration && (typeof job.el.isConnected !== "boolean" || job.el.isConnected);
        }
        api(fileUrl(job.path), null, isCurrentThumb).then(function (r) {
          if (!isCurrentThumb() || !r || !r.ok) return null;
          return r.blob();
        }).then(function (blob) {
          if (!blob || !isCurrentThumb()) return;
          if (thumbUrls[job.cacheKey]) {
            mountThumbImg(job.el, thumbUrls[job.cacheKey], job.cacheKey);
            return;
          }
          while (thumbOrder.length >= THUMB_MAX_ENTRIES) {
            revokeThumbKey(thumbOrder[0]);
          }
          var url = URL.createObjectURL(blob);
          thumbUrls[job.cacheKey] = url;
          thumbOrder.push(job.cacheKey);
          mountThumbImg(job.el, url, job.cacheKey);
        }).catch(function () {
          /* keep icon fallback */
        }).finally(function () {
          thumbInFlight = Math.max(0, thumbInFlight - 1);
          drainThumbQueue();
        });
      })(task);
    }
  }
  function observeGridThumbs(entries) {
    if (!entries.length) return;
    var gen = thumbGeneration;
    var pending = [];
    entries.forEach(function (entry) {
      if (thumbUrls[entry.cacheKey]) {
        mountThumbImg(entry.el, thumbUrls[entry.cacheKey], entry.cacheKey);
      } else {
        pending.push(entry);
      }
    });
    if (!pending.length || typeof IntersectionObserver !== "function") return;
    var byEl = [];
    thumbObserver = new IntersectionObserver(function (obsEntries) {
      if (gen !== thumbGeneration) return;
      obsEntries.forEach(function (obsEntry) {
        if (!obsEntry.isIntersecting) return;
        if (thumbObserver && typeof thumbObserver.unobserve === "function") {
          thumbObserver.unobserve(obsEntry.target);
        }
        for (var i = 0; i < byEl.length; i++) {
          if (byEl[i].el === obsEntry.target && !byEl[i].queued) {
            byEl[i].queued = true;
            thumbQueue.push({ el: byEl[i].el, path: byEl[i].path, cacheKey: byEl[i].cacheKey, gen: gen });
            break;
          }
        }
      });
      drainThumbQueue();
    }, { root: mainEl || null, rootMargin: "120px" });
    pending.forEach(function (entry) {
      byEl.push({ el: entry.el, path: entry.path, cacheKey: entry.cacheKey, queued: false });
      thumbObserver.observe(entry.el);
    });
  }
  function closeDialogsForNavigation() {
    [nameDialog, moveDialog, deleteDialog, cleanupDialog, folderResultDialog, shortcutsDialog].forEach(function (dlg) {
      if (dlg && dlg.open && typeof dlg.close === "function") {
        if (dlg === nameDialog) nameOpener = null;
        else if (dlg === moveDialog) { moveOpener = null; bulkActionPlan = null; }
        else if (dlg === deleteDialog) { deleteOpener = null; bulkActionPlan = null; }
        else if (dlg === cleanupDialog) { cleanupOpener = null; cleanupTarget = null; cleanupVerified = null; }
        else if (dlg === folderResultDialog) folderResultOpener = null;
        else if (dlg === shortcutsDialog) shortcutsOpener = null;
        dlg.close();
      }
    });
  }
  window.addEventListener("pagehide", function () { clearThumbs(null); });
  window.addEventListener("popstate", function () {
    clearTimeout(searchTimer);
    closeMenus(false);
    closePreview(false);
    closeDialogsForNavigation();
    clearSelection(false);
    applyUrlState();
    render();
  });

  // ---- Selection ----
  function selectedVisibleItems() {
    return currentVisible.filter(function (item) { return Boolean(selectedPaths[item.path]); });
  }
  function selectedCount() {
    return selectedVisibleItems().length;
  }
  function pruneSelection(items) {
    var allowed = Object.create(null);
    items.forEach(function (item) { allowed[item.path] = true; });
    Object.keys(selectedPaths).forEach(function (path) {
      if (!allowed[path]) delete selectedPaths[path];
    });
  }
  function clearSelection(syncUi) {
    var focusInBulk = Boolean(
      syncUi &&
      bulkBarEl &&
      typeof bulkBarEl.contains === "function" &&
      document.activeElement &&
      bulkBarEl.contains(document.activeElement)
    );
    selectedPaths = Object.create(null);
    lastSelectedIndex = -1;
    if (syncUi) {
      syncSelectionUi();
      if (focusInBulk) {
        if (isUsableFocusTarget(selectAllBtn)) {
          selectAllBtn.focus();
          if (document.activeElement === selectAllBtn) return;
        }
        if (mainEl && typeof mainEl.focus === "function") mainEl.focus();
      }
    }
  }
  function syncSelectionUi() {
    var selected = selectedVisibleItems();
    var count = selected.length;
    var total = currentVisible.length;
    var busy = state.loading || state.failed || folderBusy || cleanupBusy;
    if (bulkBarEl) bulkBarEl.hidden = count === 0 || state.loading || state.failed;
    if (bulkCountEl) bulkCountEl.textContent = count ? t("bulkSelected", { count: count }) : "";
    if (bulkMoveBtn) bulkMoveBtn.disabled = busy || count === 0;
    if (bulkDeleteBtn) bulkDeleteBtn.disabled = busy || count === 0;
    if (bulkClearBtn) bulkClearBtn.disabled = count === 0;
    if (selectAllBtn) {
      var allSelected = total > 0 && count === total;
      selectAllBtn.setAttribute("aria-checked", count === 0 ? "false" : (allSelected ? "true" : "mixed"));
      var allLabel = t(allSelected ? "deselectAll" : "selectAll");
      selectAllBtn.setAttribute("aria-label", allLabel);
      selectAllBtn.setAttribute("title", allLabel);
      selectAllBtn.disabled = total === 0 || busy;
    }
    var container = state.view === "list" ? rowsEl : cardsEl;
    if (container && typeof container.querySelectorAll === "function") {
      container.querySelectorAll(".select-check[data-select]").forEach(function (btn) {
        var idx = Number(btn.getAttribute("data-select"));
        var item = currentVisible[idx];
        var isSelected = Boolean(item && selectedPaths[item.path]);
        btn.setAttribute("aria-checked", String(isSelected));
        var parent = btn.closest ? btn.closest(".row, .card") : null;
        if (parent && parent.classList) {
          if (isSelected) parent.classList.add("selected");
          else parent.classList.remove("selected");
        }
      });
    }
  }

  function paintUserChip() {
    if (!currentUserName) return;
    var chip = document.getElementById("user-chip");
    if (!chip) return;
    var chipLabel = t("signedInAs", { name: currentUserName });
    chip.title = chipLabel;
    chip.setAttribute("aria-label", chipLabel);
  }

  // ---- Helpers ----
  function esc(s) { var d = document.createElement("div"); d.textContent = s == null ? "" : s; return d.innerHTML.replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }
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
  var EXT_KIND = Object.assign(Object.create(null), {
    png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", svg: "image", avif: "image", ico: "image",
    mp4: "video", webm: "video", mov: "video", mkv: "video",
    mp3: "audio", wav: "audio", ogg: "audio", flac: "audio", m4a: "audio",
    txt: "text", md: "text", json: "text", js: "text", ts: "text", css: "text", html: "text",
    csv: "text", log: "text", yaml: "text", yml: "text", toml: "text", xml: "text", tf: "text",
    pdf: "pdf", zip: "archive", gz: "archive", tar: "archive", "7z": "archive", rar: "archive",
  });
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
  var PREVIEW_IMAGE_EXT = Object.assign(Object.create(null), {
    png: 1, jpg: 1, jpeg: 1, gif: 1, webp: 1, avif: 1, ico: 1,
  });
  function extOf(name) {
    var dot = name.lastIndexOf(".");
    return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
  }
  function kindOf(name) {
    var ext = extOf(name);
    if (!ext) return "file";
    return EXT_KIND[ext] || "file";
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
  function api(path, init, isCurrent) {
    init = init || {};
    init.credentials = "same-origin";
    return fetch(path, init).then(function (r) {
      if (r.status === 401 && (!isCurrent || isCurrent())) { redirectToLogin(); return new Promise(function () {}); }
      return r;
    });
  }
  function fileUrl(path) {
    return "/api/drive/file/" + encodeURIComponent(path);
  }
  function checkMutationResponse(response) {
    if (!response.ok) {
      var error = new Error("http " + response.status);
      error.status = response.status;
      throw error;
    }
    return response;
  }
  function mutationFailed(error) {
    toast(t(error && (error.status === 412 || error.status === 409) ? "errConflict" : "errAction"));
    load();
  }
  function folderSnapshot(item) {
    if (folderBusy || state.loading || state.failed || state.truncated) return null;
    var entries = state.files.filter(function (file) { return file.path.indexOf(item.path) === 0; });
    if (!entries.length || entries.length > ${MAX_FOLDER_OBJECTS} || entries.some(function (file) { return !file.etag; })) return null;
    return entries.map(function (file) { return { path: file.path, etag: file.etag }; });
  }
  function folderUnavailable() {
    toast(t("folderUnavailable", { count: ${MAX_FOLDER_OBJECTS}, size: fmtBytes(${MAX_FOLDER_TOTAL_BYTES}) }));
  }
  function folderResult(data, unknown, cleanup) {
    var completed = data && Array.isArray(data.completed) ? data.completed : [];
    var remaining = data && Array.isArray(data.remaining) ? data.remaining : [];
    document.getElementById("folder-result-title").textContent = t(cleanup ? "cleanupResultTitle" : "folderResultTitle");
    document.getElementById("folder-result-message").textContent = t(cleanup === "operator" ? "cleanupOperator" : cleanup ? "cleanupUnknown" : unknown ? "folderUnknown" : "folderIncomplete");
    // Paths are user-controlled. Display text only, including uncertain paths;
    // never turn server error details into markup or an automatic retry.
    document.getElementById("folder-result-paths").textContent =
      t("folderCompleted", { count: completed.length }) + "\\n" + completed.join("\\n") +
      "\\n\\n" + t("folderRemaining") + "\\n" + remaining.join("\\n");
    folderResultOpener = document.activeElement;
    document.getElementById("folder-result-dialog").showModal();
  }
  function bulkResult(completed, remaining, unknown) {
    document.getElementById("folder-result-title").textContent = t("bulkResultTitle");
    document.getElementById("folder-result-message").textContent = t(unknown ? "bulkUnknown" : "bulkIncomplete");
    document.getElementById("folder-result-paths").textContent =
      t("folderCompleted", { count: completed.length }) + "\\n" + completed.join("\\n") +
      "\\n\\n" + t("folderRemaining") + "\\n" + remaining.join("\\n");
    folderResultOpener = document.activeElement;
    document.getElementById("folder-result-dialog").showModal();
  }
  function buildBulkPlan(items) {
    if (folderBusy || cleanupBusy || state.loading || state.failed || !items || !items.length) return null;
    var plan = [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (item.type === "folder") {
        var entries = folderSnapshot(item);
        if (!entries) {
          folderUnavailable();
          return null;
        }
        plan.push({ item: item, entries: entries });
      } else {
        if (!item.etag) {
          toast(t("errRevision"));
          return null;
        }
        plan.push({ item: item, entries: null });
      }
    }
    return plan;
  }
  function runBulkOperation(operation, plan, destination) {
    if (folderBusy || cleanupBusy || !plan || !plan.length) return;
    folderBusy = true;
    renderPending();
    syncSelectionUi();
    var progress = document.getElementById("folder-progress");
    var total = plan.length;
    var completed = [];
    var failed = [];
    var remaining = [];
    var uncertain = false;
    function showStepProgress(doneCount) {
      progress.textContent = t(operation === "move" ? "bulkWorkingMove" : "bulkWorkingDelete", { done: doneCount, total: total });
      progress.hidden = false;
      progress.classList.add("show");
    }
    showStepProgress(0);
    function collectRest(startIdx) {
      for (var j = startIdx; j < plan.length; j++) {
        var restStep = plan[j];
        if (restStep.entries) {
          restStep.entries.forEach(function (entry) { remaining.push(entry.path); });
        } else {
          remaining.push(restStep.item.path);
        }
      }
    }
    function runStep(index) {
      if (index >= plan.length) return Promise.resolve();
      showStepProgress(index);
      var step = plan[index];
      var item = step.item;
      if (item.type === "folder") {
        var folderInput = { operation: operation === "move" ? "rename" : "delete", source_path: item.path, entries: step.entries };
        if (operation === "move") folderInput.destination_path = destination + item.name + "/";
        return api("/api/drive/folder", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(folderInput),
        }).then(function (response) {
          return response.json().then(function (data) {
            if (response.ok && data && data.ok === true && Array.isArray(data.completed) && data.completed.length === step.entries.length) {
              completed.push(item.path);
              return runStep(index + 1);
            }
            if (data && data.error === "folder_operation_incomplete") {
              if (Array.isArray(data.completed)) data.completed.forEach(function (p) { completed.push(p); });
              if (Array.isArray(data.remaining)) data.remaining.forEach(function (p) { remaining.push(p); });
              if (data.outcome_uncertain) uncertain = true;
              collectRest(index + 1);
              return;
            }
            if (response.status === 404 || response.status === 409 || response.status === 412 || response.status === 413) {
              failed.push(item.path);
              return runStep(index + 1);
            }
            uncertain = true;
            collectRest(index);
          });
        }).catch(function () {
          uncertain = true;
          collectRest(index);
        });
      }
      var reqPromise = operation === "move"
        ? api("/api/drive/move", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            source_path: item.path,
            destination_path: destination + item.name,
            source_etag: item.etag,
          }),
        })
        : api(fileUrl(item.path), {
          method: "DELETE",
          headers: { "if-match": item.etag },
        });
      return reqPromise.then(function (response) {
        if (response.ok) {
          completed.push(item.path);
          return runStep(index + 1);
        }
        if (response.status === 404 || response.status === 409 || response.status === 412 || response.status === 413) {
          failed.push(item.path);
          return runStep(index + 1);
        }
        uncertain = true;
        collectRest(index);
      }).catch(function () {
        uncertain = true;
        collectRest(index);
      });
    }
    runStep(0).finally(function () {
      folderBusy = false;
      progress.classList.remove("show");
      progress.hidden = true;
      clearSelection(false);
      if (failed.length === 0 && remaining.length === 0 && !uncertain) {
        toast(t(operation === "move" ? "bulkMoved" : "bulkDeleted", { count: completed.length }));
      } else {
        bulkResult(completed, failed.concat(remaining), uncertain);
      }
      load();
    });
  }
  function runFolderOperation(operation, item, destination) {
    if (folderBusy || cleanupBusy || !actionEntries) return;
    var entries = actionEntries.map(function (entry) { return { path: entry.path, etag: entry.etag }; });
    actionEntries = null;
    folderBusy = true;
    renderPending();
    var progress = document.getElementById("folder-progress");
    progress.textContent = t("folderWorking");
    progress.hidden = false;
    progress.classList.add("show");
    var input = { operation: operation, source_path: item.path, entries: entries };
    if (destination) input.destination_path = destination;
    api("/api/drive/folder", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
    }).then(function (response) {
      return response.json().then(function (data) {
        if (response.ok && data.ok === true && Array.isArray(data.completed) && data.completed.length === entries.length) {
          toast(t("folderDone", { count: data.completed.length }));
        } else if (data.error === "folder_operation_incomplete") {
          folderResult(data, !!data.outcome_uncertain);
        } else if (response.status === 409 || response.status === 412) {
          toast(t("errConflict"));
        } else {
          folderResult(null, true);
        }
      });
    }).catch(function () {
      folderResult(null, true);
    }).finally(function () {
      folderBusy = false;
      progress.classList.remove("show");
      progress.hidden = true;
      load();
    });
  }

  // ---- Session boot ----
  function setSplash(titleKey, bodyKey, opts) {
    opts = opts || {};
    var textEl = document.getElementById("splash-text");
    if (textEl) {
      textEl.textContent = t(titleKey);
      textEl.setAttribute("role", opts.alert ? "alert" : "status");
      textEl.setAttribute("aria-live", opts.alert ? "assertive" : "polite");
    }
    var bodyEl = document.getElementById("splash-body");
    if (bodyEl) {
      bodyEl.textContent = bodyKey ? t(bodyKey) : "";
      bodyEl.hidden = !bodyKey;
    }
    var actionsEl = document.getElementById("splash-actions");
    var retryEl = document.getElementById("splash-retry");
    var logoutEl = document.getElementById("splash-logout");
    if (retryEl) retryEl.hidden = !opts.retry;
    if (logoutEl) logoutEl.hidden = !opts.logout;
    if (actionsEl) actionsEl.hidden = !(opts.retry || opts.logout);
  }
  function performLogout(btn) {
    if (btn) btn.disabled = true;
    api("/api/auth/logout", { method: "POST" }).then(function (r) {
      if (!r.ok) throw new Error("http " + r.status);
      location.reload();
    }).catch(function () {
      if (btn) btn.disabled = false;
      toast(t("errAction"));
    });
  }
  function boot() {
    setSplash("loading", null);
    api("/api/auth/me").then(function (r) {
      if (r.status === 503) {
        setSplash("authBroken", null, { alert: true });
        var broken = new Error("auth_misconfigured");
        broken.handled = true;
        throw broken;
      }
      if (r.status === 403) {
        setSplash("authDenied", "authDeniedBody", { alert: true, logout: true });
        var denied = new Error("auth_denied");
        denied.handled = true;
        throw denied;
      }
      if (!r.ok) throw new Error("http " + r.status);
      return r.json();
    }).then(function (me) {
      splashEl.hidden = true;
      appEl.hidden = false;
      fabEl.hidden = false;
      if (me && me.required) {
        var name = me.name || me.sub || "";
        currentUserName = name;
        document.getElementById("user-chip").hidden = false;
        document.getElementById("user-name").textContent = name;
        document.getElementById("user-avatar").textContent = (name || "?").slice(0, 1).toUpperCase();
        paintUserChip();
        document.getElementById("logout").hidden = false;
      }
      load();
    }).catch(function (err) {
      if (!err || !err.handled) setSplash("errBoot", "errBootBody", { alert: true, retry: true });
      /* splash keeps the error text */
    });
  }
  var logoutBtn = document.getElementById("logout");
  logoutBtn.addEventListener("click", function () { performLogout(logoutBtn); });
  var splashRetryBtn = document.getElementById("splash-retry");
  if (splashRetryBtn) splashRetryBtn.addEventListener("click", function () { boot(); });
  var splashLogoutBtn = document.getElementById("splash-logout");
  if (splashLogoutBtn) splashLogoutBtn.addEventListener("click", function () { performLogout(splashLogoutBtn); });

  // ---- Listing / tree ----
  var listRequest = 0;
  var listCursors = [];
  function mergeByPath(previous, next) {
    var byPath = Object.create(null);
    previous.concat(next).forEach(function (item) { byPath[item.path] = item; });
    return Object.keys(byPath).map(function (path) { return byPath[path]; });
  }
  function load(more) {
    var append = more === true;
    if (append && (state.loading || state.failed || !state.cursor)) return;
    var cursor = append ? state.cursor : null;
    var previousFiles = append ? state.files.slice() : [];
    var previousPending = append ? state.pending.slice() : [];
    if (!append) listCursors = [];
    var request = ++listRequest;
    function isCurrent() { return request === listRequest; }
    state.loading = true;
    state.loadingMore = append;
    state.failed = false;
    state.failStatus = null;
    render();
    api("/api/drive/list" + (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""), null, isCurrent).then(function (r) {
      if (!isCurrent()) return;
      if (!r.ok) {
        var httpErr = new Error("http " + r.status);
        httpErr.status = r.status;
        throw httpErr;
      }
      return r.json();
    }).then(function (data) {
      if (!isCurrent()) return;
      var next = data && data.cursor;
      if (data && data.truncated && (typeof next !== "string" || !next || next.length > 4096 || listCursors.indexOf(next) !== -1)) throw new Error("invalid_list_cursor");
      if (data && data.truncated) listCursors.push(next);
      var files = (data && data.files) || [];
      var pending = (data && data.pending_deletions) || [];
      var newFiles = Object.create(null), newPending = Object.create(null);
      files.forEach(function (file) { newFiles[file.path] = true; });
      pending.forEach(function (entry) { newPending[entry.path] = true; });
      state.files = mergeByPath(previousFiles, files).filter(function (file) { return !newPending[file.path]; });
      state.pending = mergeByPath(previousPending, pending).filter(function (entry) { return !newFiles[entry.path]; });
      state.truncated = !!(data && data.truncated);
      state.cursor = state.truncated ? next : null;
      state.loading = false;
      state.loadingMore = false;
      state.loadedOnce = true;
      renderUsage();
      render();
    }).catch(function (error) {
      if (!isCurrent()) return;
      state.loading = false;
      state.loadingMore = false;
      state.failed = true;
      state.failStatus = error && error.status ? error.status : null;
      render();
    });
  }
  document.getElementById("load-more").addEventListener("click", function () { load(true); });
  var searchLoadMoreBtn = document.getElementById("search-load-more");
  if (searchLoadMoreBtn) {
    searchLoadMoreBtn.addEventListener("click", function () { load(true); });
  }
  if (refreshBtn) {
    refreshBtn.addEventListener("click", function () {
      if (!folderBusy && !cleanupBusy) load();
    });
  }

  function renderPending() {
    var panel = document.getElementById("pending-deletions");
    var list = document.getElementById("pending-list");
    panel.hidden = state.pending.length === 0;
    list.replaceChildren();
    state.pending.forEach(function (entry) {
      var row = document.createElement("li");
      var path = document.createElement("span");
      path.className = "pending-path";
      path.textContent = entry.path;
      var button = document.createElement("button");
      button.type = "button";
      button.className = "btn";
      button.textContent = t("cleanupReview");
      button.disabled = !entry.cleanup_revision || state.loading || state.failed || folderBusy || cleanupBusy;
      if (!entry.cleanup_revision) button.title = t("cleanupOperator");
      button.addEventListener("click", function () {
        if (button.disabled || state.loading || state.failed || folderBusy || cleanupBusy) return;
        // Keep the selected revision even when a list read completes while
        // this confirmation remains open.
        var target = { path: entry.path, cleanup_revision: entry.cleanup_revision };
        cleanupTarget = target;
        cleanupVerified = null;
        cleanupOpener = button;
        var dialog = document.getElementById("cleanup-dialog");
        var confirm = document.getElementById("cleanup-confirm");
        var body = document.getElementById("cleanup-body");
        confirm.disabled = true;
        body.textContent = t("cleanupChecking");
        dialog.showModal();
        function isCurrentReview() { return cleanupTarget === target && dialog.open; }
        api("/api/drive/cleanup?path=" + encodeURIComponent(target.path) + "&cleanup_revision=" + encodeURIComponent(target.cleanup_revision), null, isCurrentReview).then(function (response) {
          if (!isCurrentReview()) return;
          return response.json().then(function (data) {
            if (!isCurrentReview()) return;
            if (response.ok && data.recoverable === true && data.path === target.path && data.cleanup_revision === target.cleanup_revision) {
              cleanupVerified = target;
              body.textContent = t("cleanupBody", { name: target.path });
              confirm.disabled = false;
            } else {
              body.textContent = t(data.error === "cleanup_requires_operator_review" ? "cleanupOperator" : "cleanupCheckFailed");
            }
          });
        }).catch(function () {
          if (isCurrentReview()) body.textContent = t("cleanupCheckFailed");
        });
      });
      row.append(path, button);
      list.appendChild(row);
    });
    var more = document.getElementById("load-more");
    more.hidden = !state.truncated;
    more.disabled = state.loading || state.failed || folderBusy || cleanupBusy;
    more.textContent = state.loading && state.loadingMore ? t("loading") : t("loadMore");
    var searchNotice = document.getElementById("search-truncated");
    if (searchNotice) searchNotice.hidden = !(state.query && state.truncated && !state.failed);
    if (searchLoadMoreBtn) {
      searchLoadMoreBtn.disabled = state.loading || state.failed || folderBusy || cleanupBusy;
      searchLoadMoreBtn.textContent = state.loading && state.loadingMore ? t("loading") : t("loadMore");
    }
    if (refreshBtn) {
      refreshBtn.disabled = state.loading || folderBusy || cleanupBusy;
      if (state.loading) refreshBtn.classList.add("spinning");
      else refreshBtn.classList.remove("spinning");
    }
    if (mainEl) mainEl.setAttribute("aria-busy", state.loading ? "true" : "false");
    syncSelectionUi();
  }
  document.getElementById("cleanup-confirm").addEventListener("click", function () {
    var target = cleanupTarget;
    if (!target || cleanupVerified !== target || !document.getElementById("cleanup-dialog").open || cleanupBusy || folderBusy) return;
    cleanupTarget = null;
    cleanupVerified = null;
    document.getElementById("cleanup-dialog").close();
    cleanupBusy = true;
    renderPending();
    var progress = document.getElementById("folder-progress");
    progress.textContent = t("cleanupWorking");
    progress.hidden = false;
    progress.classList.add("show");
    api("/api/drive/cleanup", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(target),
    }).then(function (response) {
      return response.json().then(function (data) {
        if (response.ok && data.ok === true && data.path === target.path) toast(t("cleanupDone"));
        else if (data.error === "cleanup_requires_operator_review") folderResult({ remaining: [target.path] }, true, "operator");
        else if (response.status === 404 || response.status === 409 || response.status === 412) toast(t("cleanupChanged"));
        else folderResult({ remaining: [target.path] }, true, "cleanup");
      });
    }).catch(function () {
      folderResult({ remaining: [target.path] }, true, "cleanup");
    }).finally(function () {
      cleanupBusy = false;
      progress.classList.remove("show");
      progress.hidden = true;
      load();
    });
  });
  function renderUsage() {
    var total = 0, count = 0;
    state.files.forEach(function (f) {
      if (f.path.slice(-1) === "/") return; // folder markers aren't files
      total += f.size || 0;
      count += 1;
    });
    var summary = t("usage", { count: count, size: fmtBytes(total) || "0 B" });
    document.getElementById("usage-text").textContent = summary;
    document.getElementById("usage-truncated").hidden = !state.truncated;
    var mobileUsage = document.getElementById("mobile-usage-text");
    if (mobileUsage) mobileUsage.textContent = summary;
    var mobileTruncated = document.getElementById("mobile-usage-truncated");
    if (mobileTruncated) mobileTruncated.hidden = !state.truncated;
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
        items.push({ type: "file", name: name, path: f.path, size: f.size, uploaded: f.uploaded, etag: f.etag, sub: f.path.slice(0, f.path.lastIndexOf("/") + 1) });
      });
    } else if (state.nav === "recent") {
      state.files.forEach(function (f) {
        if (!f.path || f.path.slice(-1) === "/") return;
        var name = f.path.slice(f.path.lastIndexOf("/") + 1);
        items.push({ type: "file", name: name, path: f.path, size: f.size, uploaded: f.uploaded, etag: f.etag, sub: f.path.slice(0, f.path.lastIndexOf("/") + 1) });
      });
      items.sort(function (a, b) { return (Date.parse(b.uploaded) || 0) - (Date.parse(a.uploaded) || 0); });
      items = items.slice(0, 50);
    } else {
      var base = state.path;
      var folders = {};
      state.files.forEach(function (f) {
        if (f.path.indexOf(base) !== 0) return;
        var rest = f.path.slice(base.length);
        if (!rest) return; // marker for this folder itself
        var slash = rest.indexOf("/");
        if (slash < 0) {
          items.push({ type: "file", name: rest, path: f.path, size: f.size, uploaded: f.uploaded, etag: f.etag });
        } else {
          var name = rest.slice(0, slash);
          var folder = folders[name];
          if (!folder) folder = folders[name] = { type: "folder", name: name, path: base + name + "/", size: 0, count: 0, uploaded: "", etag: null };
          if (rest.length > slash + 1) { folder.count += 1; folder.size += f.size || 0; }
          else folder.etag = f.etag;
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
  function updateTitle() {
    var appName = t("appName");
    var screen;
    if (state.query) {
      screen = state.query + " — " + t("headingResults");
    } else if (state.nav === "recent") {
      screen = t("headingRecent");
    } else if (state.path) {
      var trimmed = state.path.slice(0, -1);
      screen = trimmed.slice(trimmed.lastIndexOf("/") + 1) || t("home");
    } else {
      screen = t("home");
    }
    document.title = screen + " — " + appName;
  }
  function renderCrumbs(resultCount) {
    crumbsEl.innerHTML = "";
    if (state.query) {
      var label = !state.loading && !state.failed && typeof resultCount === "number"
        ? t("headingResultsCount", { count: resultCount })
        : t("headingResults");
      crumbsEl.innerHTML = '<h1 class="crumb crumb-heading" aria-current="page">' + esc(label) + "</h1>";
      return;
    }
    if (state.nav === "recent") {
      crumbsEl.innerHTML = '<h1 class="crumb crumb-heading" aria-current="page">' + esc(t("headingRecent")) + "</h1>";
      return;
    }
    var parts = state.path ? state.path.slice(0, -1).split("/") : [];
    var frag = document.createDocumentFragment();
    if (!parts.length) {
      var rootHeading = document.createElement("h1");
      rootHeading.className = "crumb crumb-heading";
      rootHeading.setAttribute("aria-current", "page");
      rootHeading.textContent = t("home");
      frag.appendChild(rootHeading);
      crumbsEl.appendChild(frag);
      return;
    }
    var home = document.createElement("button");
    home.type = "button"; home.className = "crumb"; home.textContent = t("home");
    home.setAttribute("data-folder-path", "");
    home.addEventListener("click", function () {
      clearSelection(false);
      state.path = "";
      syncUrl("push");
      render();
      if (mainEl && typeof mainEl.focus === "function") mainEl.focus();
    });
    frag.appendChild(home);
    var acc = "";
    parts.forEach(function (part, i) {
      acc += part + "/";
      var target = acc;
      var sep = document.createElement("span");
      sep.className = "crumb-sep"; sep.setAttribute("aria-hidden", "true"); sep.textContent = "›";
      frag.appendChild(sep);
      if (i === parts.length - 1) {
        var current = document.createElement("h1");
        current.className = "crumb crumb-heading";
        current.setAttribute("aria-current", "page");
        current.textContent = part;
        frag.appendChild(current);
      } else {
        var btn = document.createElement("button");
        btn.type = "button"; btn.className = "crumb"; btn.textContent = part;
        btn.setAttribute("data-folder-path", target);
        btn.addEventListener("click", function () {
          clearSelection(false);
          state.path = target;
          syncUrl("push");
          render();
          if (mainEl && typeof mainEl.focus === "function") mainEl.focus();
        });
        frag.appendChild(btn);
      }
    });
    crumbsEl.appendChild(frag);
    if (typeof crumbsEl.scrollWidth === "number") crumbsEl.scrollLeft = crumbsEl.scrollWidth;
  }
  function renderSkeleton(isList) {
    stateEl.classList.add("is-skeleton");
    var html = '<span class="sr-only" role="status">' + esc(t("loading")) + "</span>";
    if (isList) {
      html += '<div class="skel-rows" aria-hidden="true">';
      [56, 42, 64, 48, 36, 52].forEach(function (pct) {
        html += '<div class="skel-row"><span class="skel-box" style="width:26px;height:26px;border-radius:7px;flex-shrink:0"></span><span class="skel-box" style="height:14px;width:' + pct + '%"></span></div>';
      });
      html += "</div>";
    } else {
      html += '<div class="skel-cards" aria-hidden="true">';
      for (var i = 0; i < 6; i++) {
        html += '<div class="skel-card"><div class="skel-box" style="height:100px;border-radius:0"></div><div style="padding:10px 12px 0"><div class="skel-box" style="height:13px;width:70%"></div><div class="skel-box" style="height:10px;width:42%;margin-top:8px"></div></div></div>';
      }
      html += "</div>";
    }
    stateEl.innerHTML = html;
    stateEl.hidden = false;
  }
  function renderState(iconPaths, titleKey, bodyKey, actions) {
    stateEl.classList.remove("is-skeleton");
    stateEl.innerHTML = '<div class="state-icon"><svg viewBox="0 0 24 24" width="52" height="52" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + iconPaths + "</svg></div>" +
      (titleKey ? "<h2>" + esc(t(titleKey)) + "</h2>" : "") +
      (bodyKey ? "<p>" + esc(t(bodyKey)) + "</p>" : "");
    var list = Array.isArray(actions) ? actions : (actions ? [actions] : []);
    if (list.length) {
      var wrap = document.createElement("div");
      wrap.className = "state-actions";
      list.forEach(function (action, idx) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = action.primary === false ? "btn" : (idx === 0 ? "btn primary" : "btn");
        btn.textContent = t(action.labelKey);
        btn.addEventListener("click", action.onClick);
        wrap.appendChild(btn);
      });
      stateEl.appendChild(wrap);
    }
    stateEl.hidden = false;
  }
  function render() {
    var items = visibleItems();
    var isList = state.view === "list";
    updateTitle();
    renderCrumbs(items.length);
    renderPending();
    if (searchClearBtn) searchClearBtn.hidden = !searchInput.value;
    document.querySelectorAll("[data-nav]").forEach(function (el) {
      el.setAttribute("aria-pressed", String(!state.query && el.getAttribute("data-nav") === state.nav));
    });
    document.querySelectorAll("[data-view]").forEach(function (el) {
      el.setAttribute("aria-pressed", String(el.getAttribute("data-view") === state.view));
    });
    var SORT_LABEL_KEY = { name: "colName", size: "colSize", uploaded: "colUpdated" };
    document.querySelectorAll("[data-sort]").forEach(function (el) {
      var key = el.getAttribute("data-sort");
      var active = state.sort.key === key;
      var label = t(SORT_LABEL_KEY[key] || key);
      el.setAttribute("aria-pressed", String(active));
      el.setAttribute(
        "aria-label",
        active
          ? t("sortBy", { label: label, dir: t(state.sort.dir === "asc" ? "sortAsc" : "sortDesc") })
          : t("sortAction", { label: label })
      );
    });
    document.querySelectorAll(".sort-arrow").forEach(function (el) {
      var key = el.getAttribute("data-arrow");
      el.textContent = state.sort.key === key ? (state.sort.dir === "asc" ? "\\u25B2" : "\\u25BC") : "";
    });

    var showSkeleton = state.loading && (!state.loadedOnce || !items.length);
    rowsEl.innerHTML = "";
    cardsEl.innerHTML = "";
    stateEl.hidden = true;
    currentVisible = items;
    pruneSelection(items);

    if (showSkeleton || state.failed || (!state.loading && !items.length)) {
      clearThumbs(null);
      syncSelectionUi();
      listHeadEl.hidden = true; rowsEl.hidden = true; cardsEl.hidden = true;
      if (showSkeleton) {
        renderSkeleton(isList);
      } else if (state.failed) {
        if (state.failStatus === 403) {
          renderState(${JSON.stringify(ICON_LOCK)}, "authDenied", "authDeniedBody", {
            labelKey: "retry",
            onClick: function () { load(); },
          });
        } else {
          renderState('<circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><path d="M12 16h.01"/>', "errLoad", "errLoadBody", {
            labelKey: "retry",
            onClick: function () { load(); },
          });
        }
      } else if (state.query) {
        renderState('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>', "emptySearchTitle", "emptySearchBody", {
          labelKey: "clearSearch",
          onClick: function () { clearSearch(true); },
        });
      } else if (state.nav === "recent") {
        renderState(${JSON.stringify(ICON_CLOCK)}, "emptyRecentTitle", "emptyRecentBody", {
          labelKey: "actionUpload",
          onClick: function () { fileInput.click(); },
        });
      } else if (state.path) {
        renderState(${JSON.stringify(ICON_FOLDER)}, "emptyFolderTitle", "emptyFolderBody", [
          { labelKey: "actionUpload", primary: true, onClick: function () { fileInput.click(); } },
          { labelKey: "actionNewFolder", primary: false, onClick: function (e) { openNewFolderDialog(e.currentTarget || e.target); } },
        ]);
      } else {
        renderState(${JSON.stringify(ICON_FOLDER)}, "emptyTitle", "emptyBody", [
          { labelKey: "actionUpload", primary: true, onClick: function () { fileInput.click(); } },
          { labelKey: "actionNewFolder", primary: false, onClick: function (e) { openNewFolderDialog(e.currentTarget || e.target); } },
        ]);
      }
      return;
    }

    listHeadEl.hidden = false;
    if (isList) listHeadEl.classList.remove("as-grid");
    else listHeadEl.classList.add("as-grid");
    rowsEl.hidden = !isList;
    cardsEl.hidden = isList;

    var thumbTargets = [];
    if (isList) {
      clearThumbs(null);
    } else {
      var activeThumbKeys = Object.create(null);
      items.forEach(function (item) {
        if (isThumbEligible(item)) activeThumbKeys[thumbKeyFor(item)] = true;
      });
      clearThumbs(activeThumbKeys);
    }

    items.forEach(function (item, index) {
      var kind = item.type === "folder" ? "folder" : kindOf(item.name);
      var sizeText = item.type === "folder"
        ? (item.count ? t("folderCount", { count: item.count }) : t("folder"))
        : (fmtBytes(item.size) || "");
      var timeText = relTime(item.uploaded);
      var subHtml = "";
      if (item.sub) {
        subHtml = '<span class="name-sub">' + esc(item.sub) + "</span>";
      } else if (sizeText) {
        subHtml = '<span class="name-sub row-mobile-size">' + esc(sizeText) + "</span>";
      }
      var isSelected = Boolean(selectedPaths[item.path]);
      var canDrag = !folderBusy && !cleanupBusy && (item.type === "folder" || Boolean(item.etag));
      var selectLabel = t("selectItem", { name: item.name });
      var checkBtn = '<button type="button" role="checkbox" class="select-check' + (isList ? "" : " card-check") + '" data-select="' + index + '" aria-checked="' + isSelected + '" aria-label="' + esc(selectLabel) + '"><span class="check-box" aria-hidden="true"><span class="check-mark">' + CHECK_SVG + "</span></span></button>";
      var kebabLabel = t("itemMenuFor", { name: item.name });
      var kebab = '<button type="button" class="kebab" data-item="' + index + '" aria-haspopup="menu" aria-expanded="false" aria-label="' + esc(kebabLabel) + '" title="' + esc(kebabLabel) + '">' +
        '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg></button>';
      if (isList) {
        var li = document.createElement("li");
        li.className = isSelected ? "row selected" : "row";
        li.setAttribute("data-item-idx", String(index));
        if (canDrag) { li.draggable = true; li.setAttribute("draggable", "true"); }
        if (item.type === "folder") li.setAttribute("data-folder-path", item.path);
        li.innerHTML =
          '<button type="button" class="row-link" data-open="' + index + '" aria-label="' + esc(item.name) + '"></button>' +
          '<span class="row-name">' + checkBtn + typeIcon(kind, 14) + '<span style="min-width:0">' +
          '<span class="name-text" style="display:block">' + esc(item.name) + "</span>" + subHtml + "</span></span>" +
          '<span class="row-size">' + esc(sizeText) + "</span>" +
          '<span class="row-time">' + esc(timeText) + "</span>" +
          kebab;
        rowsEl.appendChild(li);
      } else {
        var card = document.createElement("div");
        card.className = isSelected ? "card selected" : "card";
        card.setAttribute("data-item-idx", String(index));
        if (canDrag) { card.draggable = true; card.setAttribute("draggable", "true"); }
        if (item.type === "folder") card.setAttribute("data-folder-path", item.path);
        card.style.setProperty("--card-accent", KIND_ACCENT[kind] || KIND_ACCENT.file);
        var cardSub = item.sub ? '<div class="card-sub" title="' + esc(item.sub) + '">' + esc(item.sub) + "</div>" : "";
        var cardMetaText = item.type === "folder"
          ? sizeText
          : [sizeText, timeText].filter(Boolean).join(" · ");
        card.innerHTML =
          '<button type="button" class="row-link" data-open="' + index + '" aria-label="' + esc(item.name) + '"></button>' +
          checkBtn +
          '<div class="card-thumb"><svg viewBox="0 0 24 24" width="42" height="42" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (KIND_ICON[kind] || KIND_ICON.file) + "</svg></div>" +
          '<div class="card-foot">' + typeIcon(kind, 13) +
          '<div class="card-meta"><div class="card-name">' + esc(item.name) + "</div>" + cardSub + '<div class="card-time">' + esc(cardMetaText) + "</div></div>" +
          kebab + "</div>";
        cardsEl.appendChild(card);
        if (isThumbEligible(item) && typeof card.querySelector === "function") {
          var thumbEl = card.querySelector(".card-thumb");
          if (thumbEl) thumbTargets.push({ el: thumbEl, path: item.path, cacheKey: thumbKeyFor(item) });
        }
      }
    });
    syncSelectionUi();
    if (!isList && thumbTargets.length) observeGridThumbs(thumbTargets);
  }

  // ---- Open (navigate / preview) ----
  function openItem(item, trigger) {
    if (item.type === "folder") {
      clearSelection(false);
      state.nav = "files";
      state.query = "";
      searchInput.value = "";
      state.path = item.path;
      syncUrl("push");
      render();
      if (mainEl && typeof mainEl.focus === "function") mainEl.focus();
      return;
    }
    openPreview(item, trigger);
  }
  document.addEventListener("click", function (e) {
    var check = e.target.closest ? e.target.closest(".select-check[data-select]") : null;
    if (check) {
      e.preventDefault();
      e.stopPropagation();
      closeMenus(false);
      var idx = Number(check.getAttribute("data-select"));
      var item = currentVisible[idx];
      if (!item) return;
      var nextState = !selectedPaths[item.path];
      if (e.shiftKey && lastSelectedIndex >= 0 && lastSelectedIndex < currentVisible.length) {
        var lo = Math.min(lastSelectedIndex, idx);
        var hi = Math.max(lastSelectedIndex, idx);
        for (var i = lo; i <= hi; i++) {
          if (nextState) selectedPaths[currentVisible[i].path] = true;
          else delete selectedPaths[currentVisible[i].path];
        }
      } else {
        if (nextState) selectedPaths[item.path] = true;
        else delete selectedPaths[item.path];
      }
      lastSelectedIndex = idx;
      syncSelectionUi();
      return;
    }
    var opener = e.target.closest ? e.target.closest("[data-open]") : null;
    if (!opener) return;
    var item = currentVisible[Number(opener.getAttribute("data-open"))];
    if (item) openItem(item, opener);
  });
  if (selectAllBtn) {
    selectAllBtn.addEventListener("click", function () {
      if (selectAllBtn.disabled || !currentVisible.length) return;
      if (selectedCount() === currentVisible.length) {
        clearSelection(true);
      } else {
        currentVisible.forEach(function (item) { selectedPaths[item.path] = true; });
        lastSelectedIndex = currentVisible.length - 1;
        syncSelectionUi();
      }
    });
  }
  if (bulkClearBtn) {
    bulkClearBtn.addEventListener("click", function () { clearSelection(true); });
  }
  if (bulkMoveBtn) {
    bulkMoveBtn.addEventListener("click", function () {
      var plan = buildBulkPlan(selectedVisibleItems());
      if (!plan) return;
      openBulkMoveDialog(plan, null, bulkMoveBtn);
    });
  }
  if (bulkDeleteBtn) {
    bulkDeleteBtn.addEventListener("click", function () {
      var plan = buildBulkPlan(selectedVisibleItems());
      if (!plan) return;
      actionTarget = null;
      actionEntries = null;
      bulkActionPlan = plan;
      deleteOpener = bulkDeleteBtn;
      var totalEntries = 0;
      plan.forEach(function (step) { totalEntries += step.entries ? step.entries.length : 1; });
      deleteBody.textContent = t("bulkDeleteBody", { count: plan.length, entries: totalEntries });
      deleteDialog.showModal();
    });
  }

  // ---- Preview ----
  var previewEl = document.getElementById("preview");
  var previewBody = document.getElementById("preview-body");
  var previewName = document.getElementById("preview-name");
  var previewMeta = document.getElementById("preview-meta");
  var previewNav = document.getElementById("preview-nav");
  var previewPos = document.getElementById("preview-pos");
  var previewPrevBtn = document.getElementById("preview-prev");
  var previewNextBtn = document.getElementById("preview-next");
  var previewCloseBtn = document.getElementById("preview-close");
  var previewTarget = null;
  var previewUrl = null;
  var previewOpener = null;
  var previewRequest = 0;
  var PREVIEW_TEXT_MAX = 1024 * 1024;
  function previewFiles() {
    return currentVisible.filter(function (entry) { return entry.type === "file"; });
  }
  function updatePreviewChrome(item) {
    if (previewMeta) {
      previewMeta.textContent = [fmtBytes(item.size), relTime(item.uploaded)].filter(Boolean).join(" · ");
    }
    var files = previewFiles();
    var idx = -1;
    for (var i = 0; i < files.length; i++) {
      if (files[i].path === item.path) { idx = i; break; }
    }
    var multi = files.length > 1 && idx >= 0;
    if (previewNav) previewNav.hidden = !multi;
    if (previewPos) previewPos.textContent = multi ? (idx + 1) + " / " + files.length : "";
    if (previewPrevBtn) previewPrevBtn.disabled = !multi || idx <= 0;
    if (previewNextBtn) previewNextBtn.disabled = !multi || idx >= files.length - 1;
  }
  function stepPreview(delta, keepButtonFocus) {
    if (!previewTarget || !previewEl.classList.contains("open")) return;
    var files = previewFiles();
    var idx = -1;
    for (var i = 0; i < files.length; i++) {
      if (files[i].path === previewTarget.path) { idx = i; break; }
    }
    var nextIdx = idx + delta;
    if (idx < 0 || nextIdx < 0 || nextIdx >= files.length) return;
    var keepFocusEl = keepButtonFocus ? document.activeElement : null;
    openPreview(files[nextIdx], previewOpener, true);
    if (keepFocusEl && !keepFocusEl.disabled && typeof keepFocusEl.focus === "function") {
      keepFocusEl.focus();
    } else if (previewCloseBtn && typeof previewCloseBtn.focus === "function") {
      previewCloseBtn.focus();
    }
  }
  function closePreview(restoreFocus) {
    var wasOpen = previewEl.classList.contains("open");
    previewRequest++;
    previewEl.classList.remove("open");
    previewBody.innerHTML = "";
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
    previewTarget = null;
    if (wasOpen) {
      appEl.inert = false;
      fabEl.inert = false;
      if (tray) tray.inert = false;
      var opener = previewOpener;
      previewOpener = null;
      if (restoreFocus !== false) {
        if (opener && typeof opener.focus === "function" && (typeof opener.isConnected !== "boolean" || opener.isConnected)) {
          opener.focus();
        } else if (mainEl && typeof mainEl.focus === "function") {
          mainEl.focus();
        }
      }
    }
  }
  function openPreview(item, trigger, preserveFocus) {
    var opener = trigger || (previewEl.classList.contains("open") ? previewOpener : document.activeElement);
    closePreview(false);
    previewOpener = opener;
    var request = previewRequest;
    function isCurrent() { return request === previewRequest; }
    function showReadFailure() {
      if (!isCurrent()) return;
      fallbackPreview("previewReadFailed", function () {
        if (isCurrent()) openPreview(item);
      });
    }
    previewTarget = item;
    previewName.textContent = item.name;
    updatePreviewChrome(item);
    previewBody.innerHTML = '<div class="preview-fallback" role="status"><span class="spin" aria-hidden="true"></span><span>' + esc(t("loading")) + "</span></div>";
    previewEl.classList.add("open");
    appEl.inert = true;
    fabEl.inert = true;
    if (tray) tray.inert = true;
    if (!preserveFocus) {
      if (previewCloseBtn && typeof previewCloseBtn.focus === "function") previewCloseBtn.focus();
      else if (typeof previewEl.focus === "function") previewEl.focus();
    }
    var kind = kindOf(item.name);
    if (PREVIEW_IMAGE_EXT[extOf(item.name)]) {
      api(fileUrl(item.path), null, isCurrent).then(function (r) {
        if (!isCurrent()) return;
        if (!r.ok) throw new Error("http " + r.status);
        return r.blob();
      }).then(function (blob) {
        if (!isCurrent()) return;
        previewUrl = URL.createObjectURL(blob);
        previewBody.innerHTML = "";
        var img = document.createElement("img");
        img.src = previewUrl;
        img.alt = item.name;
        img.addEventListener("error", function () { showReadFailure(); });
        previewBody.appendChild(img);
      }).catch(showReadFailure);
      return;
    }
    if (kind === "text" && (item.size || 0) <= PREVIEW_TEXT_MAX) {
      api(fileUrl(item.path), null, isCurrent).then(function (r) {
        if (!isCurrent()) return;
        if (!r.ok) throw new Error("http " + r.status);
        return r.text();
      }).then(function (text) {
        if (!isCurrent()) return;
        previewBody.innerHTML = "";
        var pre = document.createElement("pre");
        pre.tabIndex = 0;
        pre.setAttribute("role", "region");
        pre.setAttribute("aria-label", t("previewTextLabel", { name: item.name }));
        pre.textContent = text;
        previewBody.appendChild(pre);
      }).catch(showReadFailure);
      return;
    }
    fallbackPreview(kind === "text" ? "previewTooBig" : "previewNone");
  }
  function fallbackPreview(msgKey, retry) {
    previewBody.innerHTML = "";
    var box = document.createElement("div");
    box.className = "preview-fallback";
    var msg = document.createElement("span");
    msg.textContent = t(msgKey);
    box.appendChild(msg);
    if (retry) {
      msg.setAttribute("role", "alert");
      var retryButton = document.createElement("button");
      retryButton.type = "button";
      retryButton.className = "btn primary";
      retryButton.textContent = t("previewRetry");
      retryButton.addEventListener("click", retry);
      box.appendChild(retryButton);
    }
    var btn = document.createElement("button");
    btn.type = "button"; btn.className = retry ? "btn" : "btn primary"; btn.textContent = t("download");
    btn.addEventListener("click", function () { if (previewTarget) download(previewTarget); });
    box.appendChild(btn);
    previewBody.appendChild(box);
  }
  document.getElementById("preview-close").addEventListener("click", closePreview);
  document.getElementById("preview-download").addEventListener("click", function () {
    if (previewTarget) download(previewTarget);
  });
  if (previewPrevBtn) previewPrevBtn.addEventListener("click", function () { stepPreview(-1, true); });
  if (previewNextBtn) previewNextBtn.addEventListener("click", function () { stepPreview(1, true); });
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
  var menuAnchor = null;

  function closeMenus(restoreFocus) {
    var prevAnchor = menuAnchor;
    var wasOpen = newMenu.classList.contains("open") || itemMenu.classList.contains("open");
    newMenu.classList.remove("open");
    itemMenu.classList.remove("open");
    newBtn.setAttribute("aria-expanded", "false");
    fabEl.setAttribute("aria-expanded", "false");
    if (prevAnchor && typeof prevAnchor.setAttribute === "function") prevAnchor.setAttribute("aria-expanded", "false");
    menuAnchor = null;
    if (restoreFocus && wasOpen && prevAnchor && typeof prevAnchor.focus === "function" && (typeof prevAnchor.isConnected !== "boolean" || prevAnchor.isConnected)) {
      prevAnchor.focus();
    }
  }
  function openMenuAt(menu, anchor) {
    closeMenus(false);
    menuAnchor = anchor;
    if (anchor && typeof anchor.setAttribute === "function") anchor.setAttribute("aria-expanded", "true");
    menu.classList.add("open");
    var r = anchor.getBoundingClientRect();
    var mw = menu.offsetWidth, mh = menu.offsetHeight;
    var x = Math.min(r.left, window.innerWidth - mw - 8);
    var y = r.bottom + 6;
    if (y + mh > window.innerHeight - 8) y = Math.max(8, r.top - mh - 6);
    menu.style.left = Math.max(8, x) + "px";
    menu.style.top = y + "px";
    var first = menu.querySelector(".menu-item:not([hidden]):not([disabled])") || menu.querySelector(".menu-item:not([hidden])");
    if (first && typeof first.focus === "function") first.focus();
  }
  [newMenu, itemMenu].forEach(function (menu) {
    menu.addEventListener("keydown", function (e) {
      if (!menu.classList.contains("open")) return;
      if (e.key === "Tab") { closeMenus(false); return; }
      if (typeof menu.querySelectorAll !== "function") return;
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
      var items = Array.prototype.filter.call(menu.querySelectorAll('[role="menuitem"]'), function (el) {
        return !el.hidden && !el.disabled;
      });
      if (!items.length) return;
      e.preventDefault();
      var idx = items.indexOf(document.activeElement);
      if (e.key === "Home") idx = 0;
      else if (e.key === "End") idx = items.length - 1;
      else if (e.key === "ArrowDown") idx = idx < 0 ? 0 : (idx + 1) % items.length;
      else idx = idx <= 0 ? items.length - 1 : idx - 1;
      items[idx].focus();
    });
  });
  newBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    if (newMenu.classList.contains("open")) { closeMenus(true); return; }
    openMenuAt(newMenu, newBtn);
  });
  fabEl.addEventListener("click", function (e) {
    e.stopPropagation();
    if (newMenu.classList.contains("open")) { closeMenus(true); return; }
    openMenuAt(newMenu, fabEl);
  });
  document.addEventListener("click", function (e) {
    if (!newMenu.contains(e.target) && !itemMenu.contains(e.target)) closeMenus(false);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !e.isComposing && e.keyCode !== 229) {
      if (newMenu.classList.contains("open") || itemMenu.classList.contains("open")) {
        e.preventDefault();
        closeMenus(true);
      } else if (previewEl.classList.contains("open")) {
        e.preventDefault();
        closePreview(true);
      } else if (!hasOpenOverlay() && !isTextInput(document.activeElement) && selectedCount() > 0) {
        e.preventDefault();
        clearSelection(true);
      }
      return;
    }
    if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && previewEl.classList.contains("open") && !e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing && e.keyCode !== 229) {
      var activeTag = document.activeElement && document.activeElement.tagName;
      if (activeTag !== "PRE") {
        e.preventDefault();
        stepPreview(e.key === "ArrowLeft" ? -1 : 1, false);
        return;
      }
    }
    if (e.key === "Tab") {
      if (newMenu.classList.contains("open") || itemMenu.classList.contains("open")) {
        closeMenus(false);
        return;
      }
      if (previewEl.classList.contains("open") && typeof previewEl.querySelectorAll === "function") {
        var focusable = Array.prototype.filter.call(
          previewEl.querySelectorAll("button:not([disabled]):not([hidden]), a[href], [tabindex]:not([tabindex='-1'])"),
          function (el) { return !el.hidden && !el.disabled && (!el.closest || !el.closest("[hidden]")); }
        );
        if (!focusable.length) { e.preventDefault(); previewEl.focus(); return; }
        var first = focusable[0], last = focusable[focusable.length - 1];
        var inside = typeof previewEl.contains === "function" && previewEl.contains(document.activeElement);
        if (e.shiftKey) {
          if (!inside || document.activeElement === first || document.activeElement === previewEl) { e.preventDefault(); last.focus(); }
        } else if (!inside || document.activeElement === last) {
          e.preventDefault(); first.focus();
        }
      }
    }
  });
  window.addEventListener("resize", function () { closeMenus(false); });
  document.getElementById("main").addEventListener("scroll", function () { closeMenus(false); });

  document.addEventListener("click", function (e) {
    var kebab = e.target.closest ? e.target.closest(".kebab") : null;
    if (!kebab) return;
    e.preventDefault();
    e.stopPropagation();
    if (itemMenu.classList.contains("open") && menuAnchor === kebab) {
      closeMenus(true);
      return;
    }
    var item = currentVisible[Number(kebab.getAttribute("data-item"))];
    if (!item || folderBusy) return;
    menuTarget = item;
    itemMenu.querySelector('[data-action="download"]').hidden = item.type === "folder";
    ["rename", "move", "delete"].forEach(function (action) {
      var button = itemMenu.querySelector('[data-action="' + action + '"]');
      if (!button) return;
      button.disabled = item.type === "folder" ? !folderSnapshot(item) : !item.etag;
      button.title = button.disabled ? t(item.type === "folder" ? "folderUnavailable" : "errRevision", { count: ${MAX_FOLDER_OBJECTS}, size: fmtBytes(${MAX_FOLDER_TOTAL_BYTES}) }) : "";
    });
    if (item.type === "file" && !item.etag) toast(t("errRevision"));
    openMenuAt(itemMenu, kebab);
  }, true);

  // ---- Navigation ----
  if (brandLink) {
    brandLink.addEventListener("click", function (e) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;
      e.preventDefault();
      clearSelection(false);
      state.nav = "files";
      state.path = "";
      state.query = "";
      searchInput.value = "";
      syncUrl("push");
      render();
      if (mainEl && typeof mainEl.focus === "function") mainEl.focus();
    });
  }
  document.querySelectorAll("[data-nav]").forEach(function (el) {
    el.addEventListener("click", function () {
      clearSelection(false);
      state.nav = el.getAttribute("data-nav");
      state.path = "";
      state.query = "";
      searchInput.value = "";
      if (state.nav === "recent") state.sort = { key: "uploaded", dir: "desc" };
      syncUrl("push");
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
      lastSelectedIndex = -1;
      render();
    });
  });

  // ---- Search ----
  var searchTimer;
  function clearSearch(refocus) {
    clearTimeout(searchTimer);
    var hadQuery = Boolean(state.query);
    searchInput.value = "";
    state.query = "";
    if (searchClearBtn) searchClearBtn.hidden = true;
    clearSelection(false);
    if (hadQuery) syncUrl("push");
    render();
    if (refocus && typeof searchInput.focus === "function") searchInput.focus();
  }
  searchInput.addEventListener("input", function () {
    if (searchClearBtn) searchClearBtn.hidden = !searchInput.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      var prevQuery = state.query;
      var nextQuery = searchInput.value.trim();
      if (nextQuery !== prevQuery) {
        clearSelection(false);
        state.query = nextQuery;
        syncUrl(Boolean(prevQuery) === Boolean(nextQuery) ? "replace" : "push");
      }
      render();
    }, 150);
  });
  searchInput.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !e.isComposing && e.keyCode !== 229 && (searchInput.value || state.query)) {
      e.preventDefault();
      clearSearch(true);
    }
  });
  if (searchClearBtn) {
    searchClearBtn.addEventListener("click", function () { clearSearch(true); });
  }
  function isTextInput(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    var tag = el.tagName || "";
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  }
  function hasOpenOverlay() {
    if (previewEl.classList.contains("open") || newMenu.classList.contains("open") || itemMenu.classList.contains("open")) return true;
    if (typeof document.querySelector === "function" && document.querySelector("dialog[open]")) return true;
    return Boolean(
      (nameDialog && nameDialog.open) ||
      (moveDialog && moveDialog.open) ||
      (deleteDialog && deleteDialog.open) ||
      (cleanupDialog && cleanupDialog.open) ||
      (folderResultDialog && folderResultDialog.open) ||
      (shortcutsDialog && shortcutsDialog.open)
    );
  }
  function openShortcutsDialog(trigger) {
    if (!shortcutsDialog) return;
    shortcutsOpener = trigger || document.activeElement;
    shortcutsDialog.showModal();
  }
  if (shortcutsBtn) {
    shortcutsBtn.addEventListener("click", function () {
      openShortcutsDialog(shortcutsBtn);
    });
  }
  if (shortcutsDialog) {
    shortcutsDialog.addEventListener("close", function () {
      if (shortcutsDialog.open) return;
      var opener = shortcutsOpener;
      shortcutsOpener = null;
      restoreDialogFocus(opener);
    });
  }
  document.addEventListener("keydown", function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing || e.keyCode === 229) return;
    if (appEl && appEl.hidden) return;
    if (e.key === "?" && !isTextInput(document.activeElement)) {
      if (shortcutsDialog && shortcutsDialog.open) {
        e.preventDefault();
        shortcutsDialog.close();
        return;
      }
      if (!hasOpenOverlay()) {
        e.preventDefault();
        openShortcutsDialog(document.activeElement);
        return;
      }
    }
    if (hasOpenOverlay() || isTextInput(document.activeElement)) return;
    if (e.key === "/" && document.activeElement !== searchInput) {
      e.preventDefault();
      searchInput.focus();
      return;
    }
    if (!e.shiftKey && !folderBusy && !cleanupBusy) {
      if (e.key === "n") {
        e.preventDefault();
        openNewFolderDialog(document.activeElement);
        return;
      }
      if (e.key === "u") {
        e.preventDefault();
        fileInput.click();
        return;
      }
    }
    if (e.key === "Backspace" && !e.shiftKey && state.nav === "files" && !state.query && state.path) {
      e.preventDefault();
      var trimmed = state.path.slice(0, -1);
      var slash = trimmed.lastIndexOf("/");
      clearSelection(false);
      state.path = slash >= 0 ? trimmed.slice(0, slash + 1) : "";
      syncUrl("push");
      render();
      if (mainEl && typeof mainEl.focus === "function") mainEl.focus();
      return;
    }
    var isGridArrow = state.view === "grid" && (e.key === "ArrowLeft" || e.key === "ArrowRight");
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End" || isGridArrow) {
      var container = state.view === "list" ? rowsEl : cardsEl;
      if (!container || container.hidden || typeof container.querySelectorAll !== "function") return;
      var links = Array.prototype.slice.call(container.querySelectorAll(".row-link"));
      if (!links.length) return;
      var active = document.activeElement;
      var idx = links.indexOf(active);
      var onItem = idx >= 0;
      if (!onItem && active && active.classList && (active.classList.contains("kebab") || active.classList.contains("select-check"))) {
        var attr = active.classList.contains("kebab") ? "data-item" : "data-select";
        var rawIdx = active.getAttribute(attr);
        var itemIdx = rawIdx !== null && rawIdx !== "" ? Number(rawIdx) : NaN;
        if (!isNaN(itemIdx) && itemIdx >= 0 && itemIdx < links.length) {
          idx = itemIdx;
          onItem = true;
        }
      }
      var canEnter = !active || active === mainEl || active === document.body || (active === selectAllBtn && e.key === "ArrowDown");
      if ((e.key === "Home" || e.key === "End") && !onItem) return;
      if (!onItem && !canEnter) return;
      e.preventDefault();
      var forward = e.key === "ArrowDown" || e.key === "ArrowRight";
      var nextIdx;
      if (e.key === "Home") nextIdx = 0;
      else if (e.key === "End") nextIdx = links.length - 1;
      else if (onItem) nextIdx = forward ? Math.min(idx + 1, links.length - 1) : Math.max(idx - 1, 0);
      else nextIdx = forward ? 0 : links.length - 1;
      var targetLink = links[nextIdx];
      if (targetLink && typeof targetLink.focus === "function") {
        targetLink.focus();
        if (typeof targetLink.scrollIntoView === "function") targetLink.scrollIntoView({ block: "nearest" });
      }
    }
  });

  // ---- Upload ----
  var fileInput = document.getElementById("file-input");
  var trayList = document.getElementById("tray-list");
  var trayProgress = document.getElementById("tray-progress");
  var uploadEntries = [];
  function renderTrayHeader() {
    if (!trayProgress) return;
    var total = uploadEntries.length;
    if (!total) { trayProgress.textContent = ""; return; }
    var done = 0, failed = 0;
    uploadEntries.forEach(function (entry) {
      if (entry.status === "done") done += 1;
      else if (entry.status === "failed") failed += 1;
    });
    trayProgress.textContent = failed > 0
      ? t("upProgressFailed", { done: done, total: total, failed: failed })
      : t("upProgress", { done: done, total: total });
  }
  function paintUploadEntry(entry) {
    if (entry.dismissed) return;
    if (entry.status === "uploading") {
      entry.statusEl.textContent = t("upUploading");
      entry.statusEl.className = "tray-status";
      entry.li.replaceChildren(entry.spinEl, entry.nameEl, entry.statusEl);
    } else if (entry.status === "done") {
      entry.statusEl.textContent = t("upDone");
      entry.statusEl.className = "tray-status ok";
      entry.li.replaceChildren(entry.nameEl, entry.statusEl);
    } else {
      entry.statusEl.textContent = entry.errorStatus === 412
        ? t("upConflict")
        : entry.errorStatus === 413
          ? t("upTooLarge")
          : t("upFailed");
      entry.statusEl.className = "tray-status fail";
      entry.retryBtn.textContent = t("upRetry");
      entry.retryBtn.setAttribute("aria-label", t("upRetryFor", { name: entry.name }));
      entry.li.replaceChildren(entry.nameEl, entry.statusEl, entry.retryBtn);
    }
  }
  function repaintUploadEntries() {
    uploadEntries.forEach(paintUploadEntry);
  }
  function startUploadEntry(entry, onSettled) {
    var file = entry.file;
    if (!file || entry.dismissed) return;
    entry.status = "uploading";
    entry.errorStatus = null;
    paintUploadEntry(entry);
    renderTrayHeader();
    api(fileUrl(entry.path), {
      method: "PUT",
      headers: {
        "content-type": file.type || "application/octet-stream",
        "if-none-match": "*",
      },
      body: file,
    }).then(function (r) {
      checkMutationResponse(r);
      entry.file = null;
      if (!entry.dismissed) {
        entry.status = "done";
        paintUploadEntry(entry);
        renderTrayHeader();
      }
      if (onSettled) onSettled(true);
    }).catch(function (error) {
      if (entry.dismissed) {
        entry.file = null;
      } else {
        entry.status = "failed";
        entry.errorStatus = error && error.status ? error.status : null;
        paintUploadEntry(entry);
        renderTrayHeader();
        toast(
          entry.errorStatus === 412
            ? t("errConflict")
            : entry.errorStatus === 413
              ? t("errTooLarge", { name: entry.name })
              : t("errUpload", { name: entry.name })
        );
      }
      if (onSettled) onSettled(false, error && error.status);
    });
  }
  document.getElementById("tray-close").addEventListener("click", function () {
    tray.classList.remove("open");
    uploadEntries.forEach(function (entry) {
      entry.dismissed = true;
      entry.file = null;
    });
    uploadEntries = [];
    trayList.innerHTML = "";
    renderTrayHeader();
  });
  function uploadFiles(files) {
    if (!files || !files.length) return;
    tray.classList.add("open");
    var pending = files.length;
    var basePath = state.path;
    Array.prototype.forEach.call(files, function (file) {
      var li = document.createElement("li");
      var spinEl = document.createElement("span");
      spinEl.className = "spin";
      spinEl.setAttribute("aria-hidden", "true");
      var nameEl = document.createElement("span");
      nameEl.className = "tray-name";
      nameEl.textContent = file.name;
      var statusEl = document.createElement("span");
      statusEl.className = "tray-status";
      var retryBtn = document.createElement("button");
      retryBtn.type = "button";
      retryBtn.className = "tray-retry";
      var entry = {
        file: file,
        name: file.name,
        path: basePath + file.name,
        status: "uploading",
        dismissed: false,
        li: li,
        spinEl: spinEl,
        nameEl: nameEl,
        statusEl: statusEl,
        retryBtn: retryBtn,
      };
      retryBtn.addEventListener("click", function () {
        if (entry.dismissed || entry.status !== "failed" || !entry.file) return;
        startUploadEntry(entry, function (ok, status) { if (ok || status === 412) load(); });
      });
      uploadEntries.push(entry);
      trayList.appendChild(li);
      startUploadEntry(entry, function () {
        pending -= 1;
        if (pending === 0) load();
      });
    });
  }
  fileInput.addEventListener("change", function () {
    uploadFiles(fileInput.files);
    fileInput.value = "";
  });

  // Drag & drop: external OS file uploads vs internal item CAS moves.
  var dropOverlay = document.getElementById("drop-overlay");
  var dragDepth = 0;
  function clearDropHighlight() {
    if (activeDropTarget && activeDropTarget.classList) {
      activeDropTarget.classList.remove("drop-target");
    }
    activeDropTarget = null;
  }
  function setDropHighlight(el) {
    if (activeDropTarget === el) return;
    clearDropHighlight();
    activeDropTarget = el;
    if (activeDropTarget && activeDropTarget.classList) {
      activeDropTarget.classList.add("drop-target");
    }
  }
  function clearDragState() {
    dragItems = null;
    dragDepth = 0;
    if (dropOverlay && dropOverlay.classList) dropOverlay.classList.remove("active");
    clearDropHighlight();
    if (mainEl && typeof mainEl.querySelectorAll === "function") {
      mainEl.querySelectorAll(".is-dragging").forEach(function (el) {
        if (el.classList) el.classList.remove("is-dragging");
      });
    }
  }
  function isExternalFileDrag(e) {
    if (dragItems) return false;
    var types = e && e.dataTransfer && e.dataTransfer.types;
    if (!types) return false;
    return Array.prototype.indexOf.call(types, "Files") >= 0;
  }
  function canDropOnFolder(items, destFolder) {
    if (!items || !items.length || folderBusy || cleanupBusy || state.loading || state.failed) return false;
    if (typeof destFolder !== "string" || (destFolder !== "" && destFolder.slice(-1) !== "/")) return false;
    var movable = false;
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (item.type === "folder") {
        var destPath = destFolder + item.name + "/";
        if (destFolder === item.path || destFolder.indexOf(item.path) === 0 || destPath.indexOf(item.path) === 0 || item.path.indexOf(destPath) === 0) {
          return false;
        }
      }
      if (parentFolderOf(item) !== destFolder) movable = true;
    }
    return movable;
  }
  mainEl.addEventListener("dragstart", function (e) {
    if (folderBusy || cleanupBusy || state.loading || state.failed) { e.preventDefault(); return; }
    var host = e.target && e.target.closest ? e.target.closest("[data-item-idx]") : null;
    if (!host) return;
    var item = currentVisible[Number(host.getAttribute("data-item-idx"))];
    if (!item || (item.type === "file" && !item.etag)) { e.preventDefault(); return; }
    var selected = selectedPaths[item.path] ? selectedVisibleItems() : [];
    dragItems = selected.length > 1 ? selected : [item];
    if (host.classList) host.classList.add("is-dragging");
    if (e.dataTransfer) {
      try {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", item.path);
      } catch (err) { /* ignore synthetic drag events */ }
    }
  });
  mainEl.addEventListener("dragenter", function (e) {
    if (dragItems) {
      var target = e.target && e.target.closest ? e.target.closest("[data-folder-path]") : null;
      if (target && canDropOnFolder(dragItems, target.getAttribute("data-folder-path"))) {
        e.preventDefault();
        setDropHighlight(target);
      }
      return;
    }
    if (state.nav !== "files" || state.query || !isExternalFileDrag(e)) return;
    e.preventDefault();
    dragDepth += 1;
    dropOverlay.classList.add("active");
  });
  mainEl.addEventListener("dragover", function (e) {
    if (dragItems) {
      var target = e.target && e.target.closest ? e.target.closest("[data-folder-path]") : null;
      if (target && canDropOnFolder(dragItems, target.getAttribute("data-folder-path"))) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        setDropHighlight(target);
      } else {
        clearDropHighlight();
      }
      return;
    }
    if (state.nav === "files" && !state.query && isExternalFileDrag(e)) e.preventDefault();
  });
  mainEl.addEventListener("dragleave", function (e) {
    if (dragItems) {
      if (activeDropTarget && (!e.relatedTarget || (typeof activeDropTarget.contains === "function" && !activeDropTarget.contains(e.relatedTarget)))) {
        clearDropHighlight();
      }
      return;
    }
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) dropOverlay.classList.remove("active");
  });
  mainEl.addEventListener("drop", function (e) {
    if (dragItems) {
      e.preventDefault();
      e.stopPropagation();
      var items = dragItems.slice();
      var target = e.target && e.target.closest ? e.target.closest("[data-folder-path]") : activeDropTarget;
      var destFolder = target ? target.getAttribute("data-folder-path") : null;
      clearDragState();
      if (destFolder == null || !canDropOnFolder(items, destFolder)) return;
      if (items.length === 1 && items[0].type === "file") {
        var file = items[0];
        if (!file.etag) { toast(t("errRevision")); load(); return; }
        api("/api/drive/move", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            source_path: file.path,
            destination_path: destFolder + file.name,
            source_etag: file.etag,
          }),
        }).then(checkMutationResponse).then(function () {
          clearSelection(false);
          toast(t("itemMoved"));
          load();
        }).catch(mutationFailed);
        return;
      }
      var dropFocusTarget = target && typeof target.querySelector === "function"
        ? (target.querySelector(".row-link") || (target.tagName === "BUTTON" ? target : mainEl))
        : (target && target.tagName === "BUTTON" ? target : mainEl);
      if (items.length === 1 && items[0].type === "folder") {
        var folder = items[0];
        var entries = folderSnapshot(folder);
        if (!entries) { folderUnavailable(); return; }
        bulkActionPlan = null;
        actionEntries = entries;
        actionTarget = folder;
        openMoveDialog(folder, dropFocusTarget, destFolder);
        return;
      }
      var plan = buildBulkPlan(items);
      if (!plan) return;
      openBulkMoveDialog(plan, destFolder, dropFocusTarget);
      return;
    }
    e.preventDefault();
    dragDepth = 0;
    dropOverlay.classList.remove("active");
    if (state.nav !== "files" || state.query) return;
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
  });
  document.addEventListener("dragend", clearDragState);

  // ---- New menu / dialogs ----
  var nameDialog = document.getElementById("name-dialog");
  var nameForm = document.getElementById("name-form");
  var nameInput = document.getElementById("name-input");
  var nameInputLabel = document.getElementById("name-input-label");
  var nameError = document.getElementById("name-error");
  var nameDialogTitle = document.getElementById("name-dialog-title");
  var nameDialogNote = document.getElementById("name-dialog-note");
  var nameMode = null; // "folder" | "rename"
  var actionTarget = null;
  var nameOpener = null;
  var moveOpener = null;
  var deleteOpener = null;

  function isUsableFocusTarget(el) {
    if (!el || el === document.body || typeof el.focus !== "function") return false;
    if (typeof el.isConnected === "boolean" && !el.isConnected) return false;
    if (el.disabled || el.hidden) return false;
    if (typeof el.closest === "function" && el.closest("[hidden]")) return false;
    return true;
  }
  function restoreDialogFocus(opener) {
    if (isUsableFocusTarget(opener)) {
      opener.focus();
      if (document.activeElement === opener) return;
    }
    if (mainEl && typeof mainEl.focus === "function") {
      mainEl.focus();
    }
  }
  if (nameDialog) {
    nameDialog.addEventListener("close", function () {
      if (nameDialog.open) return;
      var opener = nameOpener;
      nameOpener = null;
      restoreDialogFocus(opener);
    });
  }

  function guardDialogIme(dialog, input) {
    var composing = false;
    if (input) {
      input.addEventListener("compositionstart", function () { composing = true; });
      input.addEventListener("compositionend", function () { composing = false; });
      input.addEventListener("keydown", function (e) {
        if ((e.key === "Enter" || e.key === "Escape") && (composing || e.isComposing || e.keyCode === 229)) {
          e.preventDefault();
        }
      });
    }
    if (dialog) {
      dialog.addEventListener("cancel", function (e) {
        if (composing) e.preventDefault();
      });
    }
  }
  guardDialogIme(nameDialog, nameInput);

  function setNameError(message) {
    if (nameError) {
      nameError.textContent = message || "";
      nameError.hidden = !message;
    }
    if (typeof nameInput.setAttribute === "function") {
      if (message) nameInput.setAttribute("aria-invalid", "true");
      else if (typeof nameInput.removeAttribute === "function") nameInput.removeAttribute("aria-invalid");
    }
  }
  nameInput.addEventListener("input", function () { setNameError(""); });

  document.querySelectorAll("[data-close]").forEach(function (el) {
    el.addEventListener("click", function () { el.closest("dialog").close(); });
  });

  function openNewFolderDialog(trigger) {
    nameMode = "folder";
    nameOpener = trigger || document.activeElement;
    nameDialogTitle.textContent = t("newFolderTitle");
    nameDialogNote.hidden = true;
    nameInput.value = "";
    if (nameInputLabel) nameInputLabel.textContent = t("newFolderLabel");
    nameInput.setAttribute("aria-label", t("newFolderLabel"));
    setNameError("");
    nameDialog.showModal();
  }

  document.querySelectorAll("[data-new]").forEach(function (el) {
    el.addEventListener("click", function () {
      var mode = el.getAttribute("data-new");
      var trigger = menuAnchor;
      closeMenus(false);
      if (mode === "upload") { fileInput.click(); return; }
      openNewFolderDialog(trigger);
    });
  });

  var deleteDialog = document.getElementById("delete-dialog");
  var deleteBody = document.getElementById("delete-body");
  var deleteConfirm = document.getElementById("delete-confirm");
  if (deleteDialog) {
    deleteDialog.addEventListener("close", function () {
      if (deleteDialog.open) return;
      bulkActionPlan = null;
      var opener = deleteOpener;
      deleteOpener = null;
      restoreDialogFocus(opener);
    });
  }
  var cleanupDialog = document.getElementById("cleanup-dialog");
  if (cleanupDialog) {
    cleanupDialog.addEventListener("close", function () {
      if (cleanupDialog.open) return;
      cleanupTarget = null;
      cleanupVerified = null;
      var opener = cleanupOpener;
      cleanupOpener = null;
      restoreDialogFocus(opener);
    });
  }
  var folderResultDialog = document.getElementById("folder-result-dialog");
  if (folderResultDialog) {
    folderResultDialog.addEventListener("close", function () {
      if (folderResultDialog.open) return;
      var opener = folderResultOpener;
      folderResultOpener = null;
      restoreDialogFocus(opener);
    });
  }
  var moveDialog = document.getElementById("move-dialog");
  if (moveDialog) {
    moveDialog.addEventListener("close", function () {
      if (moveDialog.open) return;
      bulkActionPlan = null;
      var opener = moveOpener;
      moveOpener = null;
      restoreDialogFocus(opener);
    });
  }
  var moveForm = document.getElementById("move-form");
  var moveItemPrompt = document.getElementById("move-dialog-item");
  var moveDialogNote = document.getElementById("move-dialog-note");
  var moveFolderSelect = document.getElementById("move-folder");
  var moveCustomWrap = document.getElementById("move-custom-wrap");
  var moveCustomInput = document.getElementById("move-custom-input");
  var moveError = document.getElementById("move-error");
  var MOVE_CUSTOM = "__custom__";
  guardDialogIme(moveDialog, moveCustomInput);

  function knownFolders() {
    var seen = Object.create(null);
    state.files.forEach(function (f) {
      if (!f.path) return;
      var parts = f.path.split("/");
      var acc = "";
      for (var i = 0; i < parts.length - 1; i++) {
        if (!parts[i]) continue;
        acc += parts[i] + "/";
        seen[acc] = true;
      }
    });
    return Object.keys(seen).sort(function (a, b) {
      return a.localeCompare(b, lang === "ja" ? "ja" : undefined);
    });
  }
  function parentFolderOf(item) {
    if (item.type === "folder") {
      var trimmed = item.path.slice(0, -1);
      var folderSlash = trimmed.lastIndexOf("/");
      return folderSlash >= 0 ? trimmed.slice(0, folderSlash + 1) : "";
    }
    var slash = item.path.lastIndexOf("/");
    return slash >= 0 ? item.path.slice(0, slash + 1) : "";
  }
  function normalizeCustomFolder(raw) {
    var trimmed = raw.trim();
    if (!trimmed) return null;
    if (trimmed.charAt(0) === "/" || trimmed.indexOf("\\\\") >= 0 || /[\\u0000-\\u001f\\u007f]/.test(trimmed)) return false;
    var cleaned = trimmed.slice(-1) === "/" ? trimmed.slice(0, -1) : trimmed;
    var segments = cleaned.split("/");
    if (!segments.length) return false;
    for (var i = 0; i < segments.length; i++) {
      if (!segments[i] || segments[i] === "." || segments[i] === "..") return false;
    }
    return segments.join("/") + "/";
  }
  function setMoveError(message, field) {
    if (moveError) {
      moveError.textContent = message || "";
      moveError.hidden = !message;
    }
    [moveFolderSelect, moveCustomInput].forEach(function (el) {
      if (!el) return;
      if (message && el === field && typeof el.setAttribute === "function") el.setAttribute("aria-invalid", "true");
      else if (typeof el.removeAttribute === "function") el.removeAttribute("aria-invalid");
    });
    if (message && field && typeof field.focus === "function") field.focus();
  }
  function syncMoveCustom() {
    if (!moveCustomWrap || !moveFolderSelect) return;
    var custom = moveFolderSelect.value === MOVE_CUSTOM;
    moveCustomWrap.hidden = !custom;
    setMoveError("");
    if (custom && moveCustomInput && typeof moveCustomInput.focus === "function") moveCustomInput.focus();
  }
  if (moveFolderSelect) moveFolderSelect.addEventListener("change", syncMoveCustom);
  if (moveCustomInput) moveCustomInput.addEventListener("input", function () { setMoveError(""); });
  function openMoveDialog(item, trigger, preselectDest) {
    bulkActionPlan = null;
    moveOpener = trigger || document.activeElement;
    var currentParent = parentFolderOf(item);
    if (moveItemPrompt) moveItemPrompt.textContent = t("moveItemPrompt", { name: item.name });
    if (moveDialogNote) {
      if (item.type === "folder" && actionEntries) {
        moveDialogNote.textContent = t("moveFolderBody", { count: actionEntries.length });
        moveDialogNote.hidden = false;
      } else {
        moveDialogNote.hidden = true;
      }
    }
    if (moveFolderSelect) {
      moveFolderSelect.replaceChildren();
      var rootOpt = document.createElement("option");
      rootOpt.value = "";
      rootOpt.textContent = currentParent === "" ? t("moveCurrentSuffix", { label: t("home") }) : t("home");
      moveFolderSelect.appendChild(rootOpt);
      knownFolders().forEach(function (folder) {
        if (item.type === "folder" && folder.indexOf(item.path) === 0) return;
        var opt = document.createElement("option");
        opt.value = folder;
        opt.textContent = folder === currentParent ? t("moveCurrentSuffix", { label: folder }) : folder;
        moveFolderSelect.appendChild(opt);
      });
      var customOpt = document.createElement("option");
      customOpt.value = MOVE_CUSTOM;
      customOpt.textContent = t("moveCustomOption");
      moveFolderSelect.appendChild(customOpt);
      moveFolderSelect.value = typeof preselectDest === "string" ? preselectDest : currentParent;
    }
    if (moveCustomInput) moveCustomInput.value = "";
    if (moveCustomWrap) moveCustomWrap.hidden = true;
    setMoveError("");
    if (moveDialog) moveDialog.showModal();
  }
  function openBulkMoveDialog(plan, preselectDest, trigger) {
    actionTarget = null;
    actionEntries = null;
    bulkActionPlan = plan;
    moveOpener = trigger || document.activeElement;
    var totalEntries = 0;
    var parents = Object.create(null);
    var excludedPrefixes = [];
    plan.forEach(function (step) {
      totalEntries += step.entries ? step.entries.length : 1;
      parents[parentFolderOf(step.item)] = true;
      if (step.item.type === "folder") excludedPrefixes.push(step.item.path);
    });
    var parentKeys = Object.keys(parents);
    var commonParent = parentKeys.length === 1 ? parentKeys[0] : null;
    if (moveItemPrompt) moveItemPrompt.textContent = t("bulkMovePrompt", { count: plan.length });
    if (moveDialogNote) {
      moveDialogNote.textContent = t("bulkMoveNote", { count: totalEntries });
      moveDialogNote.hidden = false;
    }
    if (moveFolderSelect) {
      moveFolderSelect.replaceChildren();
      var rootOpt = document.createElement("option");
      rootOpt.value = "";
      rootOpt.textContent = commonParent === "" ? t("moveCurrentSuffix", { label: t("home") }) : t("home");
      moveFolderSelect.appendChild(rootOpt);
      knownFolders().forEach(function (folder) {
        for (var i = 0; i < excludedPrefixes.length; i++) {
          if (folder.indexOf(excludedPrefixes[i]) === 0) return;
        }
        var opt = document.createElement("option");
        opt.value = folder;
        opt.textContent = folder === commonParent ? t("moveCurrentSuffix", { label: folder }) : folder;
        moveFolderSelect.appendChild(opt);
      });
      var customOpt = document.createElement("option");
      customOpt.value = MOVE_CUSTOM;
      customOpt.textContent = t("moveCustomOption");
      moveFolderSelect.appendChild(customOpt);
      moveFolderSelect.value = typeof preselectDest === "string" ? preselectDest : (commonParent !== null ? commonParent : "");
    }
    if (moveCustomInput) moveCustomInput.value = "";
    if (moveCustomWrap) moveCustomWrap.hidden = true;
    setMoveError("");
    if (moveDialog) moveDialog.showModal();
  }

  itemMenu.querySelectorAll("[data-action]").forEach(function (el) {
    el.addEventListener("click", function () {
      var action = el.getAttribute("data-action");
      var item = menuTarget;
      var trigger = menuAnchor;
      closeMenus(false);
      if (!item || folderBusy) return;
      if (action === "open") { openItem(item, trigger); return; }
      if (action === "download") { download(item); return; }
      bulkActionPlan = null;
      actionEntries = item.type === "folder" ? folderSnapshot(item) : null;
      if (item.type === "folder" && !actionEntries) { folderUnavailable(); return; }
      actionTarget = item;
      if (action === "rename") {
        nameMode = "rename";
        nameOpener = trigger || document.activeElement;
        nameDialogTitle.textContent = t("renameTitle");
        if (item.type === "folder") {
          nameDialogNote.textContent = t("renameFolderBody", { count: actionEntries.length });
          nameDialogNote.hidden = false;
        } else {
          nameDialogNote.hidden = true;
        }
        nameInput.value = item.name;
        if (nameInputLabel) nameInputLabel.textContent = t("renameLabel");
        nameInput.setAttribute("aria-label", t("renameLabel"));
        setNameError("");
        nameDialog.showModal();
        nameInput.select();
      } else if (action === "move") {
        openMoveDialog(item, trigger);
      } else if (action === "delete") {
        deleteOpener = trigger || document.activeElement;
        deleteBody.textContent = item.type === "folder"
          ? t("deleteFolderBody", { name: item.name, count: actionEntries.length })
          : t("deleteBody", { name: item.name });
        deleteDialog.showModal();
      }
    });
  });

  if (moveForm) {
    moveForm.addEventListener("submit", function (e) {
      if (folderBusy) { e.preventDefault(); return; }
      var plan = bulkActionPlan;
      var item = actionTarget;
      if (!plan && !item) return;
      var usingCustom = moveFolderSelect && moveFolderSelect.value === MOVE_CUSTOM;
      var field = usingCustom ? moveCustomInput : moveFolderSelect;
      var destFolder = "";
      if (usingCustom) {
        var normalized = normalizeCustomFolder(moveCustomInput ? moveCustomInput.value : "");
        if (normalized === null) {
          e.preventDefault();
          setMoveError(t("movePathRequired"), moveCustomInput);
          return;
        }
        if (normalized === false) {
          e.preventDefault();
          setMoveError(t("movePathInvalid"), moveCustomInput);
          return;
        }
        destFolder = normalized;
      } else if (moveFolderSelect) {
        destFolder = moveFolderSelect.value;
      }
      if (plan) {
        var actionable = [];
        var destNames = Object.create(null);
        for (var i = 0; i < plan.length; i++) {
          var step = plan[i];
          var stepItem = step.item;
          if (parentFolderOf(stepItem) === destFolder) continue;
          if (stepItem.type === "folder") {
            var bulkDestPath = destFolder + stepItem.name + "/";
            if (bulkDestPath.indexOf(stepItem.path) === 0 || stepItem.path.indexOf(bulkDestPath) === 0) {
              e.preventDefault();
              setMoveError(t("moveIntoSelf"), field);
              return;
            }
          }
          var keyName = stepItem.name;
          if (destNames[keyName]) {
            e.preventDefault();
            setMoveError(t("bulkMoveCollision"), field);
            return;
          }
          destNames[keyName] = true;
          actionable.push(step);
        }
        if (!actionable.length) {
          e.preventDefault();
          setMoveError(t("moveSameFolder"), field);
          return;
        }
        setMoveError("");
        bulkActionPlan = null;
        runBulkOperation("move", actionable, destFolder);
        return;
      }
      if (destFolder === parentFolderOf(item)) {
        e.preventDefault();
        setMoveError(t("moveSameFolder"), field);
        return;
      }
      if (item.type === "folder") {
        var destFolderPath = destFolder + item.name + "/";
        if (destFolderPath.indexOf(item.path) === 0 || item.path.indexOf(destFolderPath) === 0) {
          e.preventDefault();
          setMoveError(t("moveIntoSelf"), field);
          return;
        }
        setMoveError("");
        runFolderOperation("rename", item, destFolderPath);
        return;
      }
      setMoveError("");
      if (!item.etag) { toast(t("errRevision")); load(); return; }
      api("/api/drive/move", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source_path: item.path,
          destination_path: destFolder + item.name,
          source_etag: item.etag,
        }),
      }).then(checkMutationResponse).then(function () { toast(t("itemMoved")); load(); }).catch(mutationFailed);
    });
  }

  nameForm.addEventListener("submit", function (e) {
    if (folderBusy) { e.preventDefault(); return; }
    var name = nameInput.value.trim();
    if (!name) {
      e.preventDefault();
      setNameError(t("nameRequired"));
      nameInput.focus();
      return;
    }
    if (name.indexOf("/") >= 0) {
      e.preventDefault();
      setNameError(t("nameInvalid"));
      nameInput.focus();
      return;
    }
    if (name === "." || name === ".." || name.indexOf("\\\\") >= 0 || /[\\u0000-\\u001f\\u007f]/.test(name)) {
      e.preventDefault();
      setNameError(t("nameInvalidPath"));
      nameInput.focus();
      return;
    }
    setNameError("");
    if (nameMode === "folder") {
      api(fileUrl(state.path + name + "/"), {
        method: "PUT",
        headers: {
          "content-type": "application/x-directory",
          "if-none-match": "*",
        },
        body: "",
      }).then(function (r) {
        checkMutationResponse(r);
        if (state.nav !== "files" || state.query) {
          clearSelection(false);
          state.nav = "files";
          state.query = "";
          searchInput.value = "";
          syncUrl("push");
        }
        toast(t("folderCreated"));
        load();
      }).catch(mutationFailed);
      return;
    }
    // rename
    var item = actionTarget;
    if (!item || name === item.name) return;
    if (item.type === "folder") {
      var folderParent = item.path.slice(0, item.path.slice(0, -1).lastIndexOf("/") + 1);
      runFolderOperation("rename", item, folderParent + name + "/");
      return;
    }
    if (!item.etag) { toast(t("errRevision")); load(); return; }
    var parent = item.path.slice(0, item.path.lastIndexOf("/") + 1);
    // Existing server-side CAS move copies create-only, checks the exact source
    // revision, and compensates a stale-source copy. Never emulate it with an
    // unguarded browser copy/delete sequence.
    api("/api/drive/move", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source_path: item.path,
        destination_path: parent + name,
        source_etag: item.etag,
      }),
    }).then(checkMutationResponse).then(function () { toast(t("itemRenamed")); load(); }).catch(mutationFailed);
  });

  deleteConfirm.addEventListener("click", function () {
    var plan = bulkActionPlan;
    var item = actionTarget;
    bulkActionPlan = null;
    deleteDialog.close();
    if (folderBusy) return;
    if (plan) {
      runBulkOperation("delete", plan);
      return;
    }
    if (!item) return;
    if (item.type === "folder") { runFolderOperation("delete", item); return; }
    if (!item.etag) { toast(t("errRevision")); load(); return; }
    api(fileUrl(item.path), {
      method: "DELETE",
      headers: { "if-match": item.etag },
    }).then(checkMutationResponse).then(function () { toast(t("itemDeleted")); load(); }).catch(mutationFailed);
  });

  // ---- Boot ----
  boot();
})();
</script>
</body>
</html>`;
}

const STORAGE_KEY = 'chatSectionBookmarksV2';
const BACKUP_STATUS_KEY = 'chatSectionBackupStatusV1';
const BOOKMARK_TEXT_MAX = 150;
const SYNC_ENABLED_KEY = 'chatSectionGoogleSyncEnabledV1';
const SYNC_STATUS_KEY = 'chatSectionGoogleSyncStatusV1';
const SYNC_META_KEY = 'chatSectionBookmarkSyncMetaV1';
const SYNC_CHUNK_PREFIX = 'chatSectionBookmarkSyncChunkV1:';
const SYNC_CHUNK_SIZE = 7000;
const SYNC_MAX_TOTAL_CHARS = 95000;
const SYNC_DEBUG_KEY = 'chatSectionGoogleSyncDebugLogV1';
const SYNC_DEBUG_MAX = 120;
const BOOKMARK_SYNC_FOLDER_TITLE = 'Chat Section Bookmarker Sync';
const BOOKMARK_SYNC_META_TITLE = 'CSB_SYNC_META';
const BOOKMARK_SYNC_CHUNK_TITLE_PREFIX = 'CSB_SYNC_CHUNK_';
const BOOKMARK_SYNC_URL_PREFIX = 'https://chat-section-bookmarker.local/sync/';
const BOOKMARK_SYNC_CHUNK_SIZE = 1400;
const APP_ENV = 'prod'; // change to 'dev' to store verbose sync diagnostics
const IS_DEV = APP_ENV !== 'prod';
const SYNC_PULL_ALARM_NAME = 'chatSectionBookmarkSyncPullAlarm';
const SYNC_PULL_INTERVAL_MINUTES = 2;

let backupInProgress = false;
let backupQueued = false;
let syncInProgress = false;
let syncQueued = false;
let applyingSyncStore = false;

async function configureSidePanelBehavior() {
  try {
    if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    }
  } catch (_) {}
}
configureSidePanelBehavior();
chrome.runtime.onInstalled.addListener(() => { configureSidePanelBehavior(); });
chrome.runtime.onStartup.addListener(() => { configureSidePanelBehavior(); });


function limitBookmarkText(text, maxLen = BOOKMARK_TEXT_MAX) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, Math.max(0, maxLen - 1)).trimEnd() + '…';
}

function sanitizeBookmark(bookmark) {
  const b = { ...(bookmark || {}) };
  if (b.snippet) b.snippet = limitBookmarkText(b.snippet, BOOKMARK_TEXT_MAX);
  if (b.label) b.label = limitBookmarkText(b.label, BOOKMARK_TEXT_MAX);
  if (b.title) b.title = limitBookmarkText(b.title, BOOKMARK_TEXT_MAX);
  if (b.target && typeof b.target === 'object') {
    b.target = { ...b.target };
    if (b.target.snippet) b.target.snippet = limitBookmarkText(b.target.snippet, 100);
  }
  return b;
}

function normalizeStore(store) {
  if (!store || typeof store !== 'object') return { groups: {}, version: 3 };
  const groups = {};
  Object.entries(store.groups && typeof store.groups === 'object' ? store.groups : {}).forEach(([key, group]) => {
    if (!group || typeof group !== 'object') return;
    groups[key] = {
      ...group,
      bookmarks: Array.isArray(group.bookmarks) ? group.bookmarks.map(sanitizeBookmark) : [],
      deletedBookmarks: normalizeDeletedBookmarks(group.deletedBookmarks)
    };
  });
  return {
    ...store,
    version: store.version || 3,
    groups
  };
}

function countBookmarks(store) {
  const normalized = normalizeStore(store);
  return Object.values(normalized.groups || {}).reduce((n, g) => n + ((g && Array.isArray(g.bookmarks)) ? g.bookmarks.length : 0), 0);
}

function hasDeletionTombstones(store) {
  const normalized = normalizeStore(store);
  return Object.values(normalized.groups || {}).some(g =>
    g && Object.keys(normalizeDeletedBookmarks(g.deletedBookmarks)).length > 0
  );
}

function maxStoreChangeTime(store) {
  const normalized = normalizeStore(store);
  let max = Number(normalized.updatedAt || normalized.lastChangedAt || 0) || 0;
  Object.values(normalized.groups || {}).forEach(g => {
    if (!g) return;
    max = Math.max(max, Number(g.updatedAt || g.lastChangedAt || 0) || 0);
    (Array.isArray(g.bookmarks) ? g.bookmarks : []).forEach(b => {
      max = Math.max(max, Number(b.updatedAt || b.createdAt || 0) || 0);
    });
    Object.values(normalizeDeletedBookmarks(g.deletedBookmarks)).forEach(t => {
      max = Math.max(max, Number(t.deletedAt || 0) || 0);
    });
  });
  return max;
}


function bookmarkMergeKey(bookmark) {
  const b = bookmark || {};
  return String(b.id || b.targetKey || ((b.url || '') + '|' + (b.createdAt || '') + '|' + (b.snippet || b.label || b.title || '')));
}

function tombstoneKeysForBookmark(bookmark) {
  const b = bookmark || {};
  const keys = new Set();
  if (b.id) keys.add('id:' + b.id);
  if (b.targetKey) keys.add('target:' + b.targetKey);
  keys.add('merge:' + bookmarkMergeKey(b));
  return Array.from(keys);
}

function normalizeDeletedBookmarks(value) {
  const out = {};
  if (!value || typeof value !== 'object') return out;
  Object.entries(value).forEach(([key, raw]) => {
    const deletedAt = typeof raw === 'number' ? raw : Number(raw && raw.deletedAt);
    if (key && Number.isFinite(deletedAt) && deletedAt > 0) out[key] = { deletedAt };
  });
  return out;
}

function mergeDeletedBookmarks(a, b) {
  const out = normalizeDeletedBookmarks(a);
  Object.entries(normalizeDeletedBookmarks(b)).forEach(([key, value]) => {
    if (!out[key] || Number(value.deletedAt || 0) > Number(out[key].deletedAt || 0)) out[key] = value;
  });
  return out;
}

function isBookmarkDeleted(bookmark, deletedBookmarks) {
  const deleted = normalizeDeletedBookmarks(deletedBookmarks);
  const bookmarkTime = Number(bookmark.updatedAt || bookmark.createdAt || 0);
  return tombstoneKeysForBookmark(bookmark).some(key => {
    const tombstone = deleted[key];
    return tombstone && Number(tombstone.deletedAt || 0) >= bookmarkTime;
  });
}

function mergeBookmarkLists(aList, bList, deletedBookmarks) {
  const map = new Map();
  [...(Array.isArray(aList) ? aList : []), ...(Array.isArray(bList) ? bList : [])].forEach(raw => {
    const b = sanitizeBookmark(raw || {});
    if (isBookmarkDeleted(b, deletedBookmarks)) return;
    const key = bookmarkMergeKey(b);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, b);
      return;
    }
    // Merge fields while preserving user edits from the newer/labelled record.
    const newer = Number(b.updatedAt || b.createdAt || 0) >= Number(existing.updatedAt || existing.createdAt || 0) ? b : existing;
    const older = newer === b ? existing : b;
    map.set(key, sanitizeBookmark({ ...older, ...newer, label: newer.label || older.label, title: newer.title || older.title }));
  });
  return Array.from(map.values()).sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}

function mergeGroups(localGroup, remoteGroup) {
  const local = localGroup && typeof localGroup === 'object' ? localGroup : {};
  const remote = remoteGroup && typeof remoteGroup === 'object' ? remoteGroup : {};
  const merged = { ...remote, ...local };
  // Prefer explicit user renames from either side.
  merged.chatNameOverride = local.chatNameOverride || remote.chatNameOverride || null;
  merged.projectNameOverride = local.projectNameOverride || remote.projectNameOverride || null;
  merged.chatName = merged.chatNameOverride || local.chatName || remote.chatName || local.chatNameDetected || remote.chatNameDetected || 'Untitled Chat';
  merged.projectName = merged.projectNameOverride || local.projectName || remote.projectName || local.projectNameDetected || remote.projectNameDetected || null;
  merged.deletedBookmarks = mergeDeletedBookmarks(remote.deletedBookmarks, local.deletedBookmarks);
  merged.bookmarks = mergeBookmarkLists(remote.bookmarks, local.bookmarks, merged.deletedBookmarks);
  return merged;
}

function mergeStores(localStore, remoteStore) {
  const local = normalizeStore(localStore);
  const remote = normalizeStore(remoteStore);
  const groups = { ...(remote.groups || {}) };
  Object.entries(local.groups || {}).forEach(([key, localGroup]) => {
    groups[key] = groups[key] ? mergeGroups(localGroup, groups[key]) : normalizeStore({ groups: { [key]: localGroup } }).groups[key];
  });
  Object.entries(remote.groups || {}).forEach(([key, remoteGroup]) => {
    if (!groups[key]) groups[key] = normalizeStore({ groups: { [key]: remoteGroup } }).groups[key];
  });
  return normalizeStore({ ...remote, ...local, version: Math.max(Number(local.version || 3), Number(remote.version || 3), 3), groups });
}

function getStore() {
  return new Promise(resolve => {
    chrome.storage.local.get({ [STORAGE_KEY]: { groups: {}, version: 3 } }, data => {
      resolve(normalizeStore(data[STORAGE_KEY]));
    });
  });
}

function setBackupStatus(status) {
  return chrome.storage.local.set({ [BACKUP_STATUS_KEY]: status });
}

function markBackupDirty(store, reason) {
  setBackupStatus({
    ok: null,
    dirty: true,
    at: Date.now(),
    reason: reason || 'Bookmark storage changed',
    bookmarkCount: countBookmarks(store)
  });
}

async function ensureOffscreenDocument() {
  if (!chrome.offscreen || !chrome.offscreen.createDocument) {
    throw new Error('Offscreen document support is unavailable in this Chrome version. Open the popup and click Save now.');
  }

  const offscreenUrl = chrome.runtime.getURL('offscreen.html');

  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [offscreenUrl]
    });
    if (contexts && contexts.length) return;
  } else if (await chrome.offscreen.hasDocument?.()) {
    return;
  }

  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['BLOBS'],
    justification: 'Write bookmark changes to the user-connected JSON backup file without opening the popup.'
  });
}

function sendMessageToOffscreen(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, response => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(response || {});
    });
  });
}

async function writeBackupViaOffscreen(reason) {
  const store = await getStore();
  await ensureOffscreenDocument();

  const response = await sendMessageToOffscreen({
    type: 'WRITE_BACKUP_FILE',
    reason: reason || 'Auto-saved bookmark change',
    store
  });

  if (!response || response.ok !== true) {
    const error = (response && response.error) || 'Backup write failed.';
    await setBackupStatus({
      ok: false,
      dirty: true,
      at: Date.now(),
      reason: reason || 'Auto-save failed',
      error,
      bookmarkCount: countBookmarks(store)
    });
    throw new Error(error);
  }

  await setBackupStatus({
    ok: true,
    dirty: false,
    at: Date.now(),
    filename: response.filename || 'chat-section-bookmarks.json',
    reason: reason || 'Auto-saved to connected JSON file',
    bookmarkCount: countBookmarks(store)
  });

  return response;
}

function scheduleBackupWrite(reason) {
  // Run immediately. MV3 service workers can sleep before delayed timers fire.
  runBackupWrite(reason || 'Auto-saved bookmark change');
}

async function runBackupWrite(reason) {
  if (backupInProgress) {
    backupQueued = true;
    return;
  }
  backupInProgress = true;
  try {
    await writeBackupViaOffscreen(reason || 'Auto-saved bookmark change');
  } catch (err) {
    // writeBackupViaOffscreen already records a status. This catch keeps the
    // service worker alive and prevents unhandled promise errors.
    console.warn('Backup write failed:', err && err.message ? err.message : err);
  } finally {
    backupInProgress = false;
    if (backupQueued) {
      backupQueued = false;
      scheduleBackupWrite('Auto-saved queued bookmark change');
    }
  }
}



function safeJsonSize(value) {
  try { return JSON.stringify(value).length; } catch (_) { return -1; }
}
async function logSyncDebug(event, details) {
  if (!IS_DEV) return;
  const entry = {
    at: Date.now(),
    iso: new Date().toISOString(),
    event,
    extensionId: chrome.runtime && chrome.runtime.id ? chrome.runtime.id : 'unknown',
    details: details || {}
  };
  try { console.log('[ChatSectionBookmarks sync]', event, entry.details); } catch (_) {}
  try {
    const data = await storageLocalGet({ [SYNC_DEBUG_KEY]: [] });
    const list = Array.isArray(data[SYNC_DEBUG_KEY]) ? data[SYNC_DEBUG_KEY] : [];
    list.unshift(entry);
    await storageLocalSet({ [SYNC_DEBUG_KEY]: list.slice(0, SYNC_DEBUG_MAX) });
  } catch (err) {
    try { console.warn('[ChatSectionBookmarks sync log failed]', err && err.message ? err.message : err); } catch (_) {}
  }
}
async function inspectChromeSyncState() {
  const local = await storageLocalGet({ [STORAGE_KEY]: { groups: {}, version: 3 }, [SYNC_ENABLED_KEY]: false, [SYNC_STATUS_KEY]: null, [SYNC_DEBUG_KEY]: [] });
  const localStore = normalizeStore(local[STORAGE_KEY]);
  const metaObj = await storageSyncGet({ [SYNC_META_KEY]: null });
  const meta = metaObj[SYNC_META_KEY] || null;
  let chunkLengths = [];
  let missingChunks = [];
  if (meta && meta.chunkCount) {
    const keys = [];
    for (let i = 0; i < meta.chunkCount; i++) keys.push(SYNC_CHUNK_PREFIX + i);
    const chunksObj = await storageSyncGet(keys);
    for (let i = 0; i < meta.chunkCount; i++) {
      const chunk = chunksObj[SYNC_CHUNK_PREFIX + i];
      if (typeof chunk === 'string') chunkLengths.push(chunk.length);
      else missingChunks.push(i);
    }
  }
  let bookmarkSync = null;
  try { bookmarkSync = await inspectBookmarkSyncState(); }
  catch (err) { bookmarkSync = { available: false, error: err && err.message ? err.message : String(err) }; }
  return {
    ok: true,
    extensionId: chrome.runtime.id,
    syncEnabled: !!local[SYNC_ENABLED_KEY],
    localBookmarkCount: countBookmarks(localStore),
    localGroupCount: Object.keys(localStore.groups || {}).length,
    localStoreChars: safeJsonSize(localStore),
    syncStatus: local[SYNC_STATUS_KEY] || null,
    syncMeta: meta,
    syncChunkLengths: chunkLengths,
    missingChunks,
    bookmarkSync,
    debugLog: Array.isArray(local[SYNC_DEBUG_KEY]) ? local[SYNC_DEBUG_KEY].slice(0, 80) : []
  };
}


function base64UrlEncode(str) {
  try {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    bytes.forEach(b => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  } catch (_) {
    return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }
}
function base64UrlDecode(str) {
  const normalized = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const bin = atob(padded);
  try {
    const bytes = Uint8Array.from(bin, ch => ch.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch (_) {
    return decodeURIComponent(escape(bin));
  }
}
function bookmarkSyncUrl(kind, data) {
  return BOOKMARK_SYNC_URL_PREFIX + kind + '?d=' + encodeURIComponent(data || '');
}
function readBookmarkSyncDataFromUrl(url) {
  try {
    const u = new URL(url || '');
    if (!u.href.startsWith(BOOKMARK_SYNC_URL_PREFIX)) return '';
    return u.searchParams.get('d') || '';
  } catch (_) { return ''; }
}
function chromeBookmarksAvailable() {
  return !!(chrome.bookmarks && chrome.bookmarks.search && chrome.bookmarks.create);
}
function bookmarksSearch(query) {
  return new Promise((resolve, reject) => {
    if (!chromeBookmarksAvailable()) return resolve([]);
    chrome.bookmarks.search(query, result => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message)); else resolve(result || []);
    });
  });
}
function bookmarksCreate(details) {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.create(details, result => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message)); else resolve(result);
    });
  });
}
function bookmarksGetChildren(id) {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.getChildren(id, result => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message)); else resolve(result || []);
    });
  });
}
function bookmarksRemoveTree(id) {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.removeTree(id, () => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message)); else resolve();
    });
  });
}
async function getOrCreateBookmarkSyncFolder() {
  const matches = await bookmarksSearch({ title: BOOKMARK_SYNC_FOLDER_TITLE });
  const folder = (matches || []).find(n => n && !n.url && n.title === BOOKMARK_SYNC_FOLDER_TITLE);
  if (folder) return folder;
  try { return await bookmarksCreate({ parentId: '1', title: BOOKMARK_SYNC_FOLDER_TITLE }); }
  catch (_) { return await bookmarksCreate({ title: BOOKMARK_SYNC_FOLDER_TITLE }); }
}
async function findBookmarkSyncFolder() {
  const matches = await bookmarksSearch({ title: BOOKMARK_SYNC_FOLDER_TITLE });
  return (matches || []).find(n => n && !n.url && n.title === BOOKMARK_SYNC_FOLDER_TITLE) || null;
}
async function inspectBookmarkSyncState() {
  if (!chromeBookmarksAvailable()) return { available: false, error: 'chrome.bookmarks API unavailable' };
  const folder = await findBookmarkSyncFolder();
  if (!folder) return { available: true, folderFound: false, bookmarkCount: 0, chunkCount: 0, chunkLengths: [] };
  const children = await bookmarksGetChildren(folder.id);
  const metaNode = children.find(n => n.title === BOOKMARK_SYNC_META_TITLE && n.url);
  let meta = null;
  try {
    const metaData = readBookmarkSyncDataFromUrl(metaNode && metaNode.url);
    if (metaData) meta = JSON.parse(base64UrlDecode(metaData));
  } catch (err) { meta = { error: err && err.message ? err.message : String(err) }; }
  const chunks = children.filter(n => n.title && n.title.startsWith(BOOKMARK_SYNC_CHUNK_TITLE_PREFIX) && n.url)
    .sort((a,b) => String(a.title).localeCompare(String(b.title)));
  return {
    available: true,
    folderFound: true,
    folderId: folder.id,
    meta,
    bookmarkCount: meta && Number.isFinite(Number(meta.bookmarkCount)) ? Number(meta.bookmarkCount) : 0,
    chunkCount: chunks.length,
    chunkLengths: chunks.map(n => readBookmarkSyncDataFromUrl(n.url).length)
  };
}
async function pushStoreToBookmarkSync(store, reason) {
  if (!chromeBookmarksAvailable()) {
    await logSyncDebug('bookmark_sync:unavailable', { reason: 'chrome.bookmarks API unavailable' });
    return { ok: false, skipped: true, error: 'chrome.bookmarks API unavailable' };
  }
  const normalized = normalizeStore(store);
  const payload = buildSyncPayload(normalized);
  const json = JSON.stringify(payload);
  const encoded = base64UrlEncode(json);
  const chunks = chunkString(encoded, BOOKMARK_SYNC_CHUNK_SIZE);
  const folder = await getOrCreateBookmarkSyncFolder();
  const oldChildren = await bookmarksGetChildren(folder.id);
  for (const child of oldChildren) {
    if (child.title === BOOKMARK_SYNC_META_TITLE || (child.title || '').startsWith(BOOKMARK_SYNC_CHUNK_TITLE_PREFIX)) {
      await bookmarksRemoveTree(child.id).catch(() => {});
    }
  }
  const meta = {
    schema: 'chat-section-bookmarker-bookmark-sync',
    schemaVersion: 1,
    updatedAt: Date.now(),
    dataChangedAt: maxStoreChangeTime(normalized),
    chunkCount: chunks.length,
    totalChars: json.length,
    encodedChars: encoded.length,
    bookmarkCount: countBookmarks(normalized),
    extensionId: chrome.runtime.id,
    reason: reason || 'Synced bookmarks via Chrome Bookmarks'
  };
  await bookmarksCreate({ parentId: folder.id, title: BOOKMARK_SYNC_META_TITLE, url: bookmarkSyncUrl('meta', base64UrlEncode(JSON.stringify(meta))) });
  for (let i = 0; i < chunks.length; i++) {
    const title = BOOKMARK_SYNC_CHUNK_TITLE_PREFIX + String(i).padStart(4, '0');
    await bookmarksCreate({ parentId: folder.id, title, url: bookmarkSyncUrl('chunk', chunks[i]) });
  }
  await logSyncDebug('bookmark_sync:push_success', { bookmarkCount: meta.bookmarkCount, chunkCount: chunks.length, encodedChars: encoded.length });
  return { ok: true, bookmarkCount: meta.bookmarkCount, chunkCount: chunks.length, encodedChars: encoded.length };
}
async function readStoreFromBookmarkSync() {
  const state = await inspectBookmarkSyncState();
  if (!state.available) throw new Error(state.error || 'Chrome Bookmarks API unavailable.');
  if (!state.folderFound) throw new Error('No Chrome Bookmarks sync folder found.');
  if (!state.meta || !state.meta.chunkCount) throw new Error('No Chrome Bookmarks sync metadata found.');
  const folder = await findBookmarkSyncFolder();
  const children = await bookmarksGetChildren(folder.id);
  let encoded = '';
  for (let i = 0; i < state.meta.chunkCount; i++) {
    const title = BOOKMARK_SYNC_CHUNK_TITLE_PREFIX + String(i).padStart(4, '0');
    const node = children.find(n => n.title === title && n.url);
    if (!node) throw new Error('Chrome Bookmarks sync data is incomplete. Missing chunk ' + i + '.');
    encoded += readBookmarkSyncDataFromUrl(node.url);
  }
  const json = base64UrlDecode(encoded);
  const parsed = JSON.parse(json);
  return { store: normalizeStore(parsed && parsed.data ? parsed.data : parsed), meta: state.meta, totalChars: json.length, chunkCount: state.meta.chunkCount, source: 'chrome-bookmarks', updatedAt: state.meta.updatedAt || 0, dataChangedAt: state.meta.dataChangedAt || 0 };
}

async function loadStoreFromBookmarkSync(options = {}) {
  await logSyncDebug('bookmark_sync:load_start', { extensionId: chrome.runtime.id, merge: !!options.merge });
  const remote = await readStoreFromBookmarkSync();
  const local = await getStore();
  const store = options.merge ? mergeStores(local, remote.store) : remote.store;
  applyingSyncStore = true;
  await storageLocalSet({ [STORAGE_KEY]: store, [SYNC_ENABLED_KEY]: true });
  applyingSyncStore = false;
  await setSyncStatus({ ok: true, at: Date.now(), bookmarkCount: countBookmarks(store), reason: options.merge ? 'Merged from Chrome Bookmarks sync fallback' : 'Loaded from Chrome Bookmarks sync fallback', totalChars: remote.totalChars, chunkCount: remote.chunkCount, extensionId: chrome.runtime.id });
  await logSyncDebug('bookmark_sync:load_success', { bookmarkCount: countBookmarks(store), totalChars: remote.totalChars, chunkCount: remote.chunkCount, merge: !!options.merge });
  return { ok: true, bookmarkCount: countBookmarks(store), totalChars: remote.totalChars, chunkCount: remote.chunkCount, extensionId: chrome.runtime.id, source: 'chrome-bookmarks', merged: !!options.merge };
}

async function getBookmarkSyncBookmarkCount() {
  try {
    const state = await inspectBookmarkSyncState();
    return Number(state.bookmarkCount) || 0;
  } catch (_) { return 0; }
}

function storageLocalGet(defaults) {
  return new Promise(resolve => chrome.storage.local.get(defaults, resolve));
}
function storageLocalSet(values) {
  return new Promise(resolve => chrome.storage.local.set(values, resolve));
}
function storageSyncGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get(keys, result => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(result || {});
    });
  });
}
function storageSyncSet(values) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set(values, () => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve();
    });
  });
}
function storageSyncRemove(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.remove(keys, () => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve();
    });
  });
}
function chunkString(value, size) {
  const chunks = [];
  for (let i = 0; i < value.length; i += size) chunks.push(value.slice(i, i + size));
  return chunks;
}
async function getSyncEnabled() {
  const data = await storageLocalGet({ [SYNC_ENABLED_KEY]: false });
  return !!data[SYNC_ENABLED_KEY];
}
async function setSyncStatus(status) {
  await storageLocalSet({ [SYNC_STATUS_KEY]: status });
}
function buildSyncPayload(store) {
  return {
    schema: 'chat-section-bookmarker-chrome-sync',
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    storageKey: STORAGE_KEY,
    data: normalizeStore(store)
  };
}
async function pushStoreToChromeSync(store, reason) {
  const normalized = normalizeStore(store);
  await logSyncDebug('push:start', { reason: reason || 'Synced bookmarks', localBookmarkCount: countBookmarks(normalized), localGroupCount: Object.keys(normalized.groups || {}).length, extensionId: chrome.runtime.id });
  const payload = buildSyncPayload(normalized);
  const json = JSON.stringify(payload);
  if (json.length > SYNC_MAX_TOTAL_CHARS) {
    await logSyncDebug('push:too_large', { totalChars: json.length, maxChars: SYNC_MAX_TOTAL_CHARS });
    throw new Error(`Bookmark data is too large for Chrome Sync (${json.length} chars). Export JSON instead or delete older bookmarks.`);
  }

  const chunks = chunkString(json, SYNC_CHUNK_SIZE);
  const old = await storageSyncGet({ [SYNC_META_KEY]: null });
  await logSyncDebug('push:prepared_chunks', { totalChars: json.length, chunkCount: chunks.length, oldChunkCount: old[SYNC_META_KEY] && old[SYNC_META_KEY].chunkCount ? old[SYNC_META_KEY].chunkCount : 0 });
  const oldCount = old[SYNC_META_KEY] && old[SYNC_META_KEY].chunkCount ? old[SYNC_META_KEY].chunkCount : 0;

  const values = {};
  chunks.forEach((chunk, index) => { values[SYNC_CHUNK_PREFIX + index] = chunk; });
  values[SYNC_META_KEY] = {
    schema: 'chat-section-bookmarker-chrome-sync',
    schemaVersion: 1,
    updatedAt: Date.now(),
    dataChangedAt: maxStoreChangeTime(normalized),
    chunkCount: chunks.length,
    totalChars: json.length,
    bookmarkCount: countBookmarks(normalized),
    reason: reason || 'Synced bookmarks'
  };
  await storageSyncSet(values);
  await logSyncDebug('push:set_complete', { metaKey: SYNC_META_KEY, chunkCount: chunks.length, totalChars: json.length, bookmarkCount: countBookmarks(normalized) });
  try { await pushStoreToBookmarkSync(normalized, reason || 'Synced bookmarks'); }
  catch (err) { await logSyncDebug('bookmark_sync:push_error', { error: err && err.message ? err.message : String(err) }); }

  if (oldCount > chunks.length) {
    const removeKeys = [];
    for (let i = chunks.length; i < oldCount; i++) removeKeys.push(SYNC_CHUNK_PREFIX + i);
    if (removeKeys.length) {
      await storageSyncRemove(removeKeys);
      await logSyncDebug('push:removed_old_chunks', { removeKeys });
    }
  }

  await setSyncStatus({ ok: true, at: Date.now(), bookmarkCount: countBookmarks(normalized), reason: reason || 'Synced bookmarks', totalChars: json.length, chunkCount: chunks.length, extensionId: chrome.runtime.id });
  await logSyncDebug('push:success', { bookmarkCount: countBookmarks(normalized), totalChars: json.length, chunkCount: chunks.length });
  return { ok: true, bookmarkCount: countBookmarks(normalized), totalChars: json.length, chunkCount: chunks.length, extensionId: chrome.runtime.id };
}
async function runChromeSyncPush(reason, force, options) {
  const enabled = force || await getSyncEnabled();
  if (!enabled) return { ok: true, skipped: true };
  if (syncInProgress) {
    syncQueued = true;
    return { ok: true, queued: true };
  }
  syncInProgress = true;
  try {
    const store = await getStore();
    const localCount = countBookmarks(store);
    const remoteCount = await getChromeSyncBookmarkCount();
    const allowEmptyOverwrite = !!(options && options.allowEmptyOverwrite);
    await logSyncDebug('push:guard_check', {
      reason: reason || 'Chrome Sync',
      localBookmarkCount: localCount,
      remoteBookmarkCount: remoteCount,
      allowEmptyOverwrite,
      extensionId: chrome.runtime.id
    });

    // Safety rule: never let a truly empty local browser overwrite Chrome Sync.
    // Exception: if the local store has deletion tombstones, then "0 bookmarks"
    // is an intentional delete-all state and must sync so other browsers remove
    // their stale copies.
    const localHasDeletionTombstones = hasDeletionTombstones(store);
    if (localCount === 0 && !localHasDeletionTombstones) {
      const status = {
        ok: true,
        skipped: true,
        at: Date.now(),
        bookmarkCount: 0,
        remoteBookmarkCount: remoteCount,
        reason: remoteCount > 0
          ? 'Skipped Chrome Sync: local bookmark store is empty and has no deletion tombstones, so it will not overwrite non-empty remote sync data.'
          : 'Skipped Chrome Sync: local bookmark store is empty.',
        extensionId: chrome.runtime.id
      };
      await setSyncStatus(status);
      await logSyncDebug(remoteCount > 0 ? 'push:blocked_empty_without_tombstones' : 'push:skipped_empty_local', status);
      return status;
    }
    if (localCount === 0 && localHasDeletionTombstones) {
      await logSyncDebug('push:allow_empty_delete_all', {
        reason: reason || 'Chrome Sync',
        localBookmarkCount: localCount,
        remoteBookmarkCount: remoteCount,
        localChangeTime: maxStoreChangeTime(store),
        extensionId: chrome.runtime.id
      });
    }

    let storeToPush = store;
    try {
      const remoteLoad = await readStoreFromChromeStorageSync().catch(() => null);
      const bookmarkLoad = await readStoreFromBookmarkSync().catch(() => null);
      const remoteStores = [remoteLoad, bookmarkLoad].filter(Boolean).map(x => x.store);
      for (const remoteStore of remoteStores) storeToPush = mergeStores(storeToPush, remoteStore);
      await logSyncDebug('push:merged_before_upload', { beforeLocalBookmarkCount: localCount, afterMergeBookmarkCount: countBookmarks(storeToPush), remoteSources: remoteStores.length, mergedChangeTime: maxStoreChangeTime(storeToPush) });
      if (JSON.stringify(normalizeStore(storeToPush)) !== JSON.stringify(normalizeStore(store))) {
        applyingSyncStore = true;
        await storageLocalSet({ [STORAGE_KEY]: storeToPush });
        applyingSyncStore = false;
      }
    } catch (err) {
      await logSyncDebug('push:merge_before_upload_error', { error: err && err.message ? err.message : String(err) });
    }
    return await pushStoreToChromeSync(storeToPush, reason || 'Auto-synced bookmark change');
  } catch (err) {
    await logSyncDebug('push:error', { reason: reason || 'Chrome Sync failed', error: err && err.message ? err.message : String(err) });
    await setSyncStatus({ ok: false, at: Date.now(), error: err && err.message ? err.message : String(err), reason: reason || 'Chrome Sync failed', extensionId: chrome.runtime.id });
    return { ok: false, error: err && err.message ? err.message : String(err) };
  } finally {
    syncInProgress = false;
    if (syncQueued) {
      syncQueued = false;
      runChromeSyncPush('Auto-synced queued bookmark change', false);
    }
  }
}

async function getChromeSyncBookmarkCount() {
  let storageCount = 0;
  try {
    const metaObj = await storageSyncGet({ [SYNC_META_KEY]: null });
    const meta = metaObj[SYNC_META_KEY];
    if (meta && Number.isFinite(Number(meta.bookmarkCount))) storageCount = Number(meta.bookmarkCount) || 0;
  } catch (_) {}
  const bookmarkCount = await getBookmarkSyncBookmarkCount();
  return Math.max(storageCount, bookmarkCount);
}

async function getRemoteSyncSummary() {
  let storageMeta = null;
  let storageCount = 0;
  let storageUpdatedAt = 0;
  try {
    const metaObj = await storageSyncGet({ [SYNC_META_KEY]: null });
    storageMeta = metaObj[SYNC_META_KEY] || null;
    storageCount = storageMeta && Number.isFinite(Number(storageMeta.bookmarkCount)) ? Number(storageMeta.bookmarkCount) : 0;
    storageUpdatedAt = storageMeta && Number.isFinite(Number(storageMeta.updatedAt)) ? Number(storageMeta.updatedAt) : 0;
  } catch (_) {}

  let bookmarkState = null;
  let bookmarkCount = 0;
  let bookmarkUpdatedAt = 0;
  try {
    bookmarkState = await inspectBookmarkSyncState();
    bookmarkCount = bookmarkState && Number.isFinite(Number(bookmarkState.bookmarkCount)) ? Number(bookmarkState.bookmarkCount) : 0;
    bookmarkUpdatedAt = bookmarkState && bookmarkState.meta && Number.isFinite(Number(bookmarkState.meta.updatedAt)) ? Number(bookmarkState.meta.updatedAt) : 0;
  } catch (_) {}

  const storageDataChangedAt = storageMeta && Number.isFinite(Number(storageMeta.dataChangedAt)) ? Number(storageMeta.dataChangedAt) : 0;
  const bookmarkDataChangedAt = bookmarkState && bookmarkState.meta && Number.isFinite(Number(bookmarkState.meta.dataChangedAt)) ? Number(bookmarkState.meta.dataChangedAt) : 0;
  const storageScore = Math.max(storageDataChangedAt, storageUpdatedAt);
  const bookmarkScore = Math.max(bookmarkDataChangedAt, bookmarkUpdatedAt);
  const bestSource = bookmarkScore > storageScore ? 'chrome-bookmarks' : 'chrome-storage-sync';
  const bookmarkCountBest = bestSource === 'chrome-bookmarks' ? bookmarkCount : storageCount;
  const updatedAt = Math.max(storageUpdatedAt, bookmarkUpdatedAt);
  const dataChangedAt = Math.max(storageDataChangedAt, bookmarkDataChangedAt);
  return {
    bookmarkCount: bookmarkCountBest,
    updatedAt,
    dataChangedAt,
    bestSource,
    storageCount,
    storageUpdatedAt,
    bookmarkCountFallback: bookmarkCount,
    bookmarkUpdatedAt,
    storageMeta,
    bookmarkState
  };
}

async function autoSyncRefresh(reason) {
  const enabled = await getSyncEnabled();
  if (!enabled) {
    await logSyncDebug('auto_refresh:skipped_disabled', { reason: reason || 'Auto refresh' });
    return { ok: true, skipped: true, reason: 'Chrome Sync disabled' };
  }
  if (syncInProgress || applyingSyncStore) {
    await logSyncDebug('auto_refresh:skipped_busy', { reason: reason || 'Auto refresh', syncInProgress, applyingSyncStore });
    return { ok: true, skipped: true, reason: 'Sync is busy' };
  }

  const localStore = await getStore();
  const localCount = countBookmarks(localStore);
  const remote = await getRemoteSyncSummary();
  await logSyncDebug('auto_refresh:decision', {
    reason: reason || 'Auto refresh',
    localBookmarkCount: localCount,
    remoteBookmarkCount: remote.bookmarkCount,
    bestSource: remote.bestSource,
    storageCount: remote.storageCount,
    bookmarkFallbackCount: remote.bookmarkCountFallback,
    extensionId: chrome.runtime.id
  });

  const localChangeTime = maxStoreChangeTime(localStore);
  const remoteChangeTime = Number(remote.dataChangedAt || remote.updatedAt || 0) || 0;
  const shouldPull = remote.bookmarkCount > 0 || remoteChangeTime > localChangeTime || remote.bookmarkCount !== localCount;
  if (shouldPull) {
    return await loadStoreFromChromeSync({ merge: true });
  }

  await setSyncStatus({
    ok: true,
    at: Date.now(),
    bookmarkCount: localCount,
    remoteBookmarkCount: remote.bookmarkCount,
    reason: 'Chrome Sync checked. Local data is current.',
    extensionId: chrome.runtime.id
  });
  return { ok: true, skipped: true, localBookmarkCount: localCount, remoteBookmarkCount: remote.bookmarkCount, extensionId: chrome.runtime.id };
}

async function enableChromeSyncSmart() {
  await storageLocalSet({ [SYNC_ENABLED_KEY]: true });
  const localStore = await getStore();
  const localCount = countBookmarks(localStore);
  const remoteCount = await getChromeSyncBookmarkCount();
  await logSyncDebug('enable:smart_decision', {
    localBookmarkCount: localCount,
    remoteBookmarkCount: remoteCount,
    extensionId: chrome.runtime.id
  });

  // Critical: never overwrite an existing non-empty Chrome Sync store with an
  // empty local browser. This is what made Browser B replace Browser A's data
  // with an empty `{ groups: {} }` payload.
  if (localCount === 0 && remoteCount > 0) {
    return await loadStoreFromChromeSync();
  }

  // First device or browser with local bookmarks: upload local data.
  if (localCount > 0) {
    return await runChromeSyncPush('Enabled Chrome Sync', true);
  }

  // Empty local and empty remote: enable sync, but do not write an empty remote
  // payload unless the user explicitly clicks Sync now later.
  await setSyncStatus({
    ok: true,
    at: Date.now(),
    bookmarkCount: 0,
    reason: 'Chrome Sync enabled. No local or remote bookmarks yet.',
    extensionId: chrome.runtime.id
  });
  await logSyncDebug('enable:empty_no_push', { extensionId: chrome.runtime.id });
  return { ok: true, bookmarkCount: 0, skippedPush: true, extensionId: chrome.runtime.id };
}
async function readStoreFromChromeStorageSync() {
  const metaObj = await storageSyncGet({ [SYNC_META_KEY]: null });
  const meta = metaObj[SYNC_META_KEY];
  if (!meta || !meta.chunkCount) throw new Error('No Chrome Sync bookmark data found.');
  const keys = [];
  for (let i = 0; i < meta.chunkCount; i++) keys.push(SYNC_CHUNK_PREFIX + i);
  const chunksObj = await storageSyncGet(keys);
  let json = '';
  for (let i = 0; i < meta.chunkCount; i++) {
    const chunk = chunksObj[SYNC_CHUNK_PREFIX + i];
    if (typeof chunk !== 'string') throw new Error('Chrome Sync data is incomplete. Try syncing again from the other Chrome profile.');
    json += chunk;
  }
  const parsed = JSON.parse(json);
  return { store: normalizeStore(parsed && parsed.data ? parsed.data : parsed), meta, totalChars: json.length, chunkCount: meta.chunkCount, source: 'chrome-storage-sync', updatedAt: meta.updatedAt || 0, dataChangedAt: meta.dataChangedAt || 0 };
}

async function loadStoreFromChromeSync(options = {}) {
  await logSyncDebug('load:start', { extensionId: chrome.runtime.id, merge: options.merge !== false });

  let storageRemote = null;
  let bookmarkRemote = null;
  try { storageRemote = await readStoreFromChromeStorageSync(); }
  catch (err) { await logSyncDebug('load:storage_read_error', { error: err && err.message ? err.message : String(err) }); }
  try { bookmarkRemote = await readStoreFromBookmarkSync(); }
  catch (err) { await logSyncDebug('load:bookmark_read_error', { error: err && err.message ? err.message : String(err) }); }

  if (!storageRemote && !bookmarkRemote) {
    await logSyncDebug('load:no_remote_sources', { extensionId: chrome.runtime.id });
    throw new Error('No Chrome Sync bookmark data found.');
  }

  // Pick the newest remote source by data-change timestamp, not by bookmark count.
  // Count-based selection can resurrect deleted bookmarks when another browser
  // still has an older, larger copy. Timestamp/tombstone merge is the source
  // of truth for conflict resolution.
  function remoteScore(remote) {
    if (!remote) return 0;
    const metaChangedAt = remote.meta && Number(remote.meta.dataChangedAt || 0);
    return Math.max(Number(remote.dataChangedAt || 0) || 0, Number(metaChangedAt || 0) || 0, Number(remote.updatedAt || 0) || 0);
  }
  let remote = storageRemote || bookmarkRemote;
  if (bookmarkRemote && (!remote || remoteScore(bookmarkRemote) > remoteScore(remote))) remote = bookmarkRemote;
  if (storageRemote && (!remote || remoteScore(storageRemote) > remoteScore(remote))) remote = storageRemote;

  const local = await getStore();
  const shouldMerge = options.merge !== false;
  const store = shouldMerge ? mergeStores(local, remote.store) : remote.store;
  applyingSyncStore = true;
  await storageLocalSet({ [STORAGE_KEY]: store, [SYNC_ENABLED_KEY]: true });
  applyingSyncStore = false;
  await setSyncStatus({ ok: true, at: Date.now(), bookmarkCount: countBookmarks(store), reason: shouldMerge ? 'Merged from Chrome Sync' : 'Loaded from Chrome Sync', totalChars: remote.totalChars, chunkCount: remote.chunkCount, source: remote.source, extensionId: chrome.runtime.id });
  await logSyncDebug('load:success', { bookmarkCount: countBookmarks(store), totalChars: remote.totalChars, chunkCount: remote.chunkCount, source: remote.source, merged: shouldMerge });
  return { ok: true, bookmarkCount: countBookmarks(store), totalChars: remote.totalChars, chunkCount: remote.chunkCount, source: remote.source, merged: shouldMerge, extensionId: chrome.runtime.id };
}


async function configureSyncAlarm(enabled) {
  if (!chrome.alarms || !chrome.alarms.create) return;
  if (enabled) {
    chrome.alarms.create(SYNC_PULL_ALARM_NAME, { periodInMinutes: SYNC_PULL_INTERVAL_MINUTES });
  } else {
    chrome.alarms.clear(SYNC_PULL_ALARM_NAME, () => {});
  }
}

async function refreshSyncAlarmFromSetting() {
  const enabled = await getSyncEnabled().catch(() => false);
  await configureSyncAlarm(enabled);
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && changes[SYNC_META_KEY]) {
    // When another Chrome profile updates chrome.storage.sync, pull into any
    // empty local profile automatically. This makes sync behave without
    // uninstalling/re-enabling the extension.
    setTimeout(() => autoSyncRefresh('Remote Chrome Sync metadata changed'), 800);
    return;
  }
  if (areaName !== 'local') return;
  if (changes[SYNC_ENABLED_KEY]) configureSyncAlarm(!!(changes[SYNC_ENABLED_KEY].newValue));
  if (!changes[STORAGE_KEY]) return;
  const store = normalizeStore(changes[STORAGE_KEY].newValue || { groups: {}, version: 3 });
  markBackupDirty(store, 'Bookmark storage changed');
  scheduleBackupWrite('Auto-saved bookmark change');
  if (!applyingSyncStore) runChromeSyncPush('Auto-synced bookmark change', false);
});

if (chrome.bookmarks && chrome.bookmarks.onCreated) {
  const scheduleBookmarkFallbackRefresh = () => setTimeout(() => autoSyncRefresh('Chrome Bookmarks sync fallback changed'), 1200);
  chrome.bookmarks.onCreated.addListener(scheduleBookmarkFallbackRefresh);
  chrome.bookmarks.onChanged.addListener(scheduleBookmarkFallbackRefresh);
  chrome.bookmarks.onRemoved.addListener(scheduleBookmarkFallbackRefresh);
}


chrome.runtime.onInstalled.addListener(() => {
  getStore().then(store => markBackupDirty(store, 'Extension installed or updated'));
  refreshSyncAlarmFromSetting();
});

chrome.runtime.onStartup.addListener(() => {
  refreshSyncAlarmFromSetting();
});

if (chrome.alarms && chrome.alarms.onAlarm) {
  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm && alarm.name === SYNC_PULL_ALARM_NAME) autoSyncRefresh('Periodic Chrome Sync pull');
  });
}

refreshSyncAlarmFromSetting();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'OPEN_BOOKMARK_TAB') {
    chrome.tabs.create({ url: message.url, active: true }, (tab) => {
      sendResponse({ ok: true, tabId: tab && tab.id });
    });
    return true;
  }

  if (message && message.type === 'MARK_BACKUP_DIRTY') {
    getStore().then(store => {
      markBackupDirty(store, message.reason || 'Manual backup requested');
      runBackupWrite(message.reason || 'Manual backup requested');
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message && message.type === 'WRITE_BACKUP_NOW') {
    writeBackupViaOffscreen(message.reason || 'Manual backup requested')
      .then(response => sendResponse({ ok: true, ...response }))
      .catch(err => sendResponse({ ok: false, error: err && err.message ? err.message : String(err) }));
    return true;
  }

  if (message && message.type === 'SET_GOOGLE_SYNC_ENABLED') {
    (message.enabled
      ? enableChromeSyncSmart().then(async r => { await configureSyncAlarm(true); return r; })
      : storageLocalSet({ [SYNC_ENABLED_KEY]: false })
          .then(async () => { await configureSyncAlarm(false); })
          .then(() => setSyncStatus({ ok: true, at: Date.now(), bookmarkCount: 0, reason: 'Chrome Sync disabled', extensionId: chrome.runtime.id }))
          .then(() => ({ ok: true, disabled: true, extensionId: chrome.runtime.id })))
      .then(response => sendResponse({ ok: true, ...(response || {}) }))
      .catch(err => sendResponse({ ok: false, error: err && err.message ? err.message : String(err), extensionId: chrome.runtime.id }));
    return true;
  }

  if (message && message.type === 'SYNC_BOOKMARKS_NOW') {
    runChromeSyncPush('Manual Chrome Sync', true)
      .then(response => sendResponse(response || { ok: true }))
      .catch(err => sendResponse({ ok: false, error: err && err.message ? err.message : String(err) }));
    return true;
  }

  if (message && message.type === 'AUTO_SYNC_REFRESH') {
    autoSyncRefresh(message.reason || 'Popup opened')
      .then(response => sendResponse(response || { ok: true }))
      .catch(async err => {
        await logSyncDebug('auto_refresh:error', { error: err && err.message ? err.message : String(err) });
        sendResponse({ ok: false, error: err && err.message ? err.message : String(err), extensionId: chrome.runtime.id });
      });
    return true;
  }

  if (message && message.type === 'LOAD_BOOKMARKS_FROM_SYNC') {
    loadStoreFromChromeSync()
      .then(response => sendResponse(response || { ok: true }))
      .catch(async err => {
        applyingSyncStore = false;
        await logSyncDebug('load:error', { error: err && err.message ? err.message : String(err) });
        sendResponse({ ok: false, error: err && err.message ? err.message : String(err), extensionId: chrome.runtime.id });
      });
    return true;
  }

  if (message && message.type === 'GET_SYNC_DEBUG') {
    inspectChromeSyncState()
      .then(response => sendResponse(response))
      .catch(err => sendResponse({ ok: false, error: err && err.message ? err.message : String(err), extensionId: chrome.runtime.id }));
    return true;
  }

  if (message && message.type === 'CLEAR_SYNC_DEBUG') {
    storageLocalSet({ [SYNC_DEBUG_KEY]: [] })
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: err && err.message ? err.message : String(err) }));
    return true;
  }

});

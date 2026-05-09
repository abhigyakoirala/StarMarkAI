const STORAGE_KEY = 'chatSectionBookmarksV2';
const PENDING_KEY = 'chatSectionPendingJumpV2';
const UI_STATE_KEY = 'chatSectionBookmarkUiStateV1';
const PROVIDER_FILTER_KEY = 'chatSectionBookmarkProviderFilterV1';
const SORT_MODE_KEY = 'chatSectionBookmarkSortModeV1';
const SEARCH_TERM_KEY = 'chatSectionBookmarkSearchTermV1';
const BACKUP_STATUS_KEY = 'chatSectionBackupStatusV1';
const BACKUP_FILENAME = 'chat-section-bookmarker/bookmarks-backup.json';
const BOOKMARK_TEXT_MAX = 150;
const SYNC_ENABLED_KEY = 'chatSectionGoogleSyncEnabledV1';
const SYNC_STATUS_KEY = 'chatSectionGoogleSyncStatusV1';
const THEME_KEY = 'chatSectionBookmarkThemeModeV1';
const APP_ENV = 'prod'; // change to 'dev' to show diagnostics buttons and store debug logs
const IS_DEV = APP_ENV !== 'prod';

function normalizeUrl(url) {
  try { const u = new URL(url); u.hash = ''; u.search = ''; return u.toString().replace(/\/$/, ''); }
  catch (_) { return (url || '').split('#')[0].split('?')[0].replace(/\/$/, ''); }
}

function providerFromUrl(url) {
  try {
    const h = new URL(url || '').hostname;
    if (h.includes('claude.ai')) return 'claude';
    if (h.includes('chatgpt.com') || h.includes('chat.openai.com')) return 'chatgpt';
  } catch (_) {}
  return 'unknown';
}

function parseChatGptUrl(url) {
  try {
    const u = new URL(url || '');
    const projectMatch = u.pathname.match(/\/g\/([^/]+)(?:\/c\/([^/]+))?/);
    if (projectMatch) {
      return {
        provider: 'chatgpt',
        isProjectChat: true,
        projectId: projectMatch[1],
        chatId: projectMatch[2] || null,
        projectKey: `${u.origin}/g/${projectMatch[1]}`,
        chatKey: projectMatch[2] ? `${u.origin}/g/${projectMatch[1]}/c/${projectMatch[2]}` : null
      };
    }
    const normalMatch = u.pathname.match(/\/c\/([^/]+)/);
    if (normalMatch) {
      return { provider: 'chatgpt', isProjectChat: false, projectId: null, chatId: normalMatch[1], projectKey: null, chatKey: `${u.origin}/c/${normalMatch[1]}` };
    }
  } catch (_) {}
  return { provider: 'chatgpt', isProjectChat: false, projectId: null, chatId: null, projectKey: null, chatKey: normalizeUrl(url || '') };
}

function parseClaudeUrl(url) {
  // All Claude chat URLs use /chat/<id> regardless of project membership.
  // Project info is stored on the group object by content.js (which reads
  // it from the DOM). The popup must trust group.isProjectChat / group.projectId
  // rather than trying to re-derive from the URL.
  try {
    const u = new URL(url || '');
    const chatMatch = u.pathname.match(/\/chat\/([^/]+)/i);
    if (chatMatch) return { provider: 'claude', isProjectChat: false, projectId: null, chatId: chatMatch[1], projectKey: null, chatKey: `${u.origin}/chat/${chatMatch[1]}` };
  } catch (_) {}
  return { provider: providerFromUrl(url), isProjectChat: false, projectId: null, chatId: null, projectKey: null, chatKey: normalizeUrl(url || '') };
}

function parseUrl(url) {
  const provider = providerFromUrl(url);
  if (provider === 'claude') return parseClaudeUrl(url);
  return parseChatGptUrl(url);
}

function normalizeNameKey(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9 ]+/g, '').trim();
}

function getProjectDisplayName(group, fallbackId) {
  return group.projectNameOverride || group.projectName || group.projectNameDetected || fallbackId || 'Untitled Project';
}

function effectiveMeta(group) {
  const parsed = parseUrl(group.url || group.chatKey || '');
  const provider = group.provider || parsed.provider || providerFromUrl(group.url || '') || 'unknown';
  const isProjectChat = parsed.isProjectChat || (group.isProjectChat === true && !!(group.projectId || group.projectKey));
  const projectId = parsed.projectId || group.projectId || null;
  const projectDisplayName = getProjectDisplayName(group, projectId);
  const chatKey = parsed.chatKey || group.chatKey || normalizeUrl(group.url || '');
  let projectKey = null;

  if (isProjectChat) {
    if (provider === 'chatgpt') {
      const projectNameKey = normalizeNameKey(projectDisplayName);
      projectKey = projectNameKey ? `chatgpt-project-name:${projectNameKey}` : (parsed.projectKey || group.projectKey || `chatgpt-project:${projectId}`);
    } else {
      projectKey = parsed.projectKey || group.projectKey || `${provider}-project:${projectId || normalizeNameKey(projectDisplayName)}`;
    }
  }

  return { provider, isProjectChat, projectId, projectKey, projectDisplayName, chatKey };
}


function limitBookmarkText(text, maxLen = BOOKMARK_TEXT_MAX) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, Math.max(0, maxLen - 1)).trimEnd() + '…';
}


function bookmarkMergeKey(bookmark) {
  const b = bookmark || {};
  return String(b.id || b.targetKey || ((b.url || '') + '|' + (b.createdAt || '') + '|' + (b.snippet || b.label || b.title || '')));
}

function hasDeletedBookmarks(group) {
  return !!(group && group.deletedBookmarks && Object.keys(normalizeDeletedBookmarks(group.deletedBookmarks)).length);
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

function rememberDeletedBookmark(group, bookmark) {
  if (!group || !bookmark) return;
  const deletedAt = Date.now();
  group.updatedAt = deletedAt;
  group.lastChangedAt = deletedAt;
  group.deletedBookmarks = normalizeDeletedBookmarks(group.deletedBookmarks);
  if (bookmark.id) group.deletedBookmarks['id:' + bookmark.id] = { deletedAt };
  if (bookmark.targetKey) group.deletedBookmarks['target:' + bookmark.targetKey] = { deletedAt };
  group.deletedBookmarks['merge:' + bookmarkMergeKey(bookmark)] = { deletedAt };
}

function sanitizeBookmarkForStorage(bookmark) {
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

function normalizeStoreForBackup(store) {
  if (!store || typeof store !== 'object') return { groups: {}, version: 3 };
  const groups = {};
  Object.entries(store.groups && typeof store.groups === 'object' ? store.groups : {}).forEach(([key, group]) => {
    if (!group || typeof group !== 'object') return;
    groups[key] = {
      ...group,
      bookmarks: Array.isArray(group.bookmarks) ? group.bookmarks.map(sanitizeBookmarkForStorage) : [],
      deletedBookmarks: normalizeDeletedBookmarks(group.deletedBookmarks)
    };
  });
  return {
    ...store,
    version: store.version || 3,
    groups
  };
}

function buildBackupPayload(store) {
  return {
    schema: 'chat-section-bookmarker-backup',
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    storageKey: STORAGE_KEY,
    extensionVersion: chrome.runtime.getManifest().version,
    data: normalizeStoreForBackup(store)
  };
}

function parseBackupPayload(raw) {
  const parsed = JSON.parse(raw);
  const data = parsed && parsed.data ? parsed.data : parsed;
  if (!data || typeof data !== 'object' || !data.groups || typeof data.groups !== 'object') {
    throw new Error('This JSON does not look like a Chat Section Bookmarker backup.');
  }
  return normalizeStoreForBackup(data);
}

function countBookmarksInStore(store) {
  const normalized = normalizeStoreForBackup(store);
  return Object.values(normalized.groups || {}).reduce((n, g) => n + ((g && Array.isArray(g.bookmarks)) ? g.bookmarks.length : 0), 0);
}

function downloadJson(filename, payload) {
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const BACKUP_DB_NAME = 'chat-section-bookmarker-backup-db';
const BACKUP_DB_STORE = 'handles';
const BACKUP_HANDLE_ID = 'backup-json-file';
let backupWriteTimer = null;
let backupWriteInProgress = false;
let pendingBackupWrite = false;

function backupDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(BACKUP_DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(BACKUP_DB_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open backup database'));
  });
}

async function setBackupHandle(handle) {
  const db = await backupDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(BACKUP_DB_STORE, 'readwrite');
    tx.objectStore(BACKUP_DB_STORE).put(handle, BACKUP_HANDLE_ID);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error('Could not save backup file handle'));
  });
  db.close();
}

async function getBackupHandle() {
  const db = await backupDb();
  const handle = await new Promise((resolve, reject) => {
    const tx = db.transaction(BACKUP_DB_STORE, 'readonly');
    const req = tx.objectStore(BACKUP_DB_STORE).get(BACKUP_HANDLE_ID);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error || new Error('Could not read backup file handle'));
  });
  db.close();
  return handle;
}

async function ensureBackupPermission(handle, mode) {
  if (!handle) return false;
  const opts = { mode: mode || 'readwrite' };
  if (typeof handle.queryPermission === 'function') {
    const existing = await handle.queryPermission(opts);
    if (existing === 'granted') return true;
  }
  if (typeof handle.requestPermission === 'function') {
    const requested = await handle.requestPermission(opts);
    return requested === 'granted';
  }
  return true;
}

async function writeStoreToBackupFile(store, reason) {
  if (!('showSaveFilePicker' in window)) {
    setBackupStatus({ ok: false, dirty: true, at: Date.now(), error: 'This Chrome build does not support direct JSON file writing from extensions. Use Export copy instead.' });
    return false;
  }
  const handle = await getBackupHandle();
  if (!handle) {
    setBackupStatus({ ok: false, dirty: true, at: Date.now(), error: 'No JSON backup file connected.' });
    return false;
  }
  const permitted = await ensureBackupPermission(handle, 'readwrite');
  if (!permitted) {
    setBackupStatus({ ok: false, dirty: true, at: Date.now(), error: 'Permission denied for the connected JSON file.' });
    return false;
  }
  const payload = buildBackupPayload(store);
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(payload, null, 2));
  await writable.close();
  setBackupStatus({ ok: true, dirty: false, at: Date.now(), filename: handle.name || 'bookmarks-backup.json', reason: reason || 'Saved to connected JSON file', bookmarkCount: countBookmarksInStore(store) });
  return true;
}

function setBackupStatus(status) {
  chrome.storage.local.set({ [BACKUP_STATUS_KEY]: status }, updateBackupStatus);
}

function scheduleBackupFileWrite(reason) {
  clearTimeout(backupWriteTimer);
  backupWriteTimer = setTimeout(() => saveBackupFile(reason || 'Auto-saved after bookmark change'), 500);
}

async function saveBackupFile(reason) {
  if (backupWriteInProgress) {
    pendingBackupWrite = true;
    return;
  }
  backupWriteInProgress = true;
  try {
    const store = await new Promise(resolve => getStore(resolve));
    await writeStoreToBackupFile(store, reason || 'Saved to connected JSON file');
  } catch (err) {
    setBackupStatus({ ok: false, dirty: true, at: Date.now(), error: err && err.message ? err.message : String(err) });
  } finally {
    backupWriteInProgress = false;
    if (pendingBackupWrite) {
      pendingBackupWrite = false;
      scheduleBackupFileWrite('Auto-saved queued bookmark change');
    }
  }
}

function isPickerCancelError(err) {
  if (!err) return false;
  const msg = String(err && err.message ? err.message : err).toLowerCase();
  return err.name === 'AbortError' || msg.includes('aborted') || msg.includes('cancel');
}

function toggleJsonConnectChooser(forceOpen) {
  const chooser = document.getElementById('jsonConnectChooser');
  if (!chooser) return;
  const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : chooser.hidden;
  chooser.hidden = !shouldOpen;
}

function connectBackupFile() {
  const supportsOpen = 'showOpenFilePicker' in window;
  const supportsSave = 'showSaveFilePicker' in window;
  if (!supportsOpen && !supportsSave) {
    alert('Direct JSON file access is not available in this Chrome/extension context.');
    return;
  }
  toggleJsonConnectChooser();
}

async function openExistingBackupFile() {
  if (!('showOpenFilePicker' in window)) {
    alert('Opening an existing connected JSON file is not available in this Chrome/extension context.');
    return;
  }
  try {
    const picked = await window.showOpenFilePicker({
      multiple: false,
      types: [{ description: 'JSON backup file', accept: { 'application/json': ['.json'] } }]
    });
    const handle = picked && picked[0];
    if (!handle) return;
    await setBackupHandle(handle);
    const ok = await ensureBackupPermission(handle, 'readwrite');
    if (!ok) throw new Error('Permission denied for selected JSON file');
    const file = await handle.getFile();
    const text = (await file.text()).trim();
    if (text) {
      const incomingStore = parseBackupPayload(text);
      const bookmarkCount = countBookmarksInStore(incomingStore);
      setStore(incomingStore, () => {
        setBackupStatus({ ok: true, dirty: false, at: Date.now(), filename: handle.name || 'bookmarks-backup.json', reason: `Connected and loaded ${bookmarkCount} bookmark${bookmarkCount === 1 ? '' : 's'} from JSON`, bookmarkCount });
        toggleJsonConnectChooser(false);
        render();
      });
    } else {
      await saveBackupFile('Connected empty JSON file and saved current bookmarks');
      toggleJsonConnectChooser(false);
    }
  } catch (err) {
    if (isPickerCancelError(err)) return;
    alert(`Could not connect JSON file: ${err && err.message ? err.message : String(err)}`);
  }
}

async function createNewBackupFile() {
  if (!('showSaveFilePicker' in window)) {
    alert('Creating a new connected JSON file is not available in this Chrome/extension context.');
    return;
  }
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: 'chat-section-bookmarks.json',
      types: [{ description: 'JSON backup file', accept: { 'application/json': ['.json'] } }]
    });
    if (!handle) return;
    await setBackupHandle(handle);
    const ok = await ensureBackupPermission(handle, 'readwrite');
    if (!ok) throw new Error('Permission denied for selected JSON file');
    await saveBackupFile('Connected JSON file and saved current bookmarks');
    toggleJsonConnectChooser(false);
  } catch (err) {
    if (isPickerCancelError(err)) return;
    alert(`Could not create JSON file: ${err && err.message ? err.message : String(err)}`);
  }
}

async function loadBackupFile() {
  try {
    let handle = await getBackupHandle();
    if (!handle) {
      if (!('showOpenFilePicker' in window)) {
        alert('No connected JSON file found. Use Import copy to choose a JSON file.');
        return;
      }
      const picked = await window.showOpenFilePicker({
        multiple: false,
        types: [{ description: 'JSON backup file', accept: { 'application/json': ['.json'] } }]
      });
      handle = picked && picked[0];
      if (!handle) return;
      await setBackupHandle(handle);
    }
    const permitted = await ensureBackupPermission(handle, 'readwrite');
    if (!permitted) throw new Error('Permission denied for connected JSON file');
    const file = await handle.getFile();
    const text = await file.text();
    const incomingStore = parseBackupPayload(text);
    const groupCount = Object.keys(incomingStore.groups || {}).length;
    const bookmarkCount = countBookmarksInStore(incomingStore);
    const ok = confirm(`Load ${bookmarkCount} bookmark${bookmarkCount === 1 ? '' : 's'} across ${groupCount} chat group${groupCount === 1 ? '' : 's'} from ${handle.name || 'the connected JSON file'}? This will replace current bookmark storage.`);
    if (!ok) return;
    setStore(incomingStore, () => {
      setBackupStatus({ ok: true, dirty: false, at: Date.now(), filename: handle.name || 'bookmarks-backup.json', reason: 'Loaded from connected JSON file', bookmarkCount });
      render();
    });
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    alert(`Could not load JSON file: ${err && err.message ? err.message : String(err)}`);
  }
}

function updateBackupStatus() {
  const el = document.getElementById('backupStatus');
  if (!el) return;
  chrome.storage.local.get({ [BACKUP_STATUS_KEY]: null }, data => {
    const status = data[BACKUP_STATUS_KEY];
    getBackupHandle().then(handle => {
      if (!handle) {
        el.textContent = 'No backup JSON file connected. Click Connect JSON file.';
        return;
      }
      if (!status) {
        el.textContent = `Connected: ${handle.name || 'backup JSON file'}.`;
        return;
      }
      const when = status.at ? formatDateTime(status.at) : 'unknown time';
      if (status.ok === true && !status.dirty) el.textContent = `Saved ${when}: ${status.filename || handle.name || 'backup JSON file'}`;
      else if (status.dirty) el.textContent = `Pending sync to ${handle.name || 'backup JSON file'} (${status.reason || 'storage changed'}). Open popup or click Save now.`;
      else el.textContent = `Backup file issue ${when}: ${status.error || 'unknown error'}`;
    }).catch(() => {
      el.textContent = 'No backup JSON file connected. Click Connect JSON file.';
    });
  });
}

function exportJson() {
  getStore(store => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadJson(`chat-section-bookmarks-${stamp}.json`, buildBackupPayload(store));
  });
}

function importJsonFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const incomingStore = parseBackupPayload(String(reader.result || ''));
      const groupCount = Object.keys(incomingStore.groups || {}).length;
      const bookmarkCount = countBookmarksInStore(incomingStore);
      const ok = confirm(`Import ${bookmarkCount} bookmark${bookmarkCount === 1 ? '' : 's'} across ${groupCount} chat group${groupCount === 1 ? '' : 's'}? This will replace current bookmark storage.`);
      if (!ok) return;
      setStore(incomingStore, () => {
        scheduleBackupFileWrite('Imported JSON copy');
        render();
      });
    } catch (err) {
      alert(`Could not import JSON: ${err && err.message ? err.message : String(err)}`);
    }
  };
  reader.onerror = () => alert('Could not read the selected JSON file.');
  reader.readAsText(file);
}



function applyEnvironmentVisibility() {
  document.querySelectorAll('.dev-only').forEach(el => {
    el.classList.toggle('dev-visible', IS_DEV);
  });
}

function updateSyncStatus() {
  const el = document.getElementById('syncStatus');
  const toggleBtn = document.getElementById('toggleGoogleSync');
  if (!el && !toggleBtn) return;
  chrome.storage.local.get({ [SYNC_ENABLED_KEY]: false, [SYNC_STATUS_KEY]: null }, data => {
    const enabled = !!data[SYNC_ENABLED_KEY];
    const status = data[SYNC_STATUS_KEY];
    if (toggleBtn) toggleBtn.textContent = enabled ? 'Chrome Sync On' : 'Enable Chrome Sync';
    if (!el) return;
    if (!enabled) {
      el.textContent = 'Chrome Sync is off.';
      return;
    }
    if (!status) {
      el.textContent = 'Chrome Sync is on. Changes auto-sync. Use ↻ to refresh manually.';
      return;
    }
    const when = status.at ? formatDateTime(status.at) : 'unknown time';
    if (status.ok) el.textContent = `Synced ${status.bookmarkCount || 0} bookmark${status.bookmarkCount === 1 ? '' : 's'} ${when}.`;
    else el.textContent = `Chrome Sync issue ${when}: ${status.error || 'unknown error'}`;
  });
}

function sendBackgroundMessage(message, cb) {
  chrome.runtime.sendMessage(message, response => {
    const err = chrome.runtime.lastError;
    if (err) {
      alert(err.message || String(err));
      if (cb) cb({ ok: false, error: err.message });
      return;
    }
    if (cb) cb(response || {});
  });
}


function formatSyncDiagnostics(data) {
  const lines = [];
  lines.push('=== Chat Section Bookmarker Chrome Sync Diagnostics ===');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Extension ID: ${data && data.extensionId ? data.extensionId : 'unknown'}`);
  lines.push(`Sync enabled locally: ${data && data.syncEnabled ? 'yes' : 'no'}`);
  lines.push(`Local groups: ${data && Number.isFinite(data.localGroupCount) ? data.localGroupCount : 'unknown'}`);
  lines.push(`Local bookmarks: ${data && Number.isFinite(data.localBookmarkCount) ? data.localBookmarkCount : 'unknown'}`);
  lines.push(`Local store size chars: ${data && Number.isFinite(data.localStoreChars) ? data.localStoreChars : 'unknown'}`);
  lines.push('');
  lines.push('--- Last Sync Status ---');
  lines.push(JSON.stringify(data && data.syncStatus ? data.syncStatus : null, null, 2));
  lines.push('');
  lines.push('--- Chrome Sync Meta ---');
  lines.push(JSON.stringify(data && data.syncMeta ? data.syncMeta : null, null, 2));
  lines.push('');
  lines.push(`Sync chunk lengths: ${data && data.syncChunkLengths ? data.syncChunkLengths.join(', ') : ''}`);
  lines.push(`Missing chunks: ${data && data.missingChunks && data.missingChunks.length ? data.missingChunks.join(', ') : 'none'}`);
  lines.push('');
  lines.push('--- Chrome Bookmarks Sync Fallback ---');
  lines.push(JSON.stringify(data && data.bookmarkSync ? data.bookmarkSync : null, null, 2));
  lines.push('');
  lines.push('--- Recent Sync Log ---');
  const logs = data && Array.isArray(data.debugLog) ? data.debugLog : [];
  if (!logs.length) lines.push('(no debug log entries yet)');
  logs.slice(0, 80).forEach((entry, i) => {
    lines.push(`${i + 1}. ${entry.iso || new Date(entry.at || Date.now()).toISOString()} | ${entry.event || 'event'} | ext=${entry.extensionId || 'unknown'}`);
    if (entry.details) lines.push(JSON.stringify(entry.details, null, 2));
  });
  return lines.join('\n');
}

function showSyncDiagnostics(copyAfter) {
  sendBackgroundMessage({ type: 'GET_SYNC_DEBUG' }, response => {
    const out = document.getElementById('syncDebugOutput');
    const text = response && response.ok === false
      ? `Could not read diagnostics: ${response.error || 'unknown error'}\nExtension ID: ${response.extensionId || 'unknown'}`
      : formatSyncDiagnostics(response || {});
    if (out) {
      out.textContent = text;
      out.classList.add('visible');
    }
    if (copyAfter && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => alert('Diagnostics copied.')).catch(() => alert('Diagnostics shown, but clipboard copy failed.'));
    }
  });
}

function clearSyncDiagnostics() {
  sendBackgroundMessage({ type: 'CLEAR_SYNC_DEBUG' }, response => {
    if (response && response.ok === false) alert(response.error || 'Could not clear logs.');
    showSyncDiagnostics(false);
  });
}

function bindSyncDiagnosticsControls() {
  const showBtn = document.getElementById('showSyncDiagnostics');
  const copyBtn = document.getElementById('copySyncDiagnostics');
  const clearBtn = document.getElementById('clearSyncDiagnostics');
  if (showBtn && !showBtn.dataset.bound) {
    showBtn.dataset.bound = '1';
    showBtn.addEventListener('click', () => showSyncDiagnostics(false));
  }
  if (copyBtn && !copyBtn.dataset.bound) {
    copyBtn.dataset.bound = '1';
    copyBtn.addEventListener('click', () => showSyncDiagnostics(true));
  }
  if (clearBtn && !clearBtn.dataset.bound) {
    clearBtn.dataset.bound = '1';
    clearBtn.addEventListener('click', clearSyncDiagnostics);
  }
}

function toggleGoogleSync() {
  chrome.storage.local.get({ [SYNC_ENABLED_KEY]: false }, data => {
    const next = !data[SYNC_ENABLED_KEY];
    sendBackgroundMessage({ type: 'SET_GOOGLE_SYNC_ENABLED', enabled: next }, response => {
      if (response && response.ok === false) alert(response.error || 'Could not update Chrome Sync.');
      updateSyncStatus();
    });
  });
}

function syncNow() {
  sendBackgroundMessage({ type: 'SYNC_BOOKMARKS_NOW' }, response => {
    if (response && response.ok === false) alert(response.error || 'Could not sync bookmarks.');
    updateSyncStatus();
  });
}

function loadFromGoogleSync() {
  const ok = confirm('Load bookmarks from Chrome Sync? This will replace the current local bookmark storage on this Chrome profile.');
  if (!ok) return;
  sendBackgroundMessage({ type: 'LOAD_BOOKMARKS_FROM_SYNC' }, response => {
    if (!response || response.ok === false) {
      alert((response && response.error) || 'Could not load from Chrome Sync.');
      updateSyncStatus();
      return;
    }
    updateSyncStatus();
    render();
  });
}

function autoRefreshFromGoogleSync() {
  chrome.runtime.sendMessage({ type: 'AUTO_SYNC_REFRESH', reason: 'Popup opened / periodic refresh' }, response => {
    void chrome.runtime.lastError;
    updateSyncStatus();
    if (response && response.ok) render();
  });
}

function bindSyncControls() {
  const toggleBtn = document.getElementById('toggleGoogleSync');
  const syncNowBtn = document.getElementById('syncNow');
  if (toggleBtn && !toggleBtn.dataset.bound) {
    toggleBtn.dataset.bound = '1';
    toggleBtn.addEventListener('click', toggleGoogleSync);
  }
  if (syncNowBtn && !syncNowBtn.dataset.bound) {
    syncNowBtn.dataset.bound = '1';
    syncNowBtn.addEventListener('click', syncNow);
  }
  updateSyncStatus();
}

function bindBackupControls() {
  const connectBtn = document.getElementById('connectBackupFile');
  const saveBtn = document.getElementById('saveBackupFile');
  const openExistingBtn = document.getElementById('openExistingBackupFile');
  const createNewBtn = document.getElementById('createNewBackupFile');
  const loadBtn = document.getElementById('loadBackupFile');
  const exportBtn = document.getElementById('exportJson');
  const importBtn = document.getElementById('importJson');
  const fileInput = document.getElementById('importJsonFile');

  if (connectBtn && !connectBtn.dataset.bound) {
    connectBtn.dataset.bound = '1';
    connectBtn.addEventListener('click', connectBackupFile);
  }
  if (openExistingBtn && !openExistingBtn.dataset.bound) {
    openExistingBtn.dataset.bound = '1';
    openExistingBtn.addEventListener('click', openExistingBackupFile);
  }
  if (createNewBtn && !createNewBtn.dataset.bound) {
    createNewBtn.dataset.bound = '1';
    createNewBtn.addEventListener('click', createNewBackupFile);
  }
  if (saveBtn && !saveBtn.dataset.bound) {
    saveBtn.dataset.bound = '1';
    saveBtn.addEventListener('click', () => saveBackupFile('Manual save'));
  }
  if (exportBtn && !exportBtn.dataset.bound) {
    exportBtn.dataset.bound = '1';
    exportBtn.addEventListener('click', exportJson);
  }
  if (importBtn && fileInput && !importBtn.dataset.bound) {
    importBtn.dataset.bound = '1';
    importBtn.addEventListener('click', () => fileInput.click());
  }
  if (fileInput && !fileInput.dataset.bound) {
    fileInput.dataset.bound = '1';
    fileInput.addEventListener('change', e => {
      const file = e.currentTarget.files && e.currentTarget.files[0];
      importJsonFile(file);
      e.currentTarget.value = '';
    });
  }
  updateBackupStatus();
}

function maybeSyncDirtyBackupOnOpen() {
  chrome.storage.local.get({ [BACKUP_STATUS_KEY]: null }, data => {
    const status = data[BACKUP_STATUS_KEY];
    if (status && status.dirty) scheduleBackupFileWrite('Synced pending changes after popup opened');
  });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes[STORAGE_KEY]) scheduleBackupFileWrite('Auto-saved bookmark change');
  if (changes[BACKUP_STATUS_KEY]) updateBackupStatus();
  if (changes[SYNC_ENABLED_KEY] || changes[SYNC_STATUS_KEY]) updateSyncStatus();
});

function getStore(cb) {
  chrome.storage.local.get({ [STORAGE_KEY]: { groups: {}, version: 3 } }, data => cb(data[STORAGE_KEY] || { groups: {}, version: 3 }));
}
function setStore(store, cb) {
  const normalized = normalizeStoreForBackup(store);
  chrome.storage.local.set({ [STORAGE_KEY]: normalized }, cb || (() => {}));
}

function getUiState() { try { return JSON.parse(localStorage.getItem(UI_STATE_KEY) || '{}'); } catch (_) { return {}; } }
function setUiState(state) { localStorage.setItem(UI_STATE_KEY, JSON.stringify(state || {})); }
function isCollapsed(key) { return getUiState()[key] === true; }
function toggleCollapsed(key) { const state = getUiState(); state[key] = !state[key]; setUiState(state); render(); }
function getProviderFilter() { return localStorage.getItem(PROVIDER_FILTER_KEY) || 'all'; }
function setProviderFilter(provider) { localStorage.setItem(PROVIDER_FILTER_KEY, provider); render(); }
function getSortMode() { return localStorage.getItem(SORT_MODE_KEY) || 'newest'; }
function setSortMode(mode) { localStorage.setItem(SORT_MODE_KEY, mode || 'newest'); render(); }
function getSearchTerm() { return localStorage.getItem(SEARCH_TERM_KEY) || ''; }
function setSearchTerm(term) { localStorage.setItem(SEARCH_TERM_KEY, term || ''); render(); }

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function getCurrentTab(cb) { chrome.tabs.query({ active: true, currentWindow: true }, tabs => cb(tabs && tabs[0])); }
function providerLabel(provider) { return provider === 'claude' ? 'Claude' : provider === 'chatgpt' ? 'ChatGPT' : 'Other'; }

function renderTabs(active) {
  const tabs = document.getElementById('providerTabs');
  if (!tabs) return;
  tabs.innerHTML = ['all', 'chatgpt', 'claude'].map(p => `<button class="provider-tab ${active === p ? 'active' : ''}" data-provider="${p}">${p === 'all' ? 'All' : providerLabel(p)}</button>`).join('');
  tabs.querySelectorAll('.provider-tab').forEach(btn => btn.addEventListener('click', e => setProviderFilter(e.currentTarget.dataset.provider)));
}

function renderControls() {
  const search = document.getElementById('bookmarkSearch');
  const sort = document.getElementById('bookmarkSort');
  const clear = document.getElementById('clearSearch');
  if (search && search.value !== getSearchTerm()) search.value = getSearchTerm();
  if (sort && sort.value !== getSortMode()) sort.value = getSortMode();
  if (search && !search.dataset.bound) {
    search.dataset.bound = '1';
    search.addEventListener('input', e => setSearchTerm(e.currentTarget.value || ''));
  }
  if (sort && !sort.dataset.bound) {
    sort.dataset.bound = '1';
    sort.addEventListener('change', e => setSortMode(e.currentTarget.value || 'newest'));
  }
  if (clear && !clear.dataset.bound) {
    clear.dataset.bound = '1';
    clear.addEventListener('click', () => setSearchTerm(''));
  }
  bindBackupControls();
  bindSyncControls();
  bindSyncDiagnosticsControls();
}

function formatDateTime(ts) {
  if (!ts) return 'Date unknown';
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return 'Date unknown';
  try {
    return date.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit'
    });
  } catch (_) {
    return date.toLocaleString();
  }
}

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function searchTokens(query) {
  return normalizeSearchText(query)
    .split(/[^a-z0-9]+/i)
    .map(t => t.trim())
    .filter(Boolean);
}

function fuzzyTokenMatch(text, token) {
  const haystack = normalizeSearchText(text);
  const needle = normalizeSearchText(token);
  if (!needle) return true;
  if (!haystack) return false;
  if (haystack.includes(needle)) return true;

  // Avoid overly broad fuzzy matches for 1-2 character searches.
  if (needle.length < 3) return false;

  let h = 0;
  let first = -1;
  let last = -1;
  for (let n = 0; n < needle.length; n++) {
    const idx = haystack.indexOf(needle[n], h);
    if (idx === -1) return false;
    if (first === -1) first = idx;
    last = idx;
    h = idx + 1;
  }

  // Keep fuzzy matching useful but not so loose that every URL/snippet matches.
  const span = last - first + 1;
  return span <= Math.max(needle.length * 4, needle.length + 8);
}

function fuzzyMatch(text, query) {
  const tokens = searchTokens(query);
  if (!tokens.length) return true;
  return tokens.every(token => fuzzyTokenMatch(text, token));
}

function bookmarkSearchFields(group, bookmark) {
  const meta = group._meta || effectiveMeta(group);
  const provider = providerLabel(meta.provider);
  const project = meta.projectDisplayName;
  const chat = group.chatNameOverride || group.chatName || group.chatNameDetected;
  const label = bookmark.label || bookmark.title || bookmark.snippet;
  const snippet = bookmark.snippet;
  const when = formatDateTime(bookmark.createdAt);
  const rawUrl = bookmark.url || group.url || '';
  const urlHostAndPath = rawUrl.replace(/^https?:\/\//, '');
  return [provider, project, chat, label, snippet, when, urlHostAndPath].filter(Boolean);
}

function bookmarkMatchesSearch(group, bookmark, query) {
  const tokens = searchTokens(query);
  if (!tokens.length) return true;
  const fields = bookmarkSearchFields(group, bookmark);
  return tokens.every(token => fields.some(field => fuzzyTokenMatch(field, token)));
}

function bookmarkTextForSearch(group, bookmark) {
  return bookmarkSearchFields(group, bookmark).join(' ');
}

function filterGroupBookmarks(group, query) {
  const tokens = searchTokens(query);
  if (!tokens.length) return group;
  const bookmarks = (group.bookmarks || []).filter(b => bookmarkMatchesSearch(group, b, query));
  return { ...group, bookmarks };
}

function bookmarkLabel(b) {
  return limitBookmarkText(b.label || b.title || b.snippet || 'Bookmarked section', BOOKMARK_TEXT_MAX);
}
function newestTimestamp(items) { return Math.max(...items.map(x => x.createdAt || 0), 0); }
function oldestTimestamp(items) { return Math.min(...items.map(x => x.createdAt || Date.now()), Date.now()); }
function sortBookmarks(bookmarks, mode) {
  const list = [...(bookmarks || [])];
  if (mode === 'oldest') return list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  if (mode === 'title-az') return list.sort((a, b) => bookmarkLabel(a).localeCompare(bookmarkLabel(b)));
  if (mode === 'title-za') return list.sort((a, b) => bookmarkLabel(b).localeCompare(bookmarkLabel(a)));
  return list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}
function sortChats(chats, mode) {
  const list = [...chats];
  if (mode === 'oldest') return list.sort((a, b) => oldestTimestamp(a.bookmarks || []) - oldestTimestamp(b.bookmarks || []));
  if (mode === 'title-az') return list.sort((a, b) => String(a.chatName || a.chatNameDetected || '').localeCompare(String(b.chatName || b.chatNameDetected || '')));
  if (mode === 'title-za') return list.sort((a, b) => String(b.chatName || b.chatNameDetected || '').localeCompare(String(a.chatName || a.chatNameDetected || '')));
  return list.sort((a, b) => newestTimestamp(b.bookmarks || []) - newestTimestamp(a.bookmarks || []));
}
function sortProjects(projects, mode) {
  const list = [...projects];
  const projectTimes = p => Array.from(p.chatsByKey.values()).flatMap(c => c.bookmarks || []);
  if (mode === 'oldest') return list.sort((a, b) => oldestTimestamp(projectTimes(a)) - oldestTimestamp(projectTimes(b)));
  if (mode === 'title-az') return list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  if (mode === 'title-za') return list.sort((a, b) => String(b.name || '').localeCompare(String(a.name || '')));
  return list.sort((a, b) => newestTimestamp(projectTimes(b)) - newestTimestamp(projectTimes(a)));
}

function render() {
  const activeProvider = getProviderFilter();
  const sortMode = getSortMode();
  const searchTerm = getSearchTerm();
  renderTabs(activeProvider);
  renderControls();
  getStore(store => {
    const list = document.getElementById('list');
    let groups = Object.values(store.groups || {}).filter(g => g.bookmarks && g.bookmarks.length);
    groups.forEach(g => { g._meta = effectiveMeta(g); });
    if (activeProvider !== 'all') groups = groups.filter(g => g._meta.provider === activeProvider);
    groups = groups.map(g => filterGroupBookmarks(g, searchTerm)).filter(g => g.bookmarks && g.bookmarks.length);

    if (!groups.length) {
      const providerText = activeProvider === 'all' ? '' : providerLabel(activeProvider) + ' ';
      list.innerHTML = `<div class="empty">No ${providerText}bookmarks${searchTerm ? ' match your search.' : ' yet.'}</div>`;
      return;
    }

    const projectBuckets = new Map();
    const normalChats = [];
    for (const g of groups) {
      const meta = g._meta || effectiveMeta(g);
      const gBookmarks = sortBookmarks(g.bookmarks || [], sortMode);
      if (meta.isProjectChat && meta.projectKey) {
        const bucketKey = `${meta.provider}:${meta.projectKey}`;
        if (!projectBuckets.has(bucketKey)) {
          projectBuckets.set(bucketKey, { key: bucketKey, provider: meta.provider, projectKey: meta.projectKey, name: meta.projectDisplayName, chatsByKey: new Map() });
        }
        const bucket = projectBuckets.get(bucketKey);
        if (meta.projectDisplayName) bucket.name = meta.projectDisplayName;
        const chatBucketKey = meta.chatKey || g.chatKey || g.url;
        if (!bucket.chatsByKey.has(chatBucketKey)) bucket.chatsByKey.set(chatBucketKey, { ...g, chatKey: chatBucketKey, bookmarks: [] });
        const chat = bucket.chatsByKey.get(chatBucketKey);
        chat.provider = meta.provider;
        chat.chatName = g.chatNameOverride || chat.chatName || g.chatName || g.chatNameDetected || 'Untitled Chat';
        chat.url = chat.url || g.url;
        chat.bookmarks.push(...gBookmarks);
      } else {
        normalChats.push({ ...g, bookmarks: gBookmarks });
      }
    }

    const html = [];
    const projectList = sortProjects(Array.from(projectBuckets.values()), sortMode);

    for (const bucket of projectList) {
      const chats = sortChats(Array.from(bucket.chatsByKey.values()).filter(c => c.bookmarks && c.bookmarks.length), sortMode);
      const count = chats.reduce((n, c) => n + c.bookmarks.length, 0);
      const projectStateKey = `project:${bucket.key}`;
      const projectClosed = isCollapsed(projectStateKey);
      html.push(`<section class="group project provider-${escapeHtml(bucket.provider)}" data-project-key="${escapeHtml(bucket.projectKey)}">
        <div class="project-title header-row">
          <button class="toggle" data-collapse-key="${escapeHtml(projectStateKey)}" title="${projectClosed ? 'Expand' : 'Collapse'}">${projectClosed ? '▸' : '▾'}</button>
          <span class="title-text"><span class="provider-pill">${escapeHtml(providerLabel(bucket.provider))}</span> ${escapeHtml(bucket.name)} <span class="meta">${chats.length} chat${chats.length===1?'':'s'} • ${count} bookmark${count===1?'':'s'}</span></span>
          <button class="rename" data-type="project" data-key="${escapeHtml(bucket.projectKey)}" data-provider="${escapeHtml(bucket.provider)}" title="Rename project">✎</button>
        </div>`);
      if (!projectClosed) {
        for (const chat of chats) html.push(chatHtml(chat, true));
      }
      html.push('</section>');
    }

    for (const chat of sortChats(normalChats, sortMode)) html.push(`<section class="group normal provider-${escapeHtml((chat._meta || effectiveMeta(chat)).provider)}">${chatHtml(chat, false)}</section>`);
    list.innerHTML = html.join('');

    document.querySelectorAll('.bookmark').forEach(el => {
      el.addEventListener('click', e => {
        if (e.target.closest('.bookmark-rename') || e.target.closest('.bookmark-toggle')) return;
        openBookmark(el.dataset.url, el.dataset.targetKey, el.dataset.targetJson ? JSON.parse(el.dataset.targetJson) : null);
      });
    });
    document.querySelectorAll('.bookmark-toggle').forEach(btn => btn.addEventListener('click', onBookmarkToggle));
    document.querySelectorAll('.bookmark-rename').forEach(btn => btn.addEventListener('click', onBookmarkRename));
    document.querySelectorAll('.rename:not(.bookmark-rename)').forEach(btn => btn.addEventListener('click', onHeaderRename));
    document.querySelectorAll('.toggle').forEach(btn => btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); toggleCollapsed(e.currentTarget.dataset.collapseKey); }));
  });
}

function chatHtml(chat, nested) {
  const meta = chat._meta || effectiveMeta(chat);
  const count = chat.bookmarks.length;
  const chatKey = meta.chatKey || chat.chatKey || chat.url;
  const chatStateKey = `chat:${meta.provider}:${chatKey}`;
  const closed = isCollapsed(chatStateKey);
  const providerPrefix = nested ? '' : `<span class="provider-pill">${escapeHtml(providerLabel(meta.provider))}</span> `;
  return `<div class="chat ${nested ? 'nested-chat' : 'normal-chat'}" data-chat-key="${escapeHtml(chatKey)}">
    <div class="chat-title header-row">
      <button class="toggle" data-collapse-key="${escapeHtml(chatStateKey)}" title="${closed ? 'Expand' : 'Collapse'}">${closed ? '▸' : '▾'}</button>
      <span class="title-text">${providerPrefix}${escapeHtml(chat.chatName || chat.chatNameDetected || 'Untitled Chat')} <span class="meta">${count} bookmark${count===1?'':'s'}</span></span>
      <button class="rename" data-type="chat" data-key="${escapeHtml(chatKey)}" title="Rename chat">✎</button>
    </div>
    ${closed ? '' : chat.bookmarks.map((b, index) => `<div class="bookmark-row" data-bookmark-id="${escapeHtml(b.id || '')}" data-bookmark-index="${index}" data-chat-key="${escapeHtml(chatKey)}">
      <button class="bookmark-toggle" data-chat-key="${escapeHtml(chatKey)}" data-bookmark-id="${escapeHtml(b.id || '')}" data-bookmark-index="${index}" title="Remove bookmark">★</button>
      <div class="bookmark" data-url="${escapeHtml(b.url || chat.url)}" data-target-key="${escapeHtml(b.targetKey || '')}" data-target-json="${escapeHtml(JSON.stringify(b.target || null))}">
        <div class="snippet">${escapeHtml(bookmarkLabel(b))}</div>
        <div class="bookmark-time" title="${escapeHtml(b.createdAt ? new Date(b.createdAt).toISOString() : '')}">${escapeHtml(formatDateTime(b.createdAt))}</div>
        <div class="url">${escapeHtml((b.url || chat.url || '').replace(/^https?:\/\//,''))}</div>
      </div>
      <button class="rename bookmark-rename" data-type="bookmark" data-chat-key="${escapeHtml(chatKey)}" data-bookmark-id="${escapeHtml(b.id || '')}" data-bookmark-index="${index}" title="Rename bookmark">✎</button>
    </div>`).join('')}
  </div>`;
}

function findMatchingGroups(store, chatKey) {
  return Object.values(store.groups || {}).filter(g => {
    const m = effectiveMeta(g);
    return m.chatKey === chatKey || g.chatKey === chatKey || g.url === chatKey || normalizeUrl(g.url || '') === normalizeUrl(chatKey);
  });
}

function onHeaderRename(e) {
  e.preventDefault();
  e.stopPropagation();
  const target = e.currentTarget;
  const type = target.dataset.type || '';
  const key = target.dataset.key || '';
  const provider = target.dataset.provider || '';
  getStore(store => {
    if (type === 'chat') {
      const currentGroup = store.groups[key] || Object.values(store.groups || {}).find(g => effectiveMeta(g).chatKey === key || g.chatKey === key || g.url === key);
      if (!currentGroup) return;
      const currentName = currentGroup.chatNameOverride || currentGroup.chatName || currentGroup.chatNameDetected || '';
      const name = prompt('Rename chat', currentName);
      if (name && name.trim()) {
        findMatchingGroups(store, key).forEach(g => { g.chatName = name.trim(); g.chatNameOverride = name.trim(); });
        setStore(store, render);
      }
    } else if (type === 'project') {
      const chats = Object.values(store.groups || {}).filter(g => {
        const m = effectiveMeta(g);
        return m.projectKey === key && m.isProjectChat && (!provider || m.provider === provider);
      });
      const current = chats[0] ? effectiveMeta(chats[0]).projectDisplayName : '';
      const name = prompt('Rename project', current);
      if (name && name.trim()) {
        chats.forEach(g => { g.projectName = name.trim(); g.projectNameOverride = name.trim(); g.updatedAt = Date.now(); g.lastChangedAt = g.updatedAt; });
        setStore(store, render);
      }
    }
  });
}

function onBookmarkToggle(e) {
  e.preventDefault();
  e.stopPropagation();
  if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
  const target = e.currentTarget;
  const chatKey = target.dataset.chatKey || '';
  const bookmarkId = target.dataset.bookmarkId || '';
  const bookmarkIndex = Number(target.dataset.bookmarkIndex);

  getStore(store => {
    const matchingGroups = findMatchingGroups(store, chatKey);
    let changed = false;
    let removedTargetKey = '';
    matchingGroups.forEach(g => {
      const bookmarks = Array.isArray(g.bookmarks) ? g.bookmarks : [];
      const idx = bookmarks.findIndex((b, i) =>
        (bookmarkId && b.id === bookmarkId) || (!bookmarkId && Number.isInteger(bookmarkIndex) && i === bookmarkIndex)
      );
      if (idx >= 0) {
        const removedBookmark = bookmarks[idx];
        removedTargetKey = removedBookmark.targetKey || removedTargetKey;
        rememberDeletedBookmark(g, removedBookmark);
        bookmarks.splice(idx, 1);
        g.bookmarks = bookmarks;
        changed = true;
      }
    });

    if (!changed) return;
    Object.keys(store.groups || {}).forEach(key => {
      const g = store.groups[key];
      if (!g || (!Array.isArray(g.bookmarks) || g.bookmarks.length === 0) && !hasDeletedBookmarks(g)) delete store.groups[key];
    });
    setStore(store, () => {
      getCurrentTab(tab => {
        if (tab && tab.id) chrome.tabs.sendMessage(tab.id, { type: 'REFRESH_BOOKMARK_STATES', targetKey: removedTargetKey }, () => { void chrome.runtime.lastError; });
      });
      render();
    });
  });
}

function onBookmarkRename(e) {
  e.preventDefault();
  e.stopPropagation();
  if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
  const target = e.currentTarget;
  const chatKey = target.dataset.chatKey || '';
  const bookmarkId = target.dataset.bookmarkId || '';
  const bookmarkIndex = Number(target.dataset.bookmarkIndex);

  getStore(store => {
    const matchingGroups = findMatchingGroups(store, chatKey);
    let currentBookmark = null;
    matchingGroups.forEach(g => (g.bookmarks || []).forEach((b, i) => {
      if ((bookmarkId && b.id === bookmarkId) || (!bookmarkId && Number.isInteger(bookmarkIndex) && i === bookmarkIndex)) currentBookmark = b;
    }));
    if (!currentBookmark) {
      alert('Could not find that bookmark to rename. Try re-saving it, then rename again.');
      return;
    }
    const currentName = currentBookmark.label || currentBookmark.title || currentBookmark.snippet || 'Bookmarked section';
    const name = prompt('Rename bookmark', currentName);
    if (name && name.trim()) {
      matchingGroups.forEach(g => (g.bookmarks || []).forEach((b, i) => {
        if ((bookmarkId && b.id === bookmarkId) || (!bookmarkId && Number.isInteger(bookmarkIndex) && i === bookmarkIndex)) {
          const limitedName = limitBookmarkText(name, BOOKMARK_TEXT_MAX);
          b.label = limitedName;
          b.title = limitedName;
          b.updatedAt = Date.now();
        }
      }));
      setStore(store, render);
    }
  });
}

function openBookmark(url, targetKey, target) {
  getCurrentTab(tab => {
    const current = normalizeUrl(tab && tab.url);
    const targetUrl = normalizeUrl(url);
    if (current === targetUrl && tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'JUMP_TO_BOOKMARK', targetKey, target }, () => { void chrome.runtime.lastError; window.close(); });
    } else {
      chrome.storage.local.set({ [PENDING_KEY]: { url: targetUrl, targetKey, target, createdAt: Date.now() } }, () => chrome.tabs.create({ url: targetUrl, active: true }, () => window.close()));
    }
  });
}

function normalizeThemeMode(mode) {
  return mode === 'light' ? 'light' : 'dark';
}

function getThemeMode(callback) {
  chrome.storage.local.get({ [THEME_KEY]: 'dark' }, data => {
    callback(normalizeThemeMode(data[THEME_KEY]));
  });
}

function saveThemeMode(mode, callback) {
  const theme = normalizeThemeMode(mode);
  chrome.storage.local.set({ [THEME_KEY]: theme }, () => {
    if (typeof callback === 'function') callback(theme);
  });
}

function applyThemeMode(mode) {
  const theme = normalizeThemeMode(mode);
  document.body.classList.toggle('dark-theme', theme === 'dark');
  document.documentElement.classList.toggle('dark-theme', theme === 'dark');
  const btn = document.getElementById('themeToggle');
  if (btn) {
    btn.textContent = theme === 'dark' ? '☀️' : '🌙';
    btn.title = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
    btn.dataset.themeMode = theme;
  }
}

function applySavedThemeMode() {
  getThemeMode(applyThemeMode);
}

function toggleThemeMode() {
  getThemeMode(current => {
    const next = current === 'dark' ? 'light' : 'dark';
    saveThemeMode(next, applyThemeMode);
  });
}
function isDrawerCollapsed() {
  return false;
}

function applyDrawerState() {
  document.body.classList.remove('drawer-collapsed');
}

function toggleDrawerState() {
  applyDrawerState();
}
function closeExtensionPanel() {
  try { window.close(); } catch (_) {}
}
function bindPanelChromeControls() {
  const themeBtn = document.getElementById('themeToggle');
  const closeBtn = document.getElementById('closePanel');
  applyDrawerState();
  if (themeBtn && !themeBtn.dataset.bound) {
    themeBtn.dataset.bound = '1';
    themeBtn.addEventListener('click', toggleThemeMode);
  }
  applySavedThemeMode();
  if (closeBtn && !closeBtn.dataset.bound) {
    closeBtn.dataset.bound = '1';
    closeBtn.addEventListener('click', closeExtensionPanel);
  }
}
bindPanelChromeControls();
applyEnvironmentVisibility();
maybeSyncDirtyBackupOnOpen();
autoRefreshFromGoogleSync();
setInterval(autoRefreshFromGoogleSync, 60000);
render();

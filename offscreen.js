const STORAGE_KEY = 'chatSectionBookmarksV2';
const BACKUP_DB_NAME = 'chat-section-bookmarker-backup-db';
const BACKUP_DB_STORE = 'handles';
const BACKUP_HANDLE_ID = 'backup-json-file';

function normalizeStoreForBackup(store) {
  if (!store || typeof store !== 'object') return { groups: {}, version: 3 };
  return {
    ...store,
    version: store.version || 3,
    groups: store.groups && typeof store.groups === 'object' ? store.groups : {}
  };
}

function countBookmarksInStore(store) {
  const normalized = normalizeStoreForBackup(store);
  return Object.values(normalized.groups || {}).reduce((n, g) => n + ((g && Array.isArray(g.bookmarks)) ? g.bookmarks.length : 0), 0);
}

function buildBackupPayload(store) {
  return {
    schema: 'chat-section-bookmarker-backup',
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    storageKey: STORAGE_KEY,
    data: normalizeStoreForBackup(store)
  };
}

function backupDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(BACKUP_DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(BACKUP_DB_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open backup database'));
  });
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

async function ensureBackupPermission(handle) {
  if (!handle) return false;
  const opts = { mode: 'readwrite' };
  if (typeof handle.queryPermission === 'function') {
    const existing = await handle.queryPermission(opts);
    if (existing === 'granted') return true;
  }
  // Offscreen documents cannot show a permission prompt. If permission is not
  // already granted, ask the user to reconnect/save from the popup.
  return false;
}

async function writeBackupFile(store, reason) {
  const normalizedStore = normalizeStoreForBackup(store);
  const handle = await getBackupHandle();

  if (!handle) {
    return {
      ok: false,
      error: 'No JSON backup file connected.',
      bookmarkCount: countBookmarksInStore(normalizedStore)
    };
  }

  const permitted = await ensureBackupPermission(handle);
  if (!permitted) {
    return {
      ok: false,
      error: 'Permission denied for the connected JSON file. Open popup and click Save now or reconnect the file.',
      filename: handle.name || 'chat-section-bookmarks.json',
      bookmarkCount: countBookmarksInStore(normalizedStore)
    };
  }

  if (typeof handle.createWritable !== 'function') {
    return {
      ok: false,
      error: 'Connected file handle cannot be written in this Chrome context. Open popup and click Save now.',
      filename: handle.name || 'chat-section-bookmarks.json',
      bookmarkCount: countBookmarksInStore(normalizedStore)
    };
  }

  const payload = buildBackupPayload(normalizedStore);
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(payload, null, 2));
  await writable.close();

  return {
    ok: true,
    filename: handle.name || 'chat-section-bookmarks.json',
    bookmarkCount: countBookmarksInStore(normalizedStore),
    reason: reason || 'Auto-saved to connected JSON file'
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'WRITE_BACKUP_FILE') return;

  writeBackupFile(message.store, message.reason || 'Auto-saved bookmark change')
    .then(sendResponse)
    .catch(err => {
      sendResponse({
        ok: false,
        error: err && err.message ? err.message : String(err),
        bookmarkCount: countBookmarksInStore(message.store)
      });
    });

  return true;
});

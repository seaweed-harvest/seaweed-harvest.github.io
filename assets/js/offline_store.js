const DATABASE_NAME = "seaweed-harvest-offline";
const DATABASE_VERSION = 1;
const OUTBOX_STORE = "collection-outbox";
const REFERENCE_STORE = "reference-data";
const SYNCED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SYNCED_HISTORY = 20;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BACKUP_PHOTO_BYTES = 700 * 1024;

let databasePromise = null;

export function offlineStorageSupported() {
  return "indexedDB" in window;
}

export async function initialiseOfflineStore() {
  const database = await openDatabase();
  await recoverInterruptedSyncs(database);
  await pruneSyncedHistory(database);
  return database;
}

export async function saveReferenceSnapshot(key, value) {
  const record = {
    key,
    value,
    savedAt: new Date().toISOString()
  };
  await putRecord(REFERENCE_STORE, record);
  return record;
}

export async function loadReferenceSnapshot(key) {
  return getRecord(REFERENCE_STORE, key);
}

export async function saveCollectionToOutbox(record) {
  const now = new Date().toISOString();
  const saved = {
    ...record,
    status: "pending",
    attempts: 0,
    lastError: null,
    result: null,
    createdAt: record.createdAt || now,
    updatedAt: now,
    syncedAt: null
  };
  await putRecord(OUTBOX_STORE, saved);
  return saved;
}

export async function getOutboxItem(submissionId) {
  return getRecord(OUTBOX_STORE, submissionId);
}

export async function listOutboxItems() {
  const items = await getAllRecords(OUTBOX_STORE);
  return items.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
}

export async function updateOutboxItem(submissionId, updates) {
  const current = await getOutboxItem(submissionId);
  if (!current) throw new Error("The saved collection could not be found on this phone.");
  const updated = {
    ...current,
    ...updates,
    submissionId,
    updatedAt: new Date().toISOString()
  };
  await putRecord(OUTBOX_STORE, updated);
  return updated;
}

export async function deleteOutboxItem(submissionId) {
  const current = await getOutboxItem(submissionId);
  if (!current) return false;
  if (current.status === "syncing") {
    throw new Error("Wait for syncing to finish before deleting this local record.");
  }
  await deleteRecord(OUTBOX_STORE, submissionId);
  return true;
}

export async function markOutboxSynced(submissionId, result) {
  const current = await getOutboxItem(submissionId);
  if (!current) throw new Error("The saved collection could not be found on this phone.");
  const now = new Date().toISOString();
  const synced = {
    ...current,
    status: "synced",
    lastError: null,
    result,
    syncedAt: now,
    updatedAt: now,
    photos: (current.photos || []).map(({ blob: _blob, ...photo }) => photo)
  };
  await putRecord(OUTBOX_STORE, synced);
  await pruneSyncedHistory();
  return synced;
}

export async function requestPersistentOfflineStorage() {
  if (!navigator.storage?.persist) return null;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function offlineStorageEstimate() {
  if (!navigator.storage?.estimate) return null;
  try {
    return await navigator.storage.estimate();
  } catch {
    return null;
  }
}

export async function createPendingBackup() {
  const items = (await listOutboxItems()).filter((item) => item.status !== "synced");
  const records = [];
  for (const item of items) {
    records.push({
      ...item,
      photos: await Promise.all((item.photos || []).map(async ({ blob, ...photo }) => ({
        ...photo,
        type: blob?.type || "image/jpeg",
        size: blob?.size || photo.size || 0,
        dataUrl: blob ? await blobToDataUrl(blob) : null
      })))
    });
  }
  return {
    format: "seaweed-harvest-offline-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    pendingCount: records.length,
    records
  };
}

export async function restorePendingBackup(backup) {
  if (backup?.format !== "seaweed-harvest-offline-backup" || backup?.version !== 1 || !Array.isArray(backup.records)) {
    throw new Error("This is not a valid Seaweed Harvest pending-record backup.");
  }

  const prepared = [];
  for (const record of backup.records) {
    if (!UUID_PATTERN.test(String(record?.submissionId || ""))
      || !record?.payload || typeof record.payload !== "object"
      || !String(record?.collectorName || "").trim()) {
      throw new Error("A pending record in the backup is incomplete.");
    }
    if (!Array.isArray(record.photos) || record.photos.length > 5) {
      throw new Error("A pending record contains an invalid photo list.");
    }
    const photos = [];
    for (const photo of record.photos) {
      const blob = photo.dataUrl ? dataUrlToBlob(photo.dataUrl) : null;
      if (!blob && !photo.uploadedPath) throw new Error("A pending photo is missing from the backup.");
      if (blob && (!blob.size || blob.size > MAX_BACKUP_PHOTO_BYTES || blob.type !== "image/jpeg")) {
        throw new Error("A pending photo in the backup is invalid or larger than 700 KB.");
      }
      const { dataUrl: _dataUrl, type: _type, ...photoData } = photo;
      photos.push({ ...photoData, blob });
    }
    prepared.push({ ...record, photos });
  }

  let imported = 0;
  let skipped = 0;
  for (const record of prepared) {
    if (await getOutboxItem(record.submissionId)) {
      skipped += 1;
      continue;
    }
    await saveCollectionToOutbox(record);
    imported += 1;
  }
  return { imported, skipped };
}

async function recoverInterruptedSyncs(database = null) {
  const items = await getAllRecords(OUTBOX_STORE, database);
  const interrupted = items.filter((item) => item.status === "syncing");
  await Promise.all(interrupted.map((item) => putRecord(OUTBOX_STORE, {
    ...item,
    status: "pending",
    lastError: "Sync was interrupted before confirmation. It will be tried again.",
    updatedAt: new Date().toISOString()
  }, database)));
}

async function pruneSyncedHistory(database = null) {
  const items = await getAllRecords(OUTBOX_STORE, database);
  const cutoff = Date.now() - SYNCED_RETENTION_MS;
  const synced = items
    .filter((item) => item.status === "synced")
    .sort((left, right) => String(right.syncedAt).localeCompare(String(left.syncedAt)));
  const expired = synced.filter((item, index) => (
    index >= MAX_SYNCED_HISTORY || new Date(item.syncedAt || item.updatedAt).getTime() < cutoff
  ));
  await Promise.all(expired.map((item) => deleteRecord(OUTBOX_STORE, item.submissionId, database)));
}

function openDatabase() {
  if (!offlineStorageSupported()) {
    return Promise.reject(new Error("Offline storage is not supported by this browser."));
  }
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(OUTBOX_STORE)) {
        const outbox = database.createObjectStore(OUTBOX_STORE, { keyPath: "submissionId" });
        outbox.createIndex("status", "status", { unique: false });
        outbox.createIndex("createdAt", "createdAt", { unique: false });
      }
      if (!database.objectStoreNames.contains(REFERENCE_STORE)) {
        database.createObjectStore(REFERENCE_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      databasePromise = null;
      reject(request.error || new Error("Offline storage could not be opened."));
    };
    request.onblocked = () => reject(new Error("Close other copies of the app and try again."));
  });
  return databasePromise;
}

async function getRecord(storeName, key, database = null) {
  const db = database || await openDatabase();
  return requestResult(db.transaction(storeName, "readonly").objectStore(storeName).get(key));
}

async function getAllRecords(storeName, database = null) {
  const db = database || await openDatabase();
  return requestResult(db.transaction(storeName, "readonly").objectStore(storeName).getAll());
}

async function putRecord(storeName, value, database = null) {
  const db = database || await openDatabase();
  return transactionResult(db, storeName, "readwrite", (store) => store.put(value));
}

async function deleteRecord(storeName, key, database = null) {
  const db = database || await openDatabase();
  return transactionResult(db, storeName, "readwrite", (store) => store.delete(key));
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Offline storage request failed."));
  });
}

function transactionResult(database, storeName, mode, action) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const request = action(transaction.objectStore(storeName));
    let result;
    request.onsuccess = () => { result = request.result; };
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error || request.error || new Error("Offline storage write failed."));
    transaction.onabort = () => reject(transaction.error || new Error("Offline storage write was cancelled."));
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("A photo could not be added to the backup."));
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl) {
  const match = String(dataUrl || "").match(/^data:(image\/jpeg);base64,([a-z0-9+/=]+)$/i);
  if (!match) throw new Error("A pending photo in the backup is not a JPEG image.");
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: match[1].toLowerCase() });
}

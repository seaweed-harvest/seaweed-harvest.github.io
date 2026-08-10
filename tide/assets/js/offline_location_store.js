const DB_NAME = "seaweed-tide-planner-offline";
const DB_VERSION = 1;
const LOCATION_STORE = "farmLocationBundles";

export function isOfflineStorageSupported() {
  return typeof window !== "undefined" && "indexedDB" in window;
}

export async function saveFarmLocationOfflineBundle(bundle) {
  validateBundle(bundle);
  const db = await openDb();
  const record = {
    ...bundle,
    schemaVersion: 1,
    savedAt: new Date().toISOString()
  };

  await runStoreRequest(db, LOCATION_STORE, "readwrite", (store) => store.put(record));
  return record;
}

export async function getFarmLocationOfflineBundle(locationKey) {
  if (!locationKey) return null;
  const db = await openDb();
  return runStoreRequest(db, LOCATION_STORE, "readonly", (store) => store.get(locationKey));
}

export async function listFarmLocationOfflineBundles() {
  const db = await openDb();
  return runStoreRequest(db, LOCATION_STORE, "readonly", (store) => store.getAll());
}

export async function removeFarmLocationOfflineBundle(locationKey) {
  if (!locationKey) return;
  const db = await openDb();
  await runStoreRequest(db, LOCATION_STORE, "readwrite", (store) => store.delete(locationKey));
}

function validateBundle(bundle) {
  if (!bundle || !bundle.locationKey) {
    throw new Error("Offline bundle requires a locationKey.");
  }
}

function openDb() {
  if (!isOfflineStorageSupported()) {
    return Promise.reject(new Error("IndexedDB is not available in this browser."));
  }

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LOCATION_STORE)) {
        db.createObjectStore(LOCATION_STORE, { keyPath: "locationKey" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function runStoreRequest(db, storeName, mode, createRequest) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const request = createRequest(store);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.onerror = () => reject(transaction.error);
    transaction.oncomplete = () => db.close();
  });
}

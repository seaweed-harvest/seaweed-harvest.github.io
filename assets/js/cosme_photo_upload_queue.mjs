// Persistent, per-account COSME photo queue. Images stay on this device until
// the server confirms they are saved. IndexedDB is used because localStorage
// cannot safely store large image blobs.
const DATABASE = "seaweed-cosme-photo-uploads";
const VERSION = 1;
const OPEN_TIMEOUT_MS = 10000;

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || Error("Local photo storage failed"));
  });
}
function database() {
  if (!("indexedDB" in globalThis)) return Promise.reject(Error("This device does not support saved uploads"));
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(DATABASE, VERSION);
    const timer = setTimeout(() => reject(Error("Local photo storage timed out")), OPEN_TIMEOUT_MS);
    opening.onupgradeneeded = () => {
      const db = opening.result;
      if (!db.objectStoreNames.contains("batches")) db.createObjectStore("batches", { keyPath: "id" });
      if (!db.objectStoreNames.contains("photos")) {
        const store = db.createObjectStore("photos", { keyPath: "key" });
        store.createIndex("batchId", "batchId", { unique: false });
      }
    };
    opening.onerror = () => { clearTimeout(timer); reject(opening.error || Error("Cannot open saved photo queue")); };
    opening.onsuccess = () => { clearTimeout(timer); resolve(opening.result); };
    opening.onblocked = () => { clearTimeout(timer); reject(Error("Close other Seaweed Harvest windows and retry")); };
  });
}
async function transact(storeName, mode, operation) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const result = operation(tx.objectStore(storeName));
      tx.oncomplete = () => resolve(result.value);
      tx.onerror = () => reject(tx.error || Error("Could not save photos on this device"));
      tx.onabort = () => reject(tx.error || Error("Photo storage was interrupted"));
    });
  } finally { db.close(); }
}
export async function putBatch(batch) {
  await transact("batches", "readwrite", store => {
    const result = { value: undefined };
    const r = store.put(batch);
    r.onsuccess = () => { result.value = r.result; };
    return result;
  });
}
export async function getBatch(id) {
  const db = await database();
  try { return await request(db.transaction("batches", "readonly").objectStore("batches").get(id)); }
  finally { db.close(); }
}
export async function getQueuedPhoto(key) {
  const db = await database();
  try { return await request(db.transaction("photos", "readonly").objectStore("photos").get(key)); }
  finally { db.close(); }
}
export async function putQueuedPhoto(photo) {
  await transact("photos", "readwrite", store => {
    const result = { value: undefined };
    const r = store.put(photo);
    r.onsuccess = () => { result.value = r.result; };
    return result;
  });
}
export async function listQueuedPhotos(batchId) {
  const db = await database();
  try {
    const store = db.transaction("photos", "readonly").objectStore("photos");
    return await request(store.index("batchId").getAll(batchId));
  } finally { db.close(); }
}
export async function listPendingBatches(owner) {
  const db = await database();
  try {
    const all = await request(db.transaction("batches", "readonly").objectStore("batches").getAll());
    return all.filter(batch => batch.owner === owner && batch.state !== "complete")
      .sort((a, b) => b.createdAt - a.createdAt);
  } finally { db.close(); }
}
export async function deleteBatch(id) {
  const photos = await listQueuedPhotos(id);
  const db = await database();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(["photos", "batches"], "readwrite");
      for (const photo of photos) tx.objectStore("photos").delete(photo.key);
      tx.objectStore("batches").delete(id);
      tx.oncomplete = resolve;
      tx.onabort = tx.onerror = () => reject(tx.error || Error("Cannot clear completed upload"));
    });
  } finally { db.close(); }
}
export function photoFingerprint(name, bytes) {
  return String(name || "").toLowerCase() + "|" + Number(bytes || 0);
}
export function selectNewPhotos(files, savedItems = []) {
  const alreadySaved = new Set(savedItems.map(item => {
    const m = item.photo_metadata || {};
    return photoFingerprint(m.original_filename || item.filename, m.original_bytes || item.byte_size);
  }));
  const seen = new Set(), selected = [];
  let skipped = 0;
  for (const [index, file] of files.entries()) {
    const key = photoFingerprint(file.name, file.size);
    if (alreadySaved.has(key) || seen.has(key)) { skipped++; continue; }
    seen.add(key);
    selected.push({ file, index });
  }
  return { selected, skipped };
}
// Only call this after queued images have been stored. A partial write is
// removed on failure instead of silently treating the batch as recoverable.
export async function createQueuedBatch({ owner, snapshot, files, savedItems = [], state = "queued" }) {
  const { selected, skipped } = selectNewPhotos(files, savedItems);
  if (!selected.length) return { batch: null, skipped };
  const id = crypto.randomUUID();
  const batch = { id, owner, snapshot, total: selected.length, skipped,
    createdAt: Date.now(), state };
  try {
    for (const [position, {file, index}] of selected.entries()) {
      // A picker File can become an invalid reference after Safari closes the
      // Photos provider. Copy the actual bytes before writing to IndexedDB.
      let durable=null,sourceError="";
      try {
        const bytes=await file.arrayBuffer();
        if(!bytes.byteLength||bytes.byteLength!==file.size)throw Error("Incomplete image bytes");
        durable=new Blob([bytes],{type:file.type||"image/jpeg"});
      }catch(err){
        sourceError="Re-select this photo on your iPhone";
      }
      await putQueuedPhoto({ key: id + ":" + position, batchId: id,
        index: position, selectionIndex: index,
        original: durable, originalName: file.name, originalBytes: file.size,
        lastModified: file.lastModified, done: false, uploaded: false,
        ready: false, metadataSaved: false, savedAt: null,
        needsReselect:!!sourceError,lastError:sourceError });
    }
    await putBatch(batch);
    return { batch, skipped };
  } catch (error) {
    await deleteBatch(id).catch(() => {});
    throw Error("Could not retain these photos on your iPhone. Select a smaller batch or free some storage. " + (error.message || ""));
  }
}
// Reattach only incomplete entries, never photos already confirmed on the server.
export function matchQueuedReplacements(entries,files){
  const waiting=entries.filter(entry=>!entry.ready&&!entry.uploaded);
  const used=new Set(),matches=[],unmatched=[];
  for(const file of files){
    const name=String(file.name||"").toLowerCase();
    const candidates=waiting.filter(entry=>!used.has(entry.key)&&
      String(entry.originalName||"").toLowerCase()===name);
    // Match both original filename and original byte length to avoid assigning
    // a different export to an existing immutable upload reservation.
    const entry=candidates.find(entry=>Number(entry.originalBytes)===file.size);
    if(!entry){unmatched.push(file.name);continue}
    used.add(entry.key);matches.push({entry,file});
  }
  return {matches,unmatched};
}
export function queueCounts(entries) {
  const saved = entries.filter(x => x.ready).length;
  const complete = entries.filter(x => x.ready && x.metadataSaved).length;
  return { saved, complete, waiting: entries.length - complete,
    metadataPending: saved - complete };
}

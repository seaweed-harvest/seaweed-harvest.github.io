import {
  initialiseOfflineStore,
  listOutboxItems,
  offlineStorageSupported
} from "./offline_store.js";
import { syncPendingCollections } from "./offline_sync.js";

const RETRY_INTERVAL_MS = 60 * 1000;
const START_DELAY_MS = 750;

let started = false;
let activeSync = null;
let intervalTimer = null;
let startupTimer = null;
let knownUserId = null;

export function startOfflineCollectionAutoSync(options = {}) {
  knownUserId = options.currentUserId || knownUserId;
  if (started || !offlineStorageSupported()) return;
  started = true;

  const trigger = () => scheduleSync(0);
  window.addEventListener("online", trigger);
  window.addEventListener("focus", trigger);
  window.addEventListener("pageshow", trigger);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") trigger();
  });

  intervalTimer = window.setInterval(() => {
    if (document.visibilityState === "visible" && navigator.onLine) trigger();
  }, RETRY_INTERVAL_MS);

  scheduleSync(START_DELAY_MS);
}

export async function runOfflineCollectionAutoSync() {
  if (!offlineStorageSupported() || !navigator.onLine || document.visibilityState === "hidden") {
    return null;
  }
  if (activeSync) return activeSync;

  activeSync = (async () => {
    await initialiseOfflineStore();
    const pending = (await listOutboxItems()).filter((item) => (
      item.status !== "synced" && item.failureType !== "server_rejected"
    ));
    if (!pending.length) return null;

    const currentUserId = knownUserId || await resolveCurrentUserId();
    const eligible = pending.filter((item) => (
      item.mode === "public" || !item.ownerUserId || item.ownerUserId === currentUserId
    ));
    if (!eligible.length) return null;

    const result = await syncPendingCollections({
      automatic: true,
      currentUserId,
      online: true
    });
    window.dispatchEvent(new CustomEvent("seaweed:offline-sync-complete", { detail: result }));
    return result;
  })().catch((error) => {
    window.dispatchEvent(new CustomEvent("seaweed:offline-sync-error", { detail: { error } }));
    return null;
  }).finally(() => {
    activeSync = null;
  });

  return activeSync;
}

function scheduleSync(delayMs) {
  window.clearTimeout(startupTimer);
  startupTimer = window.setTimeout(() => { void runOfflineCollectionAutoSync(); }, delayMs);
}

async function resolveCurrentUserId() {
  if (!localStorage.getItem("seaweed-ag-auth")) return null;
  try {
    const { currentSession } = await import("./auth_client.js");
    const session = await currentSession();
    knownUserId = session?.user?.id || null;
    return knownUserId;
  } catch {
    return null;
  }
}

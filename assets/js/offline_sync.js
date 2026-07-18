import { APP_CONFIG } from "./config.js";
import { callRpc, uploadStorageObject } from "./supabase_client.js";
import {
  listOutboxItems,
  markOutboxSynced,
  updateOutboxItem
} from "./offline_store.js";

const PHOTO_BUCKET = "collection-photos";
const SUBMISSION_TIMEOUT_MS = 45000;
const PHOTO_UPLOAD_TIMEOUT_MS = 60000;

export async function syncPendingCollections(options = {}) {
  const online = options.online ?? navigator.onLine;
  if (!online) {
    return pendingResult({ offline: true });
  }

  const items = (await listOutboxItems())
    .filter((item) => item.status !== "synced")
    .filter((item) => !options.submissionId || item.submissionId === options.submissionId)
    .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));

  let requestedResult = null;
  let requestedError = null;
  let syncedCount = 0;
  let processedCount = 0;
  const errors = [];

  for (const item of items) {
    try {
      const result = await syncOutboxItem(item);
      syncedCount += 1;
      if (item.submissionId === options.submissionId) requestedResult = result;
    } catch (error) {
      const message = error?.message || "Sync could not be completed.";
      const failure = syncFailureDetails(error);
      await updateOutboxItem(item.submissionId, {
        status: "failed",
        lastError: message,
        failureType: failure.type,
        lastHttpStatus: failure.httpStatus
      });
      errors.push({ submissionId: item.submissionId, message, ...failure });
      if (item.submissionId === options.submissionId) requestedError = error;
    }
    processedCount += 1;
    if (options.onProgress) {
      await options.onProgress(item.submissionId, {
        processedCount,
        totalCount: items.length,
        syncedCount,
        failedCount: errors.length
      });
    }
  }

  return pendingResult({
    requestedResult,
    requestedError,
    syncedCount,
    processedCount,
    totalCount: items.length,
    failedCount: errors.length,
    errors
  });
}

async function pendingResult(result = {}) {
  const remaining = (await listOutboxItems()).filter((item) => item.status !== "synced");
  return {
    offline: false,
    requestedResult: null,
    requestedError: null,
    syncedCount: 0,
    processedCount: 0,
    totalCount: 0,
    failedCount: 0,
    errors: [],
    ...result,
    remainingCount: remaining.length
  };
}

async function syncOutboxItem(savedItem) {
  let item = await updateOutboxItem(savedItem.submissionId, {
    status: "syncing",
    attempts: Number(savedItem.attempts || 0) + 1,
    lastError: null,
    failureType: null,
    lastHttpStatus: null
  });

  const photos = [...(item.photos || [])];
  for (let index = 0; index < photos.length; index += 1) {
    if (photos[index].uploadedPath) continue;
    if (!(photos[index].blob instanceof Blob)) {
      throw new Error(`Photo ${index + 1} is missing from phone storage. Restore it from a backup before syncing.`);
    }

    let path;
    if (item.mode === "public") {
      path = await uploadPublicCollectionPhoto(photos[index].blob, item.submissionId, photos[index].id);
    } else {
      path = authenticatedPhotoPath(item, photos[index]);
      await uploadStorageObject(PHOTO_BUCKET, path, photos[index].blob);
    }
    photos[index] = { ...photos[index], uploadedPath: path };
    item = await updateOutboxItem(item.submissionId, { photos });
  }

  const payload = {
    ...item.payload,
    photo_urls: photos.map((photo) => photo.uploadedPath).filter(Boolean)
  };
  const result = item.mode === "public"
    ? await submitPublicCollection(payload, item)
    : await callRpc("ag_submit_collection_v2", {
      p_submission_id: item.submissionId,
      p_collection: payload
    });

  if (item.farmSizeUpdate && item.mode !== "public") {
    await callRpc("ag_update_farmer_farm_size_from_collection", item.farmSizeUpdate);
  }
  await markOutboxSynced(item.submissionId, result);
  return result;
}

async function submitPublicCollection(payload, item) {
  const response = await fetchWithTimeout(`${APP_CONFIG.supabase.url}/functions/v1/public-collection`, {
    method: "POST",
    headers: {
      apikey: APP_CONFIG.supabase.anonKey,
      Authorization: `Bearer ${APP_CONFIG.supabase.anonKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      submission_id: item.submissionId,
      collector_name: item.collectorName,
      website: item.website || "",
      collection: payload
    })
  }, SUBMISSION_TIMEOUT_MS);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw responseError(body.error || `Collection could not be saved (${response.status}).`, response.status);
  }
  return body.result;
}

async function uploadPublicCollectionPhoto(photo, submissionId, photoId) {
  const query = new URLSearchParams({
    submission_id: submissionId,
    photo_id: photoId
  });
  const response = await fetchWithTimeout(`${APP_CONFIG.supabase.url}/functions/v1/public-collection-photo?${query}`, {
    method: "POST",
    headers: {
      apikey: APP_CONFIG.supabase.anonKey,
      Authorization: `Bearer ${APP_CONFIG.supabase.anonKey}`,
      "Content-Type": "image/jpeg"
    },
    body: photo
  }, PHOTO_UPLOAD_TIMEOUT_MS);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.path) {
    throw responseError(body.error || `Photo could not be uploaded (${response.status}).`, response.status);
  }
  return body.path;
}

function responseError(message, status) {
  const error = new Error(message);
  error.httpStatus = Number(status) || null;
  error.serverRejected = error.httpStatus >= 400 && error.httpStatus < 500 && error.httpStatus !== 408 && error.httpStatus !== 429;
  return error;
}

function syncFailureDetails(error) {
  const httpStatus = Number(error?.httpStatus) || null;
  if (error?.serverRejected || (httpStatus >= 400 && httpStatus < 500 && httpStatus !== 408 && httpStatus !== 429)) {
    return { type: "server_rejected", httpStatus };
  }
  if (!navigator.onLine) {
    return { type: "offline", httpStatus };
  }
  return { type: "temporary", httpStatus };
}

function authenticatedPhotoPath(item, photo) {
  const collectedAt = new Date(item.payload?.collected_at || item.createdAt || Date.now());
  const year = String(collectedAt.getFullYear());
  const month = String(collectedAt.getMonth() + 1).padStart(2, "0");
  const transactionFolder = String(item.payload?.transaction_id || "collection")
    .replace(/[^a-zA-Z0-9_-]/g, "-");
  return `collections/${year}/${month}/${transactionFolder}/${photo.id}.jpg`;
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Sync timed out after ${Math.round(timeoutMs / 1000)} seconds. The record is still safely stored on this device.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

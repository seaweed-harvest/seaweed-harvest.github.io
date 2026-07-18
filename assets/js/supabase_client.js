import { APP_CONFIG } from "./config.js";

const READ_TIMEOUT_MS = 12000;
const WRITE_TIMEOUT_MS = 30000;
const UPLOAD_TIMEOUT_MS = 60000;
const TRANSIENT_STATUS = new Set([429, 502, 503, 504]);
let accessTokenPromise = null;

export function isSupabaseEnabled() {
  const config = APP_CONFIG.supabase;
  return Boolean(config.enabled && config.restUrl && config.anonKey);
}

export function dataModeLabel() {
  return isSupabaseEnabled() ? "Supabase" : "Preview";
}

export async function selectRows(table, query = "") {
  if (!isSupabaseEnabled()) return previewRows(table);
  return supabaseRequest(`${table}${query ? `?${query}` : ""}`, {
    retry: true,
    timeoutMs: READ_TIMEOUT_MS
  });
}

export async function insertRow(table, payload) {
  if (!isSupabaseEnabled()) return insertPreviewRow(table, payload);
  await supabaseRequest(table, {
    method: "POST",
    body: payload,
    prefer: "return=minimal",
    timeoutMs: WRITE_TIMEOUT_MS
  });
  return [payload];
}

export async function callRpc(functionName, payload = {}) {
  if (!isSupabaseEnabled()) return [];
  return supabaseRequest(`rpc/${functionName}`, {
    method: "POST",
    body: payload,
    timeoutMs: WRITE_TIMEOUT_MS
  });
}

export async function callPublicRpc(functionName, payload = {}) {
  if (!isSupabaseEnabled()) return [];
  return supabaseRequest(`rpc/${functionName}`, {
    method: "POST",
    body: payload,
    accessToken: APP_CONFIG.supabase.anonKey,
    retry: true,
    timeoutMs: READ_TIMEOUT_MS
  });
}

export async function uploadStorageObject(bucket, objectPath, blob) {
  if (!isSupabaseEnabled()) return { path: objectPath };
  const accessToken = await requestAccessToken();
  const encodedPath = String(objectPath)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const response = await fetchWithPolicy(
    `${APP_CONFIG.supabase.url}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`,
    {
      method: "POST",
      headers: {
        apikey: APP_CONFIG.supabase.anonKey,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": blob.type || "application/octet-stream",
        "x-upsert": "false"
      },
      body: blob
    },
    { timeoutMs: UPLOAD_TIMEOUT_MS }
  );

  if (response.status === 409) {
    return { path: objectPath, duplicate: true };
  }
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}${await responseDetail(response)}`);
  }
  return response.json();
}

async function supabaseRequest(path, options = {}) {
  const accessToken = options.accessToken || await requestAccessToken();
  const headers = {
    apikey: APP_CONFIG.supabase.anonKey,
    Authorization: `Bearer ${accessToken}`
  };

  if (options.body) headers["Content-Type"] = "application/json";
  if (options.prefer) headers.Prefer = options.prefer;

  const method = options.method || "GET";
  const response = await fetchWithPolicy(`${APP_CONFIG.supabase.restUrl}/${path}`, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  }, {
    retry: options.retry ?? method === "GET",
    timeoutMs: options.timeoutMs || (method === "GET" ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}${await responseDetail(response)}`);
  }

  const text = await response.text();
  if (!text) return [];
  if (response.status === 204) return [];
  return JSON.parse(text);
}

async function requestAccessToken() {
  if (!localStorage.getItem("seaweed-ag-auth")) return APP_CONFIG.supabase.anonKey;
  if (!accessTokenPromise) {
    accessTokenPromise = (async () => {
      try {
        const { currentAccessToken } = await import("./auth_client.js");
        return await currentAccessToken();
      } catch {
        return APP_CONFIG.supabase.anonKey;
      }
    })().finally(() => {
      accessTokenPromise = null;
    });
  }
  return accessTokenPromise;
}

async function fetchWithPolicy(url, init, options = {}) {
  const attempts = options.retry ? 2 : 1;
  const timeoutMs = Number(options.timeoutMs || READ_TIMEOUT_MS);
  let lastError = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (attempt + 1 < attempts && TRANSIENT_STATUS.has(response.status)) {
        await waitBeforeRetry(attempt);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error?.name === "AbortError"
        ? new Error(`Supabase request timed out after ${Math.round(timeoutMs / 1000)} seconds.`)
        : error;
      if (attempt + 1 >= attempts) throw lastError;
      await waitBeforeRetry(attempt);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError || new Error("Supabase request failed.");
}

function waitBeforeRetry(attempt) {
  const delayMs = 250 * (2 ** attempt) + Math.round(Math.random() * 150);
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function previewRows(table) {
  const rows = APP_CONFIG.previewData?.[table] || readPreviewRows(table);
  return Promise.resolve([...rows]);
}

function insertPreviewRow(table, payload) {
  const row = {
    id: crypto.randomUUID?.() || `preview-${Date.now()}`,
    ...payload,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  const rows = readPreviewRows(table);
  rows.unshift(row);
  localStorage.setItem(storageKey(table), JSON.stringify(rows.slice(0, 100)));
  return Promise.resolve([row]);
}

function readPreviewRows(table) {
  try {
    return JSON.parse(localStorage.getItem(storageKey(table)) || "[]");
  } catch {
    return [];
  }
}

function storageKey(table) {
  return `seaweed_ag_preview:${table}`;
}

async function responseDetail(response) {
  const text = await response.text().catch(() => "");
  if (!text) return "";
  try {
    const errorBody = JSON.parse(text);
    const detail = errorBody.message || errorBody.error || errorBody.details || errorBody.hint || "";
    return detail ? ` - ${detail}` : "";
  } catch {
    return ` - ${text.slice(0, 300)}`;
  }
}

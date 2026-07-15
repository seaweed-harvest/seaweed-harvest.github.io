import { APP_CONFIG } from "./config.js";

export function isSupabaseEnabled() {
  const config = APP_CONFIG.supabase;
  return Boolean(config.enabled && config.restUrl && config.anonKey);
}

export function dataModeLabel() {
  return isSupabaseEnabled() ? "Supabase" : "Preview";
}

export async function selectRows(table, query = "") {
  if (!isSupabaseEnabled()) return previewRows(table);
  return supabaseRequest(`${table}${query ? `?${query}` : ""}`);
}

export async function insertRow(table, payload) {
  if (!isSupabaseEnabled()) return insertPreviewRow(table, payload);
  await supabaseRequest(table, {
    method: "POST",
    body: payload,
    prefer: "return=minimal"
  });
  return [payload];
}

export async function callRpc(functionName, payload = {}) {
  if (!isSupabaseEnabled()) return [];
  return supabaseRequest(`rpc/${functionName}`, {
    method: "POST",
    body: payload
  });
}

export async function callPublicRpc(functionName, payload = {}) {
  if (!isSupabaseEnabled()) return [];
  return supabaseRequest(`rpc/${functionName}`, {
    method: "POST",
    body: payload,
    accessToken: APP_CONFIG.supabase.anonKey
  });
}

export async function uploadStorageObject(bucket, objectPath, blob) {
  if (!isSupabaseEnabled()) return { path: objectPath };
  const accessToken = await requestAccessToken();
  const encodedPath = String(objectPath)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const response = await fetch(
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
    }
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

  const response = await fetch(`${APP_CONFIG.supabase.restUrl}/${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
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
  try {
    const { currentAccessToken } = await import("./auth_client.js");
    return await currentAccessToken();
  } catch {
    return APP_CONFIG.supabase.anonKey;
  }
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
  try {
    const errorBody = await response.json();
    const detail = errorBody.message || errorBody.error || errorBody.details || errorBody.hint || "";
    return detail ? ` - ${detail}` : "";
  } catch {
    const detail = await response.text();
    return detail ? ` - ${detail}` : "";
  }
}

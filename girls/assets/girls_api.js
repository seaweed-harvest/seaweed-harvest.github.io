const SUPABASE_URL = "https://wwzmajhdusfyfskppupg.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3em1hamhkdXNmeWZza3BwdXBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2MDY5MzQsImV4cCI6MjA5ODE4MjkzNH0.9W8zCF8cTjWn6ArYaJmvRNX9_wDlwsOLMDi8yh5c998";
const PHOTO_BUCKET = "girls-green-space-photos";
const REQUEST_TIMEOUT_MS = 30000;

export async function loadProjects() {
  return rpc("girls_public_green_spaces", {});
}

export async function loadLedger() {
  return rpc("girls_public_ledger", {
    p_search: null,
    p_entry_type: null,
    p_week: null,
    p_limit: 1000,
    p_offset: 0
  });
}

export async function submitGirlsRecord(payload) {
  return request(`${SUPABASE_URL}/functions/v1/girls-green-space`, {
    method: "POST",
    headers: publicHeaders(),
    body: JSON.stringify(payload)
  });
}

export function publicPhotoUrl(path) {
  if (!path) return "";
  const encoded = String(path)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${SUPABASE_URL}/storage/v1/object/public/${PHOTO_BUCKET}/${encoded}`;
}

async function rpc(functionName, payload) {
  return request(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: {
      ...publicHeaders(),
      Prefer: "count=exact"
    },
    body: JSON.stringify(payload)
  });
}

async function request(url, init) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    const body = text ? safeJson(text) : null;
    if (!response.ok) {
      const message = body?.error || body?.message || body?.details || `Request failed (${response.status})`;
      throw new Error(message);
    }
    return body ?? [];
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("The request took too long. Check the connection and try again.");
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function publicHeaders() {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json"
  };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { error: text.slice(0, 300) };
  }
}

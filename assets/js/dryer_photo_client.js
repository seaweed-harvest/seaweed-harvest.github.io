import { currentAccessToken } from "./auth_client.js?v=25";
import { DRYING_FORM_CONFIG } from "./dryer_table_config.js?v=2";

const FUNCTION_URL = `${DRYING_FORM_CONFIG.supabaseUrl}/functions/v1/dryer-record-photos`;
const REQUEST_TIMEOUT_MS = 25_000;

export async function fetchDryerEventPhotos(submissionId, bayNumber = null) {
  const payload = {
    action: "event",
    submission_id: String(submissionId || "").trim()
  };
  if (bayNumber !== null && bayNumber !== undefined && bayNumber !== "") {
    payload.bay_number = Number(bayNumber);
  }
  return callDryerPhotoFunction(payload);
}

export async function fetchDryerPhotoLibrary({
  startDate = null,
  endDate = null,
  location = null,
  recorder = null,
  sortKey = "taken_at",
  sortDirection = "desc",
  limit = 20,
  offset = 0
} = {}) {
  return callDryerPhotoFunction({
    action: "library",
    start_date: startDate || null,
    end_date: endDate || null,
    location: location || null,
    recorder: recorder || null,
    sort_key: sortKey,
    sort_direction: sortDirection,
    limit,
    offset
  });
}

async function callDryerPhotoFunction(payload) {
  const accountToken = await currentAccessToken();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(FUNCTION_URL, {
      method: "POST",
      headers: {
        apikey: DRYING_FORM_CONFIG.supabaseAnonKey,
        Authorization: `Bearer ${accountToken}`,
        "Content-Type": "application/json",
        "X-Client-Info": "seaweed-harvest-web"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(
        `${response.status} ${response.statusText}${await responseDetail(response)}`
      );
    }
    return response.json();
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Dryer photos took too long to load. Please try again.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function responseDetail(response) {
  try {
    const payload = await response.json();
    const detail = payload?.error || payload?.message || payload?.details || "";
    return detail ? ` - ${detail}` : "";
  } catch {
    const detail = await response.text();
    return detail ? ` - ${detail}` : "";
  }
}

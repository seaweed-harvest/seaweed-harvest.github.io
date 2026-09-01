import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const ACCOUNT_PROFILE_URL = "https://wwzmajhdusfyfskppupg.supabase.co/rest/v1/rpc/ag_my_profile";
const ACCOUNT_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3em1hamhkdXNmeWZza3BwdXBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2MDY5MzQsImV4cCI6MjA5ODE4MjkzNH0.9W8zCF8cTjWn6ArYaJmvRNX9_wDlwsOLMDi8yh5c998";
const PHOTO_BUCKET = "seaweed-drying-photos";
const SIGNED_URL_SECONDS = 600;
const MAX_LIBRARY_PAGE = 50;
const MAX_LIBRARY_OFFSET = 20_000;
const MAX_DATE_RANGE_DAYS = 367;

const ALLOWED_ORIGINS = new Set([
  "https://seaweed-harvest.com",
  "https://www.seaweed-harvest.com",
  "https://seaweed-harvest.github.io",
]);

type AccountProfile = {
  id?: string;
  account_status?: string;
  app_role?: string;
  active_aggregator_code?: string;
  is_protected_owner?: boolean;
  can_access_admin?: boolean;
  can_view_data?: boolean;
  organisation_capabilities?: Record<string, boolean>;
};

type CatalogRow = {
  submission_id: string;
  receipt_number: string;
  table_location: string;
  recorder_name: string;
  recorded_at: string;
  record_status: string;
  taken_at: string;
  activity_date: string;
  bay_number: number | null;
  phase: "table" | "loading" | "unloading";
  storage_path: string;
  photo_order: number;
  phase_sort: number;
};

type SignedPhotoRow = {
  signed_url: string;
  taken_at: string;
  activity_date: string;
  phase: CatalogRow["phase"];
  bay_number: number | null;
  photo_order: number;
  photo_context: string;
  source_type: "dryer_table";
  source_label: "Dryer Table";
  record_reference: string;
  location: string;
  recorder_name: string;
  submission_id: string;
};

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") || "";
  const allowedOrigin = ALLOWED_ORIGINS.has(origin)
    ? origin
    : "https://seaweed-harvest.com";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
    "Vary": "Origin",
  };
}

function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders(req),
  });
}

function enforceOrigin(req: Request): void {
  const origin = req.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    throw new HttpError(403, "Origin is not permitted.");
  }
}

function validUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function integerWithin(value: unknown, minimum: number, maximum: number, fallback: number): number {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function nairobiDate(value = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function defaultStartDate(endDate: string): string {
  const date = new Date(`${endDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 29);
  return date.toISOString().slice(0, 10);
}

function validateDateRange(startDate: string, endDate: string): void {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  const days = (end - start) / 86_400_000;
  if (!Number.isFinite(days) || days < 0 || days >= MAX_DATE_RANGE_DAYS) {
    throw new HttpError(400, "Photo date range must be between 1 and 367 days.");
  }
}

function bearerToken(req: Request): string {
  const authorization = req.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim() || "";
  if (token.length < 40 || token.length > 8192) {
    throw new HttpError(401, "Authentication required.");
  }
  return token;
}

async function validateAccountProfile(req: Request): Promise<AccountProfile> {
  const token = bearerToken(req);
  const response = await fetch(ACCOUNT_PROFILE_URL, {
    method: "POST",
    headers: {
      apikey: ACCOUNT_ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: "{}",
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);

  if (!response || !response.ok) {
    throw new HttpError(401, "Authentication required.");
  }

  const profile = await response.json().catch(() => null) as AccountProfile | null;
  const allowed = Boolean(
    profile
      && profile.account_status === "active"
      && profile.is_protected_owner === true
      && String(profile.active_aggregator_code || "").toUpperCase() === "COSME"
      && profile.organisation_capabilities?.form_dryer_table === true
      && (
        profile.app_role === "system_admin"
        || (
          profile.can_access_admin === true
          && profile.can_view_data === true
        )
      )
  );

  if (!allowed) {
    throw new HttpError(403, "Dryer photo access is not permitted.");
  }
  return profile || {};
}

function serviceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !serviceRoleKey) {
    throw new HttpError(500, "Photo service is not configured.");
  }
  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function photoContext(row: CatalogRow): string {
  if (row.phase === "table") return "Table overview";
  const bay = row.bay_number == null ? "Bay" : `Bay ${row.bay_number}`;
  return `${bay} — ${row.phase === "loading" ? "Loading" : "Unloading"}`;
}

async function signRows(
  supabase: SupabaseClient,
  rows: CatalogRow[],
): Promise<SignedPhotoRow[]> {
  return Promise.all(rows.map(async (row) => {
    const { data, error } = await supabase.storage
      .from(PHOTO_BUCKET)
      .createSignedUrl(row.storage_path, SIGNED_URL_SECONDS);
    if (error || !data?.signedUrl) {
      throw new HttpError(502, "One or more dryer photos could not be signed.");
    }
    return {
      signed_url: data.signedUrl,
      taken_at: row.taken_at,
      activity_date: row.activity_date,
      phase: row.phase,
      bay_number: row.bay_number,
      photo_order: row.photo_order,
      photo_context: photoContext(row),
      source_type: "dryer_table",
      source_label: "Dryer Table",
      record_reference: row.receipt_number,
      location: row.table_location,
      recorder_name: row.recorder_name,
      submission_id: row.submission_id,
    };
  }));
}

async function eventResponse(
  supabase: SupabaseClient,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const submissionId = body.submission_id;
  if (!validUuid(submissionId)) {
    throw new HttpError(400, "A valid dryer submission is required.");
  }
  const bayNumber = body.bay_number == null
    ? null
    : integerWithin(body.bay_number, 1, 100, 0);
  if (body.bay_number != null && bayNumber < 1) {
    throw new HttpError(400, "Bay number is invalid.");
  }

  const { data: event, error: eventError } = await supabase
    .from("seaweed_drying_submissions")
    .select("id,receipt_number,table_location,enumerator_name,recorded_at,record_status")
    .eq("id", submissionId)
    .maybeSingle();
  if (eventError) throw new HttpError(502, "Dryer event could not be loaded.");
  if (!event) throw new HttpError(404, "Dryer event was not found.");

  let query = supabase
    .from("seaweed_drying_photo_catalog")
    .select("submission_id,receipt_number,table_location,recorder_name,recorded_at,record_status,taken_at,activity_date,bay_number,phase,storage_path,photo_order,phase_sort")
    .eq("submission_id", submissionId)
    .order("phase_sort", { ascending: true })
    .order("bay_number", { ascending: true, nullsFirst: true })
    .order("photo_order", { ascending: true });
  if (bayNumber != null) query = query.eq("bay_number", bayNumber);

  const { data, error } = await query;
  if (error) throw new HttpError(502, "Dryer photos could not be loaded.");
  const rows = (data || []) as CatalogRow[];
  const photos = await signRows(supabase, rows);

  return {
    scope: bayNumber == null ? "event" : "bay",
    event: {
      submission_id: event.id,
      receipt_number: event.receipt_number,
      table_location: event.table_location,
      recorder_name: event.enumerator_name,
      recorded_at: event.recorded_at,
      record_status: event.record_status,
      bay_number: bayNumber,
    },
    photo_count: photos.length,
    photos,
    expires_in_seconds: SIGNED_URL_SECONDS,
  };
}

async function libraryResponse(
  supabase: SupabaseClient,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const endDate = validDate(body.end_date) ? body.end_date : nairobiDate();
  const startDate = validDate(body.start_date)
    ? body.start_date
    : defaultStartDate(endDate);
  validateDateRange(startDate, endDate);

  const location = typeof body.location === "string"
    ? body.location.trim().slice(0, 180)
    : "";
  const recorder = typeof body.recorder === "string"
    ? body.recorder.trim().slice(0, 180)
    : "";
  const limit = integerWithin(body.limit, 1, MAX_LIBRARY_PAGE, 20);
  const offset = integerWithin(body.offset, 0, MAX_LIBRARY_OFFSET, 0);
  const sortKey = ["taken_at", "table_location", "recorder_name"].includes(
    String(body.sort_key || ""),
  )
    ? String(body.sort_key)
    : "taken_at";
  const ascending = String(body.sort_direction || "").toLowerCase() === "asc";

  let query = supabase
    .from("seaweed_drying_photo_catalog")
    .select(
      "submission_id,receipt_number,table_location,recorder_name,recorded_at,record_status,taken_at,activity_date,bay_number,phase,storage_path,photo_order,phase_sort",
      { count: "exact" },
    )
    .gte("activity_date", startDate)
    .lte("activity_date", endDate);
  if (location) query = query.eq("table_location", location);
  if (recorder) query = query.ilike("recorder_name", `%${recorder}%`);

  query = query
    .order(sortKey, { ascending, nullsFirst: false })
    .order("taken_at", { ascending: false })
    .order("phase_sort", { ascending: true })
    .order("bay_number", { ascending: true, nullsFirst: true })
    .order("photo_order", { ascending: true })
    .range(offset, offset + limit - 1);

  const [{ data, error, count }, locationResult] = await Promise.all([
    query,
    supabase
      .from("seaweed_drying_photo_catalog")
      .select("table_location")
      .order("table_location", { ascending: true })
      .limit(1000),
  ]);
  if (error) throw new HttpError(502, "Dryer photo library could not be loaded.");
  if (locationResult.error) {
    throw new HttpError(502, "Dryer photo locations could not be loaded.");
  }

  const rows = (data || []) as CatalogRow[];
  const photos = await signRows(supabase, rows);
  const locations = [...new Set(
    (locationResult.data || [])
      .map((row) => String(row.table_location || "").trim())
      .filter(Boolean),
  )];

  return {
    total_count: count || 0,
    rows: photos,
    locations,
    start_date: startDate,
    end_date: endDate,
    expires_in_seconds: SIGNED_URL_SECONDS,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }
  if (req.method !== "POST") {
    return jsonResponse(req, { error: "POST required." }, 405);
  }

  try {
    enforceOrigin(req);
    await validateAccountProfile(req);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action || "");
    const supabase = serviceClient();

    if (action === "event") {
      return jsonResponse(req, await eventResponse(supabase, body));
    }
    if (action === "library") {
      return jsonResponse(req, await libraryResponse(supabase, body));
    }
    throw new HttpError(400, "Photo action is invalid.");
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Photo request failed.";
    return jsonResponse(req, { error: message }, status);
  }
});

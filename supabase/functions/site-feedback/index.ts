import { createClient } from "npm:@supabase/supabase-js@2.110.2";
import { slackUserMention } from "../_shared/slack_codex.ts";

type AdminClient = ReturnType<typeof createClient<any>>;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SLACK_WEBHOOK_URL = Deno.env.get("AGGREGATION_SLACK_WEBHOOK_URL") ?? "";
const CODEX_SLACK_USER_ID = (Deno.env.get("CODEX_SLACK_USER_ID") ?? "").trim();
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_COUNT = 8;
const JENN_EMAIL = "joneill@cascadiaseaweed.com";
const PHOTO_BUCKET = "site-feedback-photos";
const MAX_PHOTO_BYTES = 700 * 1024;

const ALLOWED_ORIGINS = new Set([
  "https://seaweed-harvest.com",
  "https://www.seaweed-harvest.com",
  "https://seaweed-harvest.github.io",
  "https://seaweed-tide-planner.github.io",
  "https://bosunjm-cloud.github.io",
  "https://localhost",
  "capacitor://localhost"
]);

type FeedbackPayload = {
  submission_id: string;
  source_app: "aggregation" | "green_space" | "tide";
  source_page: string;
  page_url: string | null;
  feedback_type: "improvement" | "change" | "problem";
  message: string;
  submitter_name: string | null;
  locale: string;
  client_token: string;
  user_agent: string | null;
  photo_data_url: string | null;
  website?: string;
};

Deno.serve(async (request) => {
  const cors = corsHeaders(request);
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, cors);
  if (!originAllowed(request)) return jsonResponse({ error: "Origin not allowed" }, 403, cors);

  try {
    const raw = await request.json();
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const identity = await authenticatedIdentity(request, admin);
    if (raw?.action === "delete") {
      return await deleteFeedback(raw, admin, identity, cors);
    }
    if (raw?.action === "approve_implementation") {
      return await approveImplementation(
        raw,
        admin,
        identity,
        request.headers.get("authorization") ?? "",
        cors
      );
    }
    if (raw?.action === "retry_assessment") {
      return await retryAssessment(raw, admin, identity, cors);
    }

    const payload = validatePayload(raw);
    if (payload.website) return jsonResponse({ ok: true }, 200, cors);
    const authenticatedSuggestion = Boolean(identity.userId);
    const trustedOwnerSuggestion = await trustedOwnerEnabled(
      admin,
      identity.userId,
      payload.source_app
    );
    const fingerprint = await sha256(`${payload.client_token}|${clientAddress(request)}`);

    const { data: existing, error: existingError } = await admin
      .from("ag_site_feedback")
      .select("id,slack_status,automation_enabled,automation_status")
      .eq("client_submission_id", payload.submission_id)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) {
      return jsonResponse({
        ok: true,
        id: existing.id,
        duplicate: true,
        automation_eligible: existing.automation_enabled === true,
        automation_status: existing.automation_status
      }, 200, cors);
    }

    const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
    const { count, error: countError } = await admin
      .from("ag_site_feedback")
      .select("id", { count: "exact", head: true })
      .eq("client_fingerprint_hash", fingerprint)
      .gte("created_at", since);
    if (countError) throw countError;
    if ((count ?? 0) >= RATE_LIMIT_COUNT) {
      throw new PublicError(429, "Several suggestions were recently sent. Please wait a few minutes.");
    }

    const celebrateJenn = payload.source_app === "aggregation"
      && payload.feedback_type === "improvement"
      && identity.email?.toLowerCase() === JENN_EMAIL
      && await hasNoJennImprovement(admin);
    const feedbackId = crypto.randomUUID();
    const photo = decodePhoto(payload.photo_data_url);
    const photoPath = photo
      ? `feedback/${new Date().toISOString().slice(0, 7)}/${feedbackId}.jpg`
      : null;
    if (photo && photoPath) {
      const { error: photoError } = await admin.storage
        .from(PHOTO_BUCKET)
        .upload(photoPath, photo, {
          contentType: "image/jpeg",
          cacheControl: "3600",
          upsert: false
        });
      if (photoError) throw photoError;
    }
    const initialSlackStatus = SLACK_WEBHOOK_URL ? "pending" : "not_configured";
    const { data: feedback, error: insertError } = await admin
      .from("ag_site_feedback")
      .insert({
        id: feedbackId,
        client_submission_id: payload.submission_id,
        source_app: payload.source_app,
        source_page: payload.source_page,
        page_url: payload.page_url,
        feedback_type: payload.feedback_type,
        message: payload.message,
        submitter_user_id: identity.userId,
        submitter_name: payload.submitter_name || identity.name,
        submitter_email: identity.email,
        locale: payload.locale,
        client_fingerprint_hash: fingerprint,
        user_agent: payload.user_agent,
        photo_path: photoPath,
        photo_content_type: photo ? "image/jpeg" : null,
        photo_byte_size: photo?.byteLength ?? null,
        slack_status: initialSlackStatus
      })
      .select("id,created_at,automation_enabled,automation_status")
      .single();
    if (insertError || !feedback) {
      if (photoPath) await admin.storage.from(PHOTO_BUCKET).remove([photoPath]);
      throw insertError ?? new Error("Feedback could not be stored");
    }

    let automationDispatched = false;
    if (feedback.automation_enabled) {
      automationDispatched = await dispatchAuthenticatedSuggestion(feedback.id);
    }

    let slackStatus = initialSlackStatus;
    if (SLACK_WEBHOOK_URL) {
      const delivery = await sendSlack(
        SLACK_WEBHOOK_URL,
        slackMessage(
          payload,
          identity,
          feedback.id,
          Boolean(photoPath),
          authenticatedSuggestion,
          trustedOwnerSuggestion
        )
      );
      slackStatus = delivery.ok ? "sent" : "failed";
      await admin
        .from("ag_site_feedback")
        .update({
          slack_status: slackStatus,
          slack_error: delivery.ok ? null : delivery.error
        })
        .eq("id", feedback.id);
    }

    return jsonResponse({
      ok: true,
      id: feedback.id,
      notification_sent: slackStatus === "sent",
      automation_eligible: feedback.automation_enabled,
      automation_status: feedback.automation_status,
      automation_dispatched: automationDispatched,
      celebration: celebrateJenn ? "jenn-first-improvement" : null
    }, 200, cors);
  } catch (error) {
    console.error("site-feedback failed", error);
    const status = error instanceof PublicError ? error.status : 500;
    const message = error instanceof PublicError
      ? error.message
      : "The suggestion could not be sent. Please try again.";
    return jsonResponse({ error: message }, status, cors);
  }
});

async function hasNoJennImprovement(admin: AdminClient) {
  const { count, error } = await admin
    .from("ag_site_feedback")
    .select("id", { count: "exact", head: true })
    .ilike("submitter_email", JENN_EMAIL)
    .eq("source_app", "aggregation")
    .eq("feedback_type", "improvement");
  if (error) throw error;
  return (count ?? 0) === 0;
}

async function deleteFeedback(
  value: Record<string, unknown>,
  admin: AdminClient,
  identity: { userId: string | null; email: string | null; name: string | null },
  cors: Record<string, string>
) {
  if (!await trustedOwnerEnabled(admin, identity.userId)) {
    throw new PublicError(403, "Only the trusted product owner can delete suggestions.");
  }

  const feedbackId = requiredUuid(value.feedback_id, "Select a valid suggestion.");
  const { data: feedback, error: feedbackError } = await admin
    .from("ag_site_feedback")
    .select("id,photo_path,source_app,source_page,submitter_name,submitter_email")
    .eq("id", feedbackId)
    .maybeSingle();
  if (feedbackError) throw feedbackError;
  if (!feedback) throw new PublicError(404, "Suggestion was not found.");

  if (feedback.photo_path) {
    const { error: photoError } = await admin.storage
      .from(PHOTO_BUCKET)
      .remove([feedback.photo_path]);
    if (photoError) throw photoError;
  }

  const { error: deleteError } = await admin
    .from("ag_site_feedback")
    .delete()
    .eq("id", feedbackId);
  if (deleteError) throw deleteError;

  const { error: auditError } = await admin.from("ag_audit_log").insert({
    actor_user_id: identity.userId,
    actor_email: identity.email,
    action: "site_suggestion_deleted",
    target_type: "site_feedback",
    target_id: feedbackId,
    details: {
      source_app: feedback.source_app,
      source_page: feedback.source_page,
      submitter: feedback.submitter_name || feedback.submitter_email || "Anonymous",
      photo_deleted: Boolean(feedback.photo_path)
    }
  });
  if (auditError) console.error("site-feedback delete audit failed", auditError);

  return jsonResponse({
    ok: true,
    id: feedbackId,
    photo_deleted: Boolean(feedback.photo_path)
  }, 200, cors);
}

async function approveImplementation(
  value: Record<string, unknown>,
  admin: AdminClient,
  identity: { userId: string | null; email: string | null; name: string | null },
  authorization: string,
  cors: Record<string, string>
) {
  if (!await trustedOwnerEnabled(admin, identity.userId)) {
    throw new PublicError(403, "Only the trusted product owner can approve implementation.");
  }

  const feedbackId = requiredUuid(value.feedback_id, "Select a valid suggestion.");
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: authorization } }
  });
  const { data: runId, error } = await userClient.rpc(
    "ag_owner_approve_suggestion_implementation",
    { p_feedback_id: feedbackId }
  );
  if (error || !runId) {
    throw error ?? new PublicError(409, "Suggestion implementation could not be approved.");
  }
  const dispatched = await dispatchInternal(
    "ai-suggestion-implementation-dispatch",
    { automation_run_id: runId }
  );

  const { error: auditError } = await admin.from("ag_audit_log").insert({
    actor_user_id: identity.userId,
    actor_email: identity.email,
    action: "site_suggestion_implementation_approved",
    target_type: "site_feedback",
    target_id: feedbackId,
    details: {
      automation_run_id: runId,
      dispatched
    }
  });
  if (auditError) console.error("site-feedback implementation approval audit failed", auditError);

  return jsonResponse({
    ok: true,
    id: feedbackId,
    automation_run_id: runId,
    approved: true,
    dispatched
  }, 202, cors);
}

async function retryAssessment(
  value: Record<string, unknown>,
  admin: AdminClient,
  identity: { userId: string | null; email: string | null; name: string | null },
  cors: Record<string, string>
) {
  if (!await trustedOwnerEnabled(admin, identity.userId)) {
    throw new PublicError(403, "Only the trusted product owner can retry AI review.");
  }

  const feedbackId = requiredUuid(value.feedback_id, "Select a valid suggestion.");
  const { data: feedback, error: feedbackError } = await admin
    .from("ag_site_feedback")
    .select("id,automation_enabled,status")
    .eq("id", feedbackId)
    .maybeSingle();
  if (feedbackError) throw feedbackError;
  if (!feedback) throw new PublicError(404, "Suggestion was not found.");
  if (!feedback.automation_enabled) {
    throw new PublicError(409, "This suggestion is assigned to manual review.");
  }
  if (feedback.status === "closed") {
    throw new PublicError(409, "Reopen the suggestion before retrying AI review.");
  }

  const dispatched = await dispatchAuthenticatedSuggestion(feedbackId);
  const { error: auditError } = await admin.from("ag_audit_log").insert({
    actor_user_id: identity.userId,
    actor_email: identity.email,
    action: "site_suggestion_ai_review_retried",
    target_type: "site_feedback",
    target_id: feedbackId,
    details: { dispatched }
  });
  if (auditError) console.error("site-feedback AI retry audit failed", auditError);

  return jsonResponse({
    ok: true,
    id: feedbackId,
    dispatched
  }, dispatched ? 202 : 200, cors);
}

function validatePayload(value: Record<string, unknown>): FeedbackPayload {
  const submissionId = requiredUuid(value.submission_id, "Invalid submission identifier.");
  const sourceApp = String(value.source_app ?? "").trim();
  if (!["aggregation", "green_space", "tide"].includes(sourceApp)) {
    throw new PublicError(400, "Unknown source application.");
  }

  const feedbackType = String(value.feedback_type ?? "").trim();
  if (!["improvement", "change", "problem"].includes(feedbackType)) {
    throw new PublicError(400, "Select a valid suggestion type.");
  }

  const message = String(value.message ?? "").replace(/\s+/g, " ").trim();
  if (message.length < 3 || message.length > 2000) {
    throw new PublicError(400, "Write a suggestion between 3 and 2,000 characters.");
  }

  const clientToken = String(value.client_token ?? "").trim();
  if (!/^[a-zA-Z0-9-]{16,100}$/.test(clientToken)) {
    throw new PublicError(400, "Invalid client identifier.");
  }

  return {
    submission_id: submissionId,
    source_app: sourceApp as FeedbackPayload["source_app"],
    source_page: limitedText(value.source_page, 160) || "Unknown page",
    page_url: limitedText(value.page_url, 1000),
    feedback_type: feedbackType as FeedbackPayload["feedback_type"],
    message,
    submitter_name: limitedText(value.submitter_name, 100),
    locale: limitedText(value.locale, 10) || "en",
    client_token: clientToken,
    user_agent: limitedText(value.user_agent, 500),
    photo_data_url: optionalPhotoDataUrl(value.photo_data_url),
    website: limitedText(value.website, 200) || undefined
  };
}

async function trustedOwnerEnabled(
  admin: AdminClient,
  userId: string | null,
  sourceApp?: FeedbackPayload["source_app"]
) {
  if (!userId) return false;
  const { data, error } = await admin
    .from("ag_ai_automation_actors")
    .select("trust_tier,active,allowed_apps,can_auto_plan,can_auto_implement,can_auto_merge")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data?.trust_tier === "trusted_product_owner"
    && data.active === true
    && data.can_auto_plan === true
    && data.can_auto_implement === true
    && data.can_auto_merge === false
    && Array.isArray(data.allowed_apps)
    && (!sourceApp || data.allowed_apps.includes(sourceApp));
}

async function authenticatedIdentity(request: Request, admin: AdminClient) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token || token === ANON_KEY) return { userId: null, email: null, name: null };

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return { userId: null, email: null, name: null };

  const { data: profile } = await admin
    .from("ag_user_profiles")
    .select("display_name,email")
    .eq("id", data.user.id)
    .maybeSingle();
  return {
    userId: data.user.id,
    email: profile?.email || data.user.email || null,
    name: profile?.display_name
      || data.user.user_metadata?.display_name
      || data.user.user_metadata?.full_name
      || null
  };
}

function slackMessage(
  payload: FeedbackPayload,
  identity: { name: string | null; email: string | null },
  id: string,
  hasPhoto: boolean,
  authenticatedSuggestion: boolean,
  trustedOwnerSuggestion: boolean
) {
  const app = payload.source_app === "tide"
    ? "Seaweed Tide Planner"
    : payload.source_app === "green_space"
      ? "Green Space Log"
      : "Seaweed Harvest";
  const type = {
    improvement: "Improvement",
    change: "Change request",
    problem: "Problem or fix"
  }[payload.feedback_type];
  const submittedBy = payload.submitter_name || identity.name || "Anonymous";
  const codexMention = codexSlackMention();
  const details = [
    trustedOwnerSuggestion
      ? `${codexMention}:robot_face: *SEAWEED_OWNER_SUGGESTION*`
      : ":speech_balloon: *New site suggestion*",
    `*Product:* ${slackSafe(app)}`,
    `*Type:* ${slackSafe(type)}`,
    `*Page:* ${slackSafe(payload.source_page)}`,
    `*From:* ${slackSafe(submittedBy)}${identity.email ? ` (${slackSafe(identity.email)})` : ""}`,
    `*Workflow:* ${trustedOwnerSuggestion
      ? "Eligible for low-risk branch and draft PR"
      : authenticatedSuggestion
        ? "Assessment and implementation plan"
        : "Manual review"}`,
    `>${slackSafe(payload.message).replaceAll("\n", "\n>")}`,
    `*Reference:* \`${id}\``
  ];
  if (payload.page_url) details.push(`*Page link:* ${slackSafe(payload.page_url)}`);
  if (hasPhoto) details.push("*Attachment:* Screenshot saved in the private suggestions workspace.");
  if (trustedOwnerSuggestion) {
    details.push(
      `*Source repository:* \`${sourceRepository(payload.source_app)}\``,
      "*Codex instruction:* Retrieve the authoritative suggestion and authenticated UUID from Supabase. "
        + "For a low-risk Lane A request, use a branch and draft pull request. Do not merge or deploy.",
      "*Suggestion queue:* https://seaweed-harvest.com/admin_suggestions.html"
    );
  }
  return details.join("\n");
}

function codexSlackMention() {
  return slackUserMention(CODEX_SLACK_USER_ID);
}

function sourceRepository(sourceApp: FeedbackPayload["source_app"]) {
  return sourceApp === "tide"
    ? "bosunjm-cloud/Seaweed_Tide_App"
    : "seaweed-harvest/seaweed-harvest.github.io";
}

async function dispatchAuthenticatedSuggestion(feedbackId: string) {
  return await dispatchInternal("ai-suggestion-dispatch", { feedback_id: feedbackId });
}

async function dispatchInternal(functionName: string, body: Record<string, unknown>) {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      console.error(
        `${functionName} rejected internal dispatch`,
        response.status,
        (await response.text()).slice(0, 500)
      );
      return false;
    }
    const result = await response.json().catch(() => ({}));
    return result.dispatched === true;
  } catch (error) {
    console.error(`${functionName} internal dispatch failed`, error);
    return false;
  }
}

async function sendSlack(webhookUrl: string, text: string) {
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });
    if (response.ok) return { ok: true, error: null };
    return { ok: false, error: (await response.text()).slice(0, 500) };
  } catch (error) {
    return { ok: false, error: String(error).slice(0, 500) };
  }
}

function originAllowed(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const url = new URL(origin);
    return (url.hostname === "localhost" || url.hostname === "127.0.0.1")
      && ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin");
  return {
    "Access-Control-Allow-Origin": origin && originAllowed(request) ? origin : "https://seaweed-harvest.com",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  };
}

function jsonResponse(payload: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(payload), { status, headers });
}

function limitedText(value: unknown, maximum: number) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, maximum) : null;
}

function optionalPhotoDataUrl(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (text.length > 1_000_000 || !/^data:image\/jpeg;base64,[a-zA-Z0-9+/=\s]+$/.test(text)) {
    throw new PublicError(400, "The screenshot must be a JPEG no larger than 700 KB.");
  }
  return text;
}

function decodePhoto(value: string | null) {
  if (!value) return null;
  try {
    const encoded = value.slice(value.indexOf(",") + 1).replace(/\s+/g, "");
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (!bytes.byteLength || bytes.byteLength > MAX_PHOTO_BYTES) {
      throw new PublicError(400, "The screenshot must be no larger than 700 KB.");
    }
    if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
      throw new PublicError(400, "The screenshot must be a valid JPEG image.");
    }
    return bytes;
  } catch (error) {
    if (error instanceof PublicError) throw error;
    throw new PublicError(400, "The screenshot could not be read.");
  }
}

function requiredUuid(value: unknown, message: string) {
  const text = String(value ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new PublicError(400, message);
  }
  return text;
}

function clientAddress(request: Request) {
  return (request.headers.get("x-forwarded-for") || request.headers.get("cf-connecting-ip") || "unknown")
    .split(",")[0]
    .trim();
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function slackSafe(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .slice(0, 1800);
}

class PublicError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

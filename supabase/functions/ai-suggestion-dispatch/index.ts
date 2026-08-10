import { createClient } from "npm:@supabase/supabase-js@2.110.2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const AUTOMATION_MODE = (Deno.env.get("AI_SUGGESTION_AUTOMATION_MODE") ?? "dispatch").trim();
const GITHUB_TOKEN = Deno.env.get("AI_SUGGESTION_GITHUB_TOKEN") ?? "";
const GITHUB_API_URL = (Deno.env.get("GITHUB_API_URL") ?? "https://api.github.com").replace(/\/$/, "");

const ALLOWED_MODES = new Set(["shadow", "dispatch"]);

type WebhookBody = {
  feedback_id?: string;
  record?: { id?: string };
  type?: string;
  table?: string;
  schema?: string;
};

Deno.serve(async (request) => {
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  const serviceToken = (request.headers.get("authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!SERVICE_ROLE_KEY || !constantTimeEqual(serviceToken, SERVICE_ROLE_KEY)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  if (!ALLOWED_MODES.has(AUTOMATION_MODE)) {
    return jsonResponse({ error: "Automation mode is invalid" }, 503);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  let runId: string | null = null;
  let feedbackId: string | null = null;
  try {
    const body = await request.json() as WebhookBody;
    feedbackId = requiredUuid(body.feedback_id ?? body.record?.id, "Invalid feedback identifier");

    if (body.table && body.table !== "ag_site_feedback") {
      throw new PublicError(400, "Unexpected webhook table");
    }
    if (body.schema && body.schema !== "public") {
      throw new PublicError(400, "Unexpected webhook schema");
    }

    const { data: feedback, error: feedbackError } = await admin
      .from("ag_site_feedback")
      .select("id,automation_enabled")
      .eq("id", feedbackId)
      .maybeSingle();
    if (feedbackError) throw feedbackError;
    if (!feedback) throw new PublicError(404, "Suggestion was not found");
    if (!feedback.automation_enabled) {
      return jsonResponse({
        ok: true,
        ignored: true,
        feedback_id: feedbackId,
        reason: "authenticated_automation_not_enabled"
      }, 200);
    }

    const { data: runIdData, error: runError } = await admin.rpc(
      "ag_create_site_feedback_automation_run",
      { p_feedback_id: feedbackId, p_mode: AUTOMATION_MODE }
    );
    if (runError || !runIdData) throw runError ?? new Error("Automation run could not be created");
    runId = String(runIdData);

    const { data: run, error: readError } = await admin
      .from("ag_site_feedback_automation_runs")
      .select("id,feedback_id,mode,state,source_app,target_key,target_repository,trust_tier,can_auto_plan,can_auto_implement,can_auto_merge,maximum_risk_level,slack_thread_ts,external_task_url,github_branch,github_pull_request_url")
      .eq("id", runId)
      .single();
    if (readError || !run) throw readError ?? new Error("Automation run could not be loaded");

    const expectedPendingState = AUTOMATION_MODE === "shadow"
      ? "shadow_assessment_pending"
      : "dispatch_pending";
    if (run.state !== expectedPendingState
      || run.slack_thread_ts
      || run.external_task_url
      || run.github_branch
      || run.github_pull_request_url) {
      return jsonResponse({
        ok: true,
        ignored: true,
        duplicate: true,
        feedback_id: feedbackId,
        automation_run_id: run.id,
        state: run.state,
        reason: "existing_task_thread_branch_or_pull_request"
      }, 200);
    }

    if (AUTOMATION_MODE === "shadow") {
      const now = new Date().toISOString();
      await Promise.all([
        admin
          .from("ag_site_feedback_automation_runs")
          .update({
            state: "held",
            error_code: "automation_paused",
            error_message: "AI review is paused until the GitHub workflow and OpenAI API key are configured.",
            completed_at: now,
            updated_at: now
          })
          .eq("id", run.id),
        admin
          .from("ag_site_feedback")
          .update({
            automation_status: "held",
            automation_summary: "AI review is paused until its GitHub workflow and OpenAI API key are configured.",
            automation_last_processed_at: now
          })
          .eq("id", feedbackId)
      ]);
      return jsonResponse({
        ok: true,
        mode: "shadow",
        feedback_id: feedbackId,
        automation_run_id: run.id,
        target_repository: run.target_repository,
        dispatched: false,
        paused: true
      }, 200);
    }

    if (!GITHUB_TOKEN) throw new PublicError(503, "GitHub dispatch token is not configured");
    const { data: dispatchClaimed, error: claimError } = await admin.rpc(
      "ag_claim_site_feedback_assessment_dispatch",
      { p_run_id: run.id }
    );
    if (claimError) throw claimError;
    if (dispatchClaimed !== true) {
      return jsonResponse({
        ok: true,
        ignored: true,
        duplicate: true,
        feedback_id: feedbackId,
        automation_run_id: run.id,
        reason: "assessment_dispatch_already_claimed"
      }, 200);
    }

    const dispatchPayload = {
      event_type: "ai-suggestion-assessment",
      client_payload: {
        suggestion_id: feedbackId,
        automation_run_id: run.id,
        source_app: run.source_app,
        target_key: run.target_key,
        mode: run.mode
      }
    };

    const dispatch = await fetch(`${GITHUB_API_URL}/repos/${run.target_repository}/dispatches`, {
      method: "POST",
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": `Bearer ${GITHUB_TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": "seaweed-harvest-ai-suggestion-dispatch",
        "X-GitHub-Api-Version": "2022-11-28"
      },
      body: JSON.stringify(dispatchPayload)
    });

    if (!dispatch.ok) {
      const detail = (await dispatch.text()).slice(0, 1000);
      throw new Error(`GitHub dispatch failed: ${dispatch.status} ${detail}`);
    }

    await Promise.all([
      admin
        .from("ag_site_feedback_automation_runs")
        .update({
          state: "dispatched",
          github_dispatch_status: "accepted",
          started_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          error_code: null,
          error_message: null
        })
        .eq("id", run.id),
      admin
        .from("ag_site_feedback")
        .update({
          automation_status: "dispatched",
          automation_last_processed_at: new Date().toISOString()
        })
        .eq("id", feedbackId)
    ]);

    return jsonResponse({
      ok: true,
      mode: "dispatch",
      feedback_id: feedbackId,
      automation_run_id: run.id,
      target_repository: run.target_repository,
      dispatched: true
    }, 202);
  } catch (error) {
    console.error("ai-suggestion-dispatch failed", error);
    const now = new Date().toISOString();
    if (runId && feedbackId) {
      const errorMessage = String(error instanceof Error ? error.message : error).slice(0, 2000);
      await Promise.all([
        admin
          .from("ag_site_feedback_automation_runs")
          .update({
            state: "failed",
            github_dispatch_status: "failed",
            error_code: error instanceof PublicError ? `http_${error.status}` : "dispatch_error",
            error_message: errorMessage,
            completed_at: now,
            updated_at: now
          })
          .eq("id", runId),
        admin
          .from("ag_site_feedback")
          .update({
            automation_status: "failed",
            automation_summary: errorMessage,
            automation_last_processed_at: now
          })
          .eq("id", feedbackId)
      ]);
    }
    const status = error instanceof PublicError ? error.status : 500;
    const message = error instanceof PublicError ? error.message : "Suggestion dispatch failed";
    return jsonResponse({ error: message, automation_run_id: runId }, status);
  }
});

function requiredUuid(value: unknown, message: string) {
  const text = String(value ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new PublicError(400, message);
  }
  return text;
}

function constantTimeEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const maximum = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < maximum; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

function jsonResponse(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}

class PublicError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

import { createClient } from "npm:@supabase/supabase-js@2.110.2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CODING_PILOT_MODE = (Deno.env.get("AI_SUGGESTION_CODING_PILOT_MODE") ?? "dispatch").trim();
const GITHUB_TOKEN = Deno.env.get("AI_SUGGESTION_GITHUB_TOKEN") ?? "";
const GITHUB_API_URL = (Deno.env.get("GITHUB_API_URL") ?? "https://api.github.com").replace(/\/$/, "");

const ALLOWED_MODES = new Set(["disabled", "dispatch"]);

type WebhookBody = {
  automation_run_id?: string;
  record?: { id?: string; state?: string };
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
  if (!ALLOWED_MODES.has(CODING_PILOT_MODE)) {
    return jsonResponse({ error: "Coding pilot mode is invalid" }, 503);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  let runId: string | null = null;
  try {
    const body = await request.json() as WebhookBody;
    runId = requiredUuid(body.automation_run_id ?? body.record?.id, "Invalid automation run identifier");
    if (body.table && body.table !== "ag_site_feedback_automation_runs") {
      throw new PublicError(400, "Unexpected webhook table");
    }
    if (body.schema && body.schema !== "public") {
      throw new PublicError(400, "Unexpected webhook schema");
    }

    const { data: run, error: runError } = await admin
      .from("ag_site_feedback_automation_runs")
      .select("id,feedback_id,state,decision,risk_level,mode,source_app,target_repository,can_auto_implement,assessment,implementation_approved_at,implementation_approved_by,implementation_dispatch_status,external_task_url,github_branch,github_pull_request_url")
      .eq("id", runId)
      .single();
    if (runError || !run) throw runError ?? new PublicError(404, "Automation run not found");

    if (["coding", "testing", "pull_request_open", "merged", "deploying", "deployed"].includes(run.state)
      || run.implementation_dispatch_status === "accepted"
      || run.external_task_url
      || run.github_branch
      || run.github_pull_request_url) {
      return jsonResponse({
        ok: true,
        ignored: true,
        duplicate: true,
        automation_run_id: run.id,
        state: run.state,
        reason: "existing_task_branch_or_pull_request"
      }, 200);
    }

    const lane = String(run.assessment?.lane ?? "");
    const eligible = run.state === "assessment_complete"
      && run.mode === "dispatch"
      && run.decision === "implement"
      && run.risk_level === "low"
      && lane === "A"
      && (run.can_auto_implement === true || Boolean(run.implementation_approved_at));

    if (!eligible) {
      return jsonResponse({
        ok: true,
        ignored: true,
        mode: CODING_PILOT_MODE,
        automation_run_id: run.id,
        state: run.state,
        eligible: false
      }, 200);
    }

    if (CODING_PILOT_MODE === "disabled") {
      return jsonResponse({
        ok: true,
        ignored: true,
        mode: "disabled",
        automation_run_id: run.id,
        eligible: true,
        dispatched: false
      }, 200);
    }

    if (!GITHUB_TOKEN) throw new PublicError(503, "GitHub dispatch token is not configured");

    const { data: authorization, error: authorizationError } = await admin.rpc(
      "ag_authorize_site_feedback_coding",
      { p_run_id: run.id }
    );
    if (authorizationError || !authorization) {
      throw authorizationError ?? new Error("Coding authorization failed");
    }

    const dispatch = await fetch(`${GITHUB_API_URL}/repos/${authorization.target_repository}/dispatches`, {
      method: "POST",
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": `Bearer ${GITHUB_TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": "seaweed-harvest-ai-implementation-dispatch",
        "X-GitHub-Api-Version": "2022-11-28"
      },
      body: JSON.stringify({
        event_type: "ai-suggestion-implementation",
        client_payload: {
          suggestion_id: authorization.feedback_id,
          automation_run_id: authorization.automation_run_id,
          source_app: authorization.source_app,
          target_key: authorization.target_key
        }
      })
    });

    if (!dispatch.ok) {
      const detail = (await dispatch.text()).slice(0, 1000);
      throw new Error(`GitHub implementation dispatch failed: ${dispatch.status} ${detail}`);
    }

    const now = new Date().toISOString();
    const { error: updateError } = await admin
      .from("ag_site_feedback_automation_runs")
      .update({
        implementation_dispatch_status: "accepted",
        github_dispatch_status: "implementation_accepted",
        updated_at: now,
        error_code: null,
        error_message: null
      })
      .eq("id", run.id);
    if (updateError) throw updateError;

    return jsonResponse({
      ok: true,
      mode: "dispatch",
      automation_run_id: run.id,
      target_repository: authorization.target_repository,
      dispatched: true,
      may_merge: false,
      may_deploy: false
    }, 202);
  } catch (error) {
    console.error("ai-suggestion-implementation-dispatch failed", error);
    if (runId) {
      const now = new Date().toISOString();
      const errorMessage = String(error instanceof Error ? error.message : error).slice(0, 2000);
      const { data: failedRun } = await admin
        .from("ag_site_feedback_automation_runs")
        .update({
          state: "failed",
          implementation_dispatch_status: "failed",
          error_code: error instanceof PublicError ? `http_${error.status}` : "implementation_dispatch_error",
          error_message: errorMessage,
          completed_at: now,
          updated_at: now
        })
        .eq("id", runId)
        .select("feedback_id")
        .maybeSingle();
      if (failedRun?.feedback_id) {
        await admin
          .from("ag_site_feedback")
          .update({
            automation_status: "failed",
            automation_summary: errorMessage,
            automation_last_processed_at: now
          })
          .eq("id", failedRun.feedback_id);
      }
    }
    const status = error instanceof PublicError ? error.status : 500;
    const message = error instanceof PublicError ? error.message : "Implementation dispatch failed";
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
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

class PublicError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

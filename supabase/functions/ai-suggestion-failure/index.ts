import { createClient } from "npm:@supabase/supabase-js@2.110.2";
import { classifySuggestionFailure } from "../_shared/ai_suggestion_failure_policy.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WORKFLOW_SECRET = Deno.env.get("AI_SUGGESTION_WORKFLOW_SECRET") ?? "";

type FailureRequest = {
  automation_run_id?: string;
  stage?: string;
  summary?: string;
  workflow_run_id?: string | number;
};

Deno.serve(async (request) => {
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  if (!WORKFLOW_SECRET) return jsonResponse({ error: "Workflow secret is not configured" }, 503);
  if (!constantTimeEqual(request.headers.get("x-ai-suggestion-workflow-secret") ?? "", WORKFLOW_SECRET)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  try {
    const payload = await request.json() as FailureRequest;
    const runId = requiredUuid(payload.automation_run_id, "Invalid automation run identifier");
    const stage = limitedText(payload.stage, 100);
    const summary = limitedText(payload.summary, 2000) || "Workflow failed before completion";
    const workflowRunId = String(payload.workflow_run_id ?? "").trim();

    const { data: run, error: runError } = await admin
      .from("ag_site_feedback_automation_runs")
      .select("id,feedback_id,state")
      .eq("id", runId)
      .single();
    if (runError || !run) throw runError ?? new PublicError(404, "Automation run not found");

    const decision = classifySuggestionFailure(stage, run.state);
    if (decision.action === "reject") {
      throw new PublicError(400, "Failure stage must be assessment or implementation");
    }
    if (decision.action === "ignore") {
      return jsonResponse({
        ok: true,
        ignored: true,
        duplicate: decision.reason === "failure_already_recorded",
        automation_run_id: run.id,
        feedback_id: run.feedback_id,
        state: run.state,
        reason: decision.reason
      }, 200);
    }

    const now = new Date().toISOString();
    const { data: failedRun, error: updateRunError } = await admin
      .from("ag_site_feedback_automation_runs")
      .update({
        state: "failed",
        error_code: `workflow_${decision.stage}`,
        error_message: summary,
        github_workflow_run_id: /^\d+$/.test(workflowRunId) ? Number(workflowRunId) : null,
        completed_at: now,
        updated_at: now
      })
      .eq("id", run.id)
      .eq("state", run.state)
      .select("id")
      .maybeSingle();
    if (updateRunError) throw updateRunError;
    if (!failedRun) {
      return jsonResponse({
        ok: true,
        ignored: true,
        duplicate: false,
        automation_run_id: run.id,
        feedback_id: run.feedback_id,
        state: run.state,
        reason: "state_changed_before_failure_recorded"
      }, 200);
    }

    const { error: updateFeedbackError } = await admin
      .from("ag_site_feedback")
      .update({
        automation_status: "failed",
        automation_last_processed_at: now,
        automation_summary: summary
      })
      .eq("id", run.feedback_id);
    if (updateFeedbackError) throw updateFeedbackError;

    return jsonResponse({
      ok: true,
      automation_run_id: run.id,
      feedback_id: run.feedback_id,
      state: "failed",
      stage: decision.stage
    }, 200);
  } catch (error) {
    console.error("ai-suggestion-failure failed", error);
    const status = error instanceof PublicError ? error.status : 500;
    const message = error instanceof PublicError ? error.message : "Failure status could not be stored";
    return jsonResponse({ error: message }, status);
  }
});

function requiredUuid(value: unknown, message: string) {
  const text = String(value ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new PublicError(400, message);
  }
  return text;
}

function limitedText(value: unknown, maximum: number) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, maximum) : null;
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

import { createClient } from "npm:@supabase/supabase-js@2.110.2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WORKFLOW_SECRET = Deno.env.get("AI_SUGGESTION_WORKFLOW_SECRET") ?? "";

const DECISIONS = new Set([
  "implement",
  "approval_required",
  "clarification_required",
  "reject",
  "duplicate"
]);
const RISKS = new Set(["low", "moderate", "high", "protected"]);
const LANES = new Set(["A", "B", "C", "D"]);

type ResultRequest = {
  automation_run_id?: string;
  assessment?: Record<string, unknown>;
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
    const payload = await request.json() as ResultRequest;
    const runId = requiredUuid(payload.automation_run_id, "Invalid automation run identifier");
    const assessment = validateAssessment(payload.assessment);

    const { data: run, error: runError } = await admin
      .from("ag_site_feedback_automation_runs")
      .select("id,feedback_id,mode,state,target_repository,can_auto_implement")
      .eq("id", runId)
      .single();
    if (runError || !run) throw runError ?? new PublicError(404, "Automation run not found");
    if (!["assessing", "dispatched", "shadow_assessment_pending"].includes(run.state)) {
      throw new PublicError(409, `Assessment cannot be recorded from state ${run.state}`);
    }
    if (assessment.target_repository !== run.target_repository) {
      throw new PublicError(400, "Assessment repository does not match the server-routed repository");
    }

    const ownerAutomaticCandidate = run.can_auto_implement === true
      && assessment.decision === "implement"
      && assessment.risk_level === "low"
      && assessment.lane === "A";
    const plannedNonOwnerCandidate = run.can_auto_implement !== true
      && assessment.decision === "implement"
      && assessment.risk_level === "low"
      && assessment.lane === "A";
    const runState = plannedNonOwnerCandidate || assessment.decision === "approval_required"
      ? "approval_required"
      : assessment.decision === "clarification_required"
        || assessment.decision === "reject"
        || assessment.decision === "duplicate"
        ? "held"
        : "assessment_complete";
    const feedbackStatus = runState === "approval_required"
      ? "approval_required"
      : runState === "held"
        ? "held"
        : "assessment_complete";
    const now = new Date().toISOString();

    const { error: updateRunError } = await admin
      .from("ag_site_feedback_automation_runs")
      .update({
        state: runState,
        decision: assessment.decision,
        risk_level: assessment.risk_level,
        assessment,
        completed_at: now,
        updated_at: now,
        error_code: null,
        error_message: null
      })
      .eq("id", run.id);
    if (updateRunError) throw updateRunError;

    const { error: updateFeedbackError } = await admin
      .from("ag_site_feedback")
      .update({
        automation_status: feedbackStatus,
        automation_decision: assessment.decision,
        automation_risk_level: assessment.risk_level,
        automation_summary: assessment.summary,
        automation_last_processed_at: now,
        status: assessment.decision === "implement" || assessment.decision === "approval_required"
          ? "planned"
          : "reviewing"
      })
      .eq("id", run.feedback_id);
    if (updateFeedbackError) throw updateFeedbackError;

    const implementationDispatched = runState === "assessment_complete"
      && ownerAutomaticCandidate
      ? await dispatchImplementation(run.id)
      : false;

    return jsonResponse({
      ok: true,
      automation_run_id: run.id,
      feedback_id: run.feedback_id,
      state: runState,
      decision: assessment.decision,
      risk_level: assessment.risk_level,
      lane: assessment.lane,
      execution_authorized: false,
      implementation_dispatched: implementationDispatched
    }, 200);
  } catch (error) {
    console.error("ai-suggestion-result failed", error);
    const status = error instanceof PublicError ? error.status : 500;
    const message = error instanceof PublicError ? error.message : "Assessment result could not be stored";
    return jsonResponse({ error: message }, status);
  }
});

async function dispatchImplementation(runId: string) {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/ai-suggestion-implementation-dispatch`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ automation_run_id: runId })
    });
    if (response.ok) {
      const result = await response.json().catch(() => ({}));
      return result.dispatched === true;
    }
    console.error(
      "AI implementation dispatch rejected",
      response.status,
      (await response.text()).slice(0, 500)
    );
  } catch (error) {
    console.error("AI implementation dispatch failed", error);
  }
  return false;
}

function validateAssessment(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PublicError(400, "Assessment must be an object");
  }
  const assessment = value as Record<string, unknown>;
  const decision = String(assessment.decision ?? "");
  const riskLevel = String(assessment.risk_level ?? "");
  const lane = String(assessment.lane ?? "");
  const summary = limitedText(assessment.summary, 2000);
  const targetRepository = limitedText(assessment.target_repository, 300);
  if (!DECISIONS.has(decision)) throw new PublicError(400, "Assessment decision is invalid");
  if (!RISKS.has(riskLevel)) throw new PublicError(400, "Assessment risk level is invalid");
  if (!LANES.has(lane)) throw new PublicError(400, "Assessment lane is invalid");
  if (!summary) throw new PublicError(400, "Assessment summary is required");
  if (!targetRepository) throw new PublicError(400, "Assessment target repository is required");

  const execution = assessment.execution_authority;
  if (!execution || typeof execution !== "object" || Array.isArray(execution)) {
    throw new PublicError(400, "Execution authority is required");
  }
  const authority = execution as Record<string, unknown>;
  for (const field of ["may_edit_repository", "may_create_pull_request", "may_merge", "may_deploy"]) {
    if (authority[field] !== false) {
      throw new PublicError(400, `Shadow assessment must keep ${field} false`);
    }
  }

  const serialized = JSON.stringify(assessment);
  if (serialized.length > 100000) throw new PublicError(413, "Assessment is too large");
  return { ...assessment, decision, risk_level: riskLevel, lane, summary, target_repository: targetRepository };
}

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

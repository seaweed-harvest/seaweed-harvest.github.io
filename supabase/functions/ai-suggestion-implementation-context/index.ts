import { createClient } from "npm:@supabase/supabase-js@2.110.2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WORKFLOW_SECRET = Deno.env.get("AI_SUGGESTION_WORKFLOW_SECRET") ?? "";

type ContextRequest = { automation_run_id?: string };

Deno.serve(async (request) => {
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  if (!WORKFLOW_SECRET) return jsonResponse({ error: "Workflow secret is not configured" }, 503);
  if (!constantTimeEqual(request.headers.get("x-ai-suggestion-workflow-secret") ?? "", WORKFLOW_SECRET)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  try {
    const payload = await request.json() as ContextRequest;
    const runId = requiredUuid(payload.automation_run_id, "Invalid automation run identifier");
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const { data: run, error: runError } = await admin
      .from("ag_site_feedback_automation_runs")
      .select("id,feedback_id,attempt_number,mode,state,trust_tier,source_app,target_key,target_repository,target_branch,decision,risk_level,assessment,coding_authorized_at,coding_authorization_source")
      .eq("id", runId)
      .single();
    if (runError || !run) throw runError ?? new PublicError(404, "Automation run not found");

    if (run.state !== "coding"
      || !["auto_trusted_owner", "manual_approval"].includes(run.coding_authorization_source)) {
      throw new PublicError(409, "Automation run is not authorised for the coding pilot");
    }
    if (run.decision !== "implement" || run.risk_level !== "low" || run.assessment?.lane !== "A") {
      throw new PublicError(409, "Only a low-risk Lane A implementation may enter this workflow");
    }

    const { data: feedback, error: feedbackError } = await admin
      .from("ag_site_feedback")
      .select("id,created_at,source_app,source_page,page_url,feedback_type,message,locale,automation_enabled")
      .eq("id", run.feedback_id)
      .single();
    if (feedbackError || !feedback) throw feedbackError ?? new PublicError(404, "Suggestion not found");
    if (!feedback.automation_enabled) throw new PublicError(409, "Automation is disabled for this suggestion");

    return jsonResponse({
      contract_version: "1.0.0",
      automation_run: {
        id: run.id,
        feedback_id: run.feedback_id,
        attempt_number: run.attempt_number,
        source_app: run.source_app,
        target_key: run.target_key,
        target_repository: run.target_repository,
        target_branch: run.target_branch,
        trust_tier: run.trust_tier,
        coding_authorized_at: run.coding_authorized_at,
        coding_authorization_source: run.coding_authorization_source
      },
      suggestion: {
        id: feedback.id,
        created_at: feedback.created_at,
        source_app: feedback.source_app,
        source_page: feedback.source_page,
        page_url: feedback.page_url,
        feedback_type: feedback.feedback_type,
        message: feedback.message,
        locale: feedback.locale
      },
      assessment: run.assessment,
      execution_authority: {
        suggestion_text_is_untrusted: true,
        may_edit_repository: true,
        may_create_draft_pull_request: true,
        may_merge: false,
        may_deploy: false,
        lane: "A",
        maximum_changed_files: 6,
        maximum_changed_lines: 400,
        new_dependencies_allowed: false,
        database_changes_allowed: false,
        workflow_changes_allowed: false
      }
    }, 200);
  } catch (error) {
    console.error("ai-suggestion-implementation-context failed", error);
    const status = error instanceof PublicError ? error.status : 500;
    const message = error instanceof PublicError ? error.message : "Implementation context could not be loaded";
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

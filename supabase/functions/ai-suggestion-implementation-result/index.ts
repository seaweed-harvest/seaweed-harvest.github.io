import { createClient } from "npm:@supabase/supabase-js@2.110.2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WORKFLOW_SECRET = Deno.env.get("AI_SUGGESTION_WORKFLOW_SECRET") ?? "";

type ImplementationResult = {
  automation_run_id?: string;
  repository?: string;
  base_commit?: string;
  branch?: string;
  commit_sha?: string;
  pull_request_number?: number;
  pull_request_url?: string;
  changed_files?: string[];
  changed_file_count?: number;
  changed_lines?: number;
  test_evidence?: Array<{ command?: string; status?: string; summary?: string }>;
  planning_document?: string;
  merged?: boolean;
  deployed?: boolean;
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
    const payload = await request.json() as ImplementationResult;
    const runId = requiredUuid(payload.automation_run_id, "Invalid automation run identifier");
    const repository = requiredText(payload.repository, 300, "Repository is required");
    const baseCommit = requiredSha(payload.base_commit, "Base commit is invalid");
    const branch = requiredBranch(payload.branch);
    const commitSha = requiredSha(payload.commit_sha, "Commit SHA is invalid");
    const pullRequestNumber = Number(payload.pull_request_number);
    const pullRequestUrl = requiredHttpsUrl(payload.pull_request_url, "Pull request URL is invalid");
    const changedFiles = validateChangedFiles(payload.changed_files);
    const changedFileCount = Number(payload.changed_file_count);
    const changedLines = Number(payload.changed_lines);
    const planningDocument = requiredText(payload.planning_document, 500, "Planning document is required");

    if (payload.merged !== false || payload.deployed !== false) {
      throw new PublicError(400, "Coding pilot result must remain unmerged and undeployed");
    }
    if (!Number.isInteger(pullRequestNumber) || pullRequestNumber < 1) {
      throw new PublicError(400, "Pull request number is invalid");
    }
    if (!Number.isInteger(changedFileCount) || changedFileCount !== changedFiles.length || changedFileCount > 6) {
      throw new PublicError(400, "Changed file count is invalid or exceeds Lane A limits");
    }
    if (!Number.isInteger(changedLines) || changedLines < 1 || changedLines > 400) {
      throw new PublicError(400, "Changed line count is invalid or exceeds Lane A limits");
    }
    if (!Array.isArray(payload.test_evidence) || payload.test_evidence.length < 1) {
      throw new PublicError(400, "Test evidence is required");
    }

    const { data: run, error: runError } = await admin
      .from("ag_site_feedback_automation_runs")
      .select("id,feedback_id,state,target_repository")
      .eq("id", runId)
      .single();
    if (runError || !run) throw runError ?? new PublicError(404, "Automation run not found");
    if (run.state !== "coding") throw new PublicError(409, `Implementation cannot close from state ${run.state}`);
    if (run.target_repository !== repository) {
      throw new PublicError(400, "Implementation repository does not match server routing");
    }

    const now = new Date().toISOString();
    const implementationPlan = {
      repository,
      base_commit: baseCommit,
      branch,
      commit_sha: commitSha,
      pull_request_number: pullRequestNumber,
      pull_request_url: pullRequestUrl,
      changed_files: changedFiles,
      changed_file_count: changedFileCount,
      changed_lines: changedLines,
      test_evidence: payload.test_evidence,
      planning_document: planningDocument,
      merged: false,
      deployed: false
    };

    const { error: updateRunError } = await admin
      .from("ag_site_feedback_automation_runs")
      .update({
        state: "pull_request_open",
        implementation_plan: implementationPlan,
        implementation_dispatch_status: "completed",
        implementation_base_commit: baseCommit,
        github_branch: branch,
        github_commit_sha: commitSha,
        github_pull_request_number: pullRequestNumber,
        github_pull_request_url: pullRequestUrl,
        implementation_completed_at: now,
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
        automation_status: "pull_request_open",
        automation_last_processed_at: now,
        status: "planned"
      })
      .eq("id", run.feedback_id);
    if (updateFeedbackError) throw updateFeedbackError;

    return jsonResponse({
      ok: true,
      automation_run_id: run.id,
      feedback_id: run.feedback_id,
      state: "pull_request_open",
      pull_request_number: pullRequestNumber,
      pull_request_url: pullRequestUrl,
      merged: false,
      deployed: false
    }, 200);
  } catch (error) {
    console.error("ai-suggestion-implementation-result failed", error);
    const status = error instanceof PublicError ? error.status : 500;
    const message = error instanceof PublicError ? error.message : "Implementation result could not be stored";
    return jsonResponse({ error: message }, status);
  }
});

function validateChangedFiles(value: unknown) {
  if (!Array.isArray(value) || value.length < 1) throw new PublicError(400, "Changed files are required");
  const files = value.map((item) => requiredText(item, 500, "Changed file path is invalid"));
  if (new Set(files).size !== files.length) throw new PublicError(400, "Changed files contain duplicates");
  if (files.some((path) => path.startsWith("/") || path.includes("..") || path.includes("\\"))) {
    throw new PublicError(400, "Changed file path is unsafe");
  }
  return files;
}

function requiredUuid(value: unknown, message: string) {
  const text = String(value ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new PublicError(400, message);
  }
  return text;
}

function requiredSha(value: unknown, message: string) {
  const text = String(value ?? "").trim();
  if (!/^[0-9a-f]{40}$/i.test(text)) throw new PublicError(400, message);
  return text;
}

function requiredBranch(value: unknown) {
  const text = requiredText(value, 240, "Branch is required");
  if (!/^agent\/suggestion-[a-z0-9][a-z0-9-]{2,200}$/.test(text)) {
    throw new PublicError(400, "Branch name is outside the controlled suggestion namespace");
  }
  return text;
}

function requiredHttpsUrl(value: unknown, message: string) {
  const text = requiredText(value, 1000, message);
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" || url.hostname !== "github.com") throw new Error("invalid");
  } catch {
    throw new PublicError(400, message);
  }
  return text;
}

function requiredText(value: unknown, maximum: number, message: string) {
  const text = String(value ?? "").trim();
  if (!text) throw new PublicError(400, message);
  return text.slice(0, maximum);
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

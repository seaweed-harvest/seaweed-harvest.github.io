from __future__ import annotations

import json
import pathlib


ROOT = pathlib.Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def main() -> None:
    migration = read(
        "supabase/migrations/20260728120000_authenticated_suggestion_automation.sql"
    )
    migration_flat = " ".join(migration.split())
    dispatch = read("supabase/functions/ai-suggestion-implementation-dispatch/index.ts")
    context = read("supabase/functions/ai-suggestion-implementation-context/index.ts")
    result = read("supabase/functions/ai-suggestion-implementation-result/index.ts")
    failure = read("supabase/functions/ai-suggestion-failure/index.ts")
    failure_policy = read(
        "supabase/functions/_shared/ai_suggestion_failure_policy.ts"
    )
    workflow = read(".github/workflows/ai-suggestion-implementation.yml")
    assessment_workflow = read(".github/workflows/ai-suggestion-assessment.yml")
    prompt = read(".github/codex/prompts/implement-suggestion.md")
    diff_validator = read("scripts/validate_ai_suggestion_diff.py")
    check_runner = read("scripts/run_ai_suggestion_checks.py")
    pilot = json.loads(read(".automation/coding-pilot.yml"))

    assert pilot["mode"] == "owner_low_risk_draft_pr"
    assert pilot["activation"]["both_required"] is True
    assert pilot["eligibility"]["risk_level"] == "low"
    assert pilot["eligibility"]["lane"] == "A"
    assert pilot["eligibility"]["automatic_authorization_source"] == (
        "authenticated_trusted_product_owner_uuid"
    )
    assert pilot["eligibility"]["manual_authorization_source"] == (
        "explicit_trusted_product_owner_uuid_approval"
    )
    assert pilot["deduplication"]["primary_key"] == "suggestion_uuid"
    assert (
        pilot["deduplication"][
            "stale_failure_callback_cannot_replace_completed_state"
        ]
        is True
    )
    assert pilot["limits"]["maximum_changed_files"] == 6
    assert pilot["limits"]["maximum_changed_lines"] == 400
    assert pilot["allowed_outcome"]["pull_request_state"] == "draft"
    assert pilot["allowed_outcome"]["merge_authorized"] is False
    assert pilot["allowed_outcome"]["deployment_authorized"] is False

    assert "ag_authorize_site_feedback_coding" in migration
    assert "risk_level <> 'low'" in migration
    assert "v_lane <> 'A'" in migration
    assert "trusted_product_owner" in migration
    assert "can_auto_implement" in migration
    assert "v_authorization_source := 'auto_trusted_owner'" in migration
    assert "v_authorization_source := 'manual_approval'" in migration
    assert "ag_owner_approve_suggestion_implementation" in migration
    assert "public.ag_is_trusted_product_owner(v_run.actor_user_id)" in migration
    assert "'may_merge', false" in migration
    assert "'may_deploy', false" in migration
    assert (
        "grant execute on function public.ag_authorize_site_feedback_coding(uuid) "
        "to service_role"
    ) in migration_flat

    assert "AI_SUGGESTION_CODING_PILOT_MODE" in dispatch
    assert 'new Set(["disabled", "dispatch"])' in dispatch
    assert 'event_type: "ai-suggestion-implementation"' in dispatch
    assert "ag_authorize_site_feedback_coding" in dispatch
    dispatch_payload = dispatch[dispatch.index("event_type:"):dispatch.index("if (!dispatch.ok)")]
    assert "message" not in dispatch_payload

    assert 'run.state !== "coding"' in context
    assert '["auto_trusted_owner", "manual_approval"]' in context
    assert 'run.risk_level !== "low"' in context
    assert 'run.assessment?.lane !== "A"' in context
    assert "may_edit_repository: true" in context
    assert "may_create_draft_pull_request: true" in context
    assert "may_merge: false" in context
    assert "may_deploy: false" in context
    assert "submitter_email" not in context
    assert "submitter_name" not in context

    assert "merged !== false" in result
    assert "deployed !== false" in result
    assert "changedFileCount > 6" in result
    assert "changedLines > 400" in result
    assert 'state: "pull_request_open"' in result
    assert "github_pull_request_url" in result

    assert "AI_SUGGESTION_CODING_PILOT_ENABLED" in workflow
    assert "contents: write" in workflow
    assert "pull-requests: write" in workflow
    assert "persist-credentials: false" in workflow
    assert "openai/codex-action@v1" in workflow
    assert "scripts/validate_ai_suggestion_diff.py" in workflow
    assert "scripts/run_ai_suggestion_checks.py" in workflow
    assert "git push" in workflow
    assert "gh pr create" in workflow
    assert "--draft" in workflow
    assert 'BRANCH_NAME="agent/suggestion-${SUGGESTION_ID:0:12}"' in workflow
    assert "Stop if a branch or pull request already exists" in workflow
    assert "ai-suggestion-implementation-result" in workflow
    assert "ai-suggestion-failure" in workflow
    for prohibited in (
        "gh pr merge",
        "merge_pull_request",
        "supabase db push",
        "supabase functions deploy",
        "actions/create-deployment",
        "kubectl",
        "terraform apply",
    ):
        assert prohibited not in workflow

    assert "ai-suggestion-failure" in assessment_workflow
    assert "Do not" in prompt
    assert "create commits, push, create a pull request, merge or deploy" in prompt
    assert "at least one deterministic static or unit test" in prompt
    assert "maximum_changed_files" in context

    assert '"git", "ls-files", "--others", "--exclude-standard"' in diff_validator
    assert "RUNTIME_ARTIFACTS" in diff_validator
    assert "Lane A permits at most 6 files" in diff_validator
    assert "Lane A permits at most 400 changed lines" in diff_validator
    assert "must add or update a deterministic test" in diff_validator
    assert 'planning_document not in files' in diff_validator
    assert "Binary change is not allowed" in diff_validator

    assert "node" in check_runner
    assert "py_compile" in check_runner
    assert "changed_tests" in check_runner
    assert '"status": "passed" if result.returncode == 0 else "failed"' in check_runner

    assert 'automation_status: "failed"' in failure
    assert "error_message: summary" in failure
    assert "classifySuggestionFailure" in failure
    assert '.eq("state", run.state)' in failure
    mutable_states = failure_policy[
        failure_policy.index("const MUTABLE_STATES"):
        failure_policy.index("export function")
    ]
    for completed_state in (
        "assessment_complete",
        "approval_required",
        "held",
        "pull_request_open",
        "merged",
        "deploying",
        "deployed",
        "cancelled",
    ):
        assert completed_state not in mutable_states
    assert 'reason: "stale_or_completed_callback"' in failure_policy
    assert 'reason: "failure_already_recorded"' in failure_policy

    print(
        "PASS: controlled coding lane is owner-UUID or owner-approval authorised, "
        "deduplicated, diff-limited, test-gated, draft-PR only, and unable to merge or deploy"
    )


if __name__ == "__main__":
    main()

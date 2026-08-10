from __future__ import annotations

import pathlib
import re


ROOT = pathlib.Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def main() -> None:
    migration = read(
        "supabase/migrations/20260726143000_ai_suggestion_automation_foundation.sql"
    )
    authenticated_automation = read(
        "supabase/migrations/20260728120000_authenticated_suggestion_automation.sql"
    )
    repaired_routing = read(
        "supabase/migrations/20260810100000_repair_ai_suggestion_routing.sql"
    )
    site_feedback = read("supabase/functions/site-feedback/index.ts")
    dispatch = read("supabase/functions/ai-suggestion-dispatch/index.ts")
    context = read("supabase/functions/ai-suggestion-context/index.ts")
    result = read("supabase/functions/ai-suggestion-result/index.ts")
    workflow = read(".github/workflows/ai-suggestion-assessment.yml")
    prompt = read(".github/codex/prompts/assess-suggestion.md")
    validator = read("scripts/validate_ai_suggestion_assessment.py")

    for table in (
        "ag_ai_automation_actors",
        "ag_site_feedback_automation_runs",
    ):
        assert f"create table if not exists public.{table}" in migration
        assert f"alter table public.{table} enable row level security" in migration
        assert f"revoke all on table public.{table} from anon, authenticated" in migration

    assert "ag_create_site_feedback_automation_run" in migration
    assert "security definer" in migration.lower()
    assert "grant execute" in migration
    assert "'green_space'" in migration
    assert "seaweed-harvest/seaweed-harvest.github.io" in repaired_routing
    assert "bosunjm-cloud/Seaweed_Tide_App" in migration
    assert "Authenticated suggestion record is required" in authenticated_automation
    assert "trust_tier = 'trusted_product_owner'" in authenticated_automation
    assert "can_auto_merge" in authenticated_automation
    assert "bmichael@cascadiaseaweed.com" in authenticated_automation
    assert "new.submitter_user_id is null" in authenticated_automation
    assert "new.automation_enabled := true" in authenticated_automation
    assert "v_can_auto_plan boolean := true" in authenticated_automation
    assert "v_can_auto_implement boolean := false" in authenticated_automation
    assert "return v_existing.id" in authenticated_automation
    assert "ag_claim_site_feedback_assessment_dispatch" in authenticated_automation
    assert "github_dispatch_status = 'claiming'" in authenticated_automation
    assert "automation_paused" in repaired_routing
    assert "state in ('shadow_assessment_pending', 'held', 'failed', 'cancelled')" in repaired_routing

    assert 'source_app: "aggregation" | "green_space" | "tide"' in site_feedback
    assert '["aggregation", "green_space", "tide"]' in site_feedback
    assert 'payload.source_app === "green_space"' in site_feedback
    assert '"Green Space Log"' in site_feedback
    assert "trustedOwnerEnabled" in site_feedback
    assert "dispatchAuthenticatedSuggestion(feedback.id)" in site_feedback
    assert 'raw?.action === "retry_assessment"' in site_feedback
    assert "seaweed-harvest/seaweed-harvest.github.io" in site_feedback
    assert "SEAWEED_OWNER_SUGGESTION" in site_feedback
    assert "ai_assist_requested" not in site_feedback
    assert 'reason: "authenticated_automation_not_enabled"' in dispatch
    assert "existing_task_thread_branch_or_pull_request" in dispatch
    assert "assessment_dispatch_already_claimed" in dispatch
    assert "ag_claim_site_feedback_assessment_dispatch" in dispatch
    assert "dispatchImplementation(run.id)" in result
    assert 'automation_status: "failed"' in dispatch
    assert 'automation_status: "held"' in dispatch
    implementation_dispatch = read(
        "supabase/functions/ai-suggestion-implementation-dispatch/index.ts"
    )
    assert 'state: "failed"' in implementation_dispatch
    assert 'automation_status: "failed"' in implementation_dispatch

    for source in (dispatch, context, result):
        assert "SUPABASE_SERVICE_ROLE_KEY" in source
        assert "constantTimeEqual" in source
        assert "Cache-Control" in source
        source_without_expected_key_names = (
            source.lower()
            .replace("supabase_service_role_key", "")
            .replace("service_role_key", "")
        )
        assert "service_role" not in source_without_expected_key_names

    assert "AI_SUGGESTION_AUTOMATION_MODE" in dispatch
    assert 'new Set(["shadow", "dispatch"])' in dispatch
    assert '"Authorization": `Bearer ${SERVICE_ROLE_KEY}`' in site_feedback
    assert "AI_SUGGESTION_WEBHOOK_SECRET" not in dispatch
    assert 'event_type: "ai-suggestion-assessment"' in dispatch
    assert "suggestion_id" in dispatch
    assert "automation_run_id" in dispatch
    assert "message" not in re.search(
        r"const dispatchPayload = \{.*?\n    \};",
        dispatch,
        flags=re.DOTALL,
    ).group(0)

    assert "suggestion_text_is_untrusted: true" in context
    assert "may_edit_repository: false" in context
    assert "submitter_email" not in context
    assert "submitter_name" not in context

    for field in (
        "may_edit_repository",
        "may_create_pull_request",
        "may_merge",
        "may_deploy",
    ):
        assert f'authority[field] !== false' in result
        assert field in prompt
        assert field in validator

    assert "repository_dispatch" in workflow
    assert "openai/codex-action@v1" in workflow
    assert "persist-credentials: false" in workflow
    assert "contents: read" in workflow
    assert "AI_SUGGESTION_ASSESSMENT_ENABLED" in workflow
    assert "AI_SUGGESTION_WORKFLOW_SECRET" in workflow
    assert "OPENAI_API_KEY" in workflow
    assert "scripts/validate_ai_suggestion_assessment.py" in workflow
    assert "ai-suggestion-context" in workflow
    assert "ai-suggestion-result" in workflow
    assert "git push" not in workflow
    assert "pull-requests: write" not in workflow
    assert "contents: write" not in workflow

    assert "untrusted user-supplied data" in prompt
    assert "Do not implement code" in prompt
    assert "automation-output/assessment.json" in prompt

    print(
        "PASS: authenticated suggestion intake uses UUID authority, idempotent runs, "
        "sanitised assessment dispatch and no merge or deployment authority"
    )


if __name__ == "__main__":
    main()

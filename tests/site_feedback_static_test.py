from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WIDGET = ROOT / "assets" / "js" / "site_feedback.js"
ADMIN = ROOT / "assets" / "js" / "admin_suggestions.js"
FUNCTION = ROOT / "supabase" / "functions" / "site-feedback" / "index.ts"
SLACK_CODEX = ROOT / "supabase" / "functions" / "_shared" / "slack_codex.ts"
MIGRATION = ROOT / "supabase" / "migrations" / (
    "20260728120000_authenticated_suggestion_automation.sql"
)


def test_feedback_widget_is_loaded_from_shared_config():
    config = (ROOT / "assets" / "js" / "config.js").read_text(encoding="utf-8")
    assert 'import "./site_feedback.js?v=8";' in config


def test_feedback_widget_is_accessible_bilingual_offline_safe_and_toggle_free():
    source = WIDGET.read_text(encoding="utf-8")
    for expected in (
        'aria-label="${copy.button}"',
        'role="status"',
        "Better ideas start with a question.",
        "Mawazo bora huanza na swali.",
        "enqueueFeedback(payload)",
        'window.addEventListener("online"',
        "submission_id",
        "PHOTO_TARGET_BYTES = 550 * 1024",
        "photo_data_url: photoDataUrl",
        '<input name="feedbackPhoto" type="file" accept="image/*">',
    ):
        assert expected in source
    for removed in (
        "ai_assist_requested",
        'input name="aiAssist"',
        "AI_ASSIST_OWNER_EMAIL",
        "site-feedback-ai-assist",
    ):
        assert removed not in source
    assert 'capture="environment"' not in source


def test_feedback_backend_uses_authenticated_uuid_authority_and_dispatches():
    function = FUNCTION.read_text(encoding="utf-8")
    function_flat = " ".join(function.split())
    slack_codex = SLACK_CODEX.read_text(encoding="utf-8")
    migration = MIGRATION.read_text(encoding="utf-8")

    assert "AGGREGATION_SLACK_WEBHOOK_URL" in function
    assert '.eq("client_submission_id"' in function
    assert "RATE_LIMIT_COUNT" in function
    assert 'const PHOTO_BUCKET = "site-feedback-photos"' in function
    assert "decodePhoto(payload.photo_data_url)" in function
    assert (
        "trustedOwnerEnabled( admin, identity.userId, payload.source_app )"
        in function_flat
    )
    trusted_owner_helper = function[
        function.index("async function trustedOwnerEnabled"):
        function.index("async function authenticatedIdentity")
    ]
    assert "email" not in trusted_owner_helper
    assert "dispatchAuthenticatedSuggestion(feedback.id)" in function
    assert '"Authorization": `Bearer ${SERVICE_ROLE_KEY}`' in function
    assert "SEAWEED_OWNER_SUGGESTION" in function
    assert 'Deno.env.get("CODEX_SLACK_USER_ID")' in function
    assert "return slackUserMention(CODEX_SLACK_USER_ID)" in function
    assert '"@Codex"' not in function
    assert "/^[UW][A-Z0-9]{8,}$/" in slack_codex

    assert "ag_prepare_site_feedback_automation" in migration
    assert "new.submitter_user_id is null" in migration
    assert "new.automation_enabled := true" in migration
    assert "public.ag_is_trusted_product_owner(new.submitter_user_id)" in migration
    assert "ag_create_site_feedback_automation_run" in migration
    assert "ag_claim_site_feedback_assessment_dispatch" in migration
    assert "github_dispatch_status = 'claiming'" in migration
    assert "return v_existing.id" in migration
    assert "slack_thread_ts" in migration
    assert "external_task_url" in migration
    assert "github_branch" in migration
    assert "github_pull_request_url" in migration


def test_feedback_workspace_supports_owner_actions_without_email_authority():
    script = ADMIN.read_text(encoding="utf-8")
    function = FUNCTION.read_text(encoding="utf-8")
    migration = MIGRATION.read_text(encoding="utf-8")

    assert "OWNER_EMAIL" not in script
    assert "AI Assist" not in script
    assert "data-queue-chatgpt-assist" not in script
    assert "data-approve-suggestion-implementation" in script
    assert 'action: "approve_implementation"' in script
    assert 'action: "retry_assessment"' in script
    assert "Retry AI review" in script
    assert "Approve implementation" in script
    assert "Open draft pull request" in script
    assert "Workflow:" in script

    assert 'raw?.action === "delete"' in function
    assert 'raw?.action === "approve_implementation"' in function
    assert 'raw?.action === "retry_assessment"' in function
    assert "Only the trusted product owner can delete suggestions." in function
    assert "ag_owner_approve_suggestion_implementation" in function
    assert 'action: "site_suggestion_implementation_approved"' in function
    assert 'action: "site_suggestion_ai_review_retried"' in function
    assert "OWNER_EMAIL" not in function

    assert "ag_is_current_user_trusted_product_owner()" in migration
    assert (
        "grant execute on function public.ag_is_trusted_product_owner(uuid) "
        "to authenticated"
    ) not in " ".join(migration.split())
    assert "Suggestions workspace is available only to the trusted product owner." in migration
    assert "implementation_approved_by" in migration
    assert "implementation_approved_at" in migration
    assert "'manual_approval'" in migration
    assert "'may_merge', false" in migration
    assert "'may_deploy', false" in migration


if __name__ == "__main__":
    test_feedback_widget_is_loaded_from_shared_config()
    test_feedback_widget_is_accessible_bilingual_offline_safe_and_toggle_free()
    test_feedback_backend_uses_authenticated_uuid_authority_and_dispatches()
    test_feedback_workspace_supports_owner_actions_without_email_authority()
    print("site feedback static checks passed")

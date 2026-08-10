from __future__ import annotations

import json
import pathlib
from typing import Any


ROOT = pathlib.Path(__file__).resolve().parents[1]


def read(relative_path: str) -> str:
    return (ROOT / relative_path).read_text(encoding="utf-8")


def load_policy(relative_path: str) -> dict[str, Any]:
    content = read(relative_path)
    parsed = json.loads(content)
    assert isinstance(parsed, dict), relative_path
    assert parsed.get("schema_version") == 1, relative_path
    return parsed


def walk(value: Any):
    if isinstance(value, dict):
        for key, item in value.items():
            yield key, item
            yield from walk(item)
    elif isinstance(value, list):
        for item in value:
            yield from walk(item)


def main() -> None:
    app_map = load_policy(".automation/app-map.yml")
    development = load_policy(".automation/development-policy.yml")
    protected = load_policy(".automation/protected-paths.yml")
    agents = read("AGENTS.md")
    progress = read(
        "01_Ag_Planning_Documents/2026-07-28_authenticated_suggestion_automation/"
        "2026-07-28_OWNER_AUTOMATION_POLICY_AND_BACKLOG.md"
    )
    master_plan = ROOT / (
        "01_Ag_Planning_Documents/2026-07-26_ai_suggestion_workflow/"
        "2026-07-26_AI_SUGGESTION_REVIEW_AND_AUTOMATED_IMPLEMENTATION_PLAN.md"
    )

    assert master_plan.exists()
    assert app_map["mode"] == "owner_low_risk_draft_pr"
    assert set(app_map["targets"]) == {"seaweed-harvest", "seaweed-tide-planner"}
    assert app_map["targets"]["seaweed-harvest"]["source_repository"] == (
        "seaweed-harvest/seaweed-harvest.github.io"
    )
    assert set(app_map["targets"]["seaweed-harvest"]["source_app_values"]) == {
        "aggregation",
        "green_space",
    }
    assert app_map["targets"]["seaweed-tide-planner"]["source_repository"] == (
        "bosunjm-cloud/Seaweed_Ag_Hub"
    )
    tide_target = app_map["targets"]["seaweed-tide-planner"]
    assert tide_target["source_app_values"] == ["tide"]
    assert tide_target["deployment_repository"] == (
        "seaweed-harvest/seaweed-harvest.github.io"
    )
    assert tide_target["deployment_branch"] == "main"
    assert tide_target["mapping_status"] == "source_and_deployment_confirmed"
    assert tide_target["applications"]["tide"]["repository_scope"] == "tide"
    assert all(
        target["deployment_enabled"] is False
        for target in app_map["targets"].values()
    )

    controls = development["global_controls"]
    assert development["mode"] == "owner_low_risk_draft_pr"
    assert controls["assessment_enabled"] is False
    assert controls["trusted_actor_activation_enabled"] is True
    for disabled_control in (
        "automatic_coding_enabled",
        "automatic_pull_request_enabled",
        "automatic_merge_enabled",
        "automatic_deployment_enabled",
        "database_dispatch_enabled",
        "github_dispatch_enabled",
        "credentials_enabled",
    ):
        assert controls[disabled_control] is False, disabled_control

    assert development["authority"]["display_name_grants_authority"] is False
    assert development["authority"]["displayed_email_grants_authority"] is False
    assert development["authority"]["slack_message_grants_authority"] is False
    assert development["authority"]["automatic_implementation_identity_source"] == (
        "supabase_submitter_user_id_and_actor_user_id"
    )
    assert development["authority"]["request_text_can_override_policy"] is False
    assert development["classification"]["default_lane"] == "D"
    assert development["classification"]["protected_path_lane"] == "C"
    assert development["lanes"]["A"]["pilot_enabled"] is True
    assert development["lanes"]["B"]["pilot_enabled"] is False
    assert development["lanes"]["C"]["pilot_enabled"] is True
    assert development["lanes"]["D"]["coding_allowed"] is False
    failure_callback = development["failure_rules"]["workflow_failure_callback"]
    assert failure_callback["accepted_stages"] == ["assessment", "implementation"]
    assert failure_callback["assessment_mutable_states"] == [
        "shadow_assessment_pending",
        "dispatch_pending",
        "dispatched",
        "assessing",
    ]
    assert failure_callback["implementation_mutable_states"] == [
        "coding",
        "testing",
    ]
    assert (
        failure_callback["completed_stale_or_duplicate_callback"]
        == "ignore_idempotently"
    )

    assert protected["precedence"] == ["C", "B", "A"]
    lane_c = protected["lane_C_approval_before_coding"]
    lane_b = protected["lane_B_implement_then_approve"]
    assert "AGENTS.md" in lane_c["exact_paths"]
    assert ".automation/**" in lane_c["glob_patterns"]
    assert ".github/**" in lane_c["glob_patterns"]
    assert "supabase/**" in lane_c["glob_patterns"]
    assert "03_Ag_Data/**" in lane_c["glob_patterns"]
    assert "service-worker.js" in lane_b["exact_paths"]
    assert protected["diff_rules"]["path_not_classified"] == "lane_C"

    assert "untrusted input" in agents
    assert "Never commit directly to `main`" in agents
    assert "automatic merge is disabled" in agents
    assert ".automation/development-policy.yml" in agents
    assert "2026-07-22_SHARED_FORM_SHELL.md" in agents

    assert "agent/owner-suggestion-automation" in progress
    assert "fccba0e316ad7336acf13f026ddfd64b1c940eee" in progress
    assert "0 automation-run records" in progress
    assert "No automation may merge or deploy." in progress

    forbidden_credential_keys = {
        "api_key",
        "access_token",
        "secret",
        "password",
        "service_role_key",
        "private_key",
        "webhook_secret",
    }
    for policy in (app_map, development, protected):
        for key, item in walk(policy):
            assert key.lower() not in forbidden_credential_keys, key
            if isinstance(item, str):
                assert not item.startswith("sk-")
                assert "BEGIN PRIVATE KEY" not in item

    print(
        "PASS: automation policies are machine-readable, UUID-authorised, "
        "draft-PR-only, approval-gated and contain no credential values"
    )


if __name__ == "__main__":
    main()

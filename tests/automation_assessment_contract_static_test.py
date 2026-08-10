from __future__ import annotations

import fnmatch
import json
import pathlib
import re
from typing import Any


ROOT = pathlib.Path(__file__).resolve().parents[1]
SCHEMAS = ROOT / ".automation/schemas"
EXAMPLES = ROOT / ".automation/examples"


def load(path: pathlib.Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    assert isinstance(value, dict), path
    return value


def all_disabled(automation: dict[str, Any]) -> bool:
    return automation == {
        "coding_authorized": False,
        "pull_request_authorized": False,
        "merge_authorized": False,
        "deployment_authorized": False,
    }


def matches_any(path: str, patterns: list[str]) -> bool:
    return any(fnmatch.fnmatch(path, pattern) for pattern in patterns)


def main() -> None:
    assessment_schema = load(SCHEMAS / "suggestion-assessment.schema.json")
    plan_schema = load(SCHEMAS / "implementation-plan.schema.json")
    app_map = load(ROOT / ".automation/app-map.yml")
    policy = load(ROOT / ".automation/development-policy.yml")
    protected = load(ROOT / ".automation/protected-paths.yml")

    assert assessment_schema["$schema"].endswith("2020-12/schema")
    assert plan_schema["$schema"].endswith("2020-12/schema")
    assert assessment_schema["additionalProperties"] is False
    assert plan_schema["additionalProperties"] is False
    assert set(assessment_schema["properties"]["risk_lane"]["enum"]) == {
        "A",
        "B",
        "C",
        "D",
    }
    assert set(assessment_schema["properties"]["outcome"]["enum"]) == {
        "implementation_candidate",
        "approval_required",
        "plan_only",
        "clarification_required",
        "duplicate",
        "rejected",
    }
    for schema in (assessment_schema, plan_schema):
        automation_properties = schema["properties"]["automation"]["properties"]
        assert all(
            definition.get("const") is False
            for definition in automation_properties.values()
        )

    assessments = {
        path.stem: load(path)
        for path in sorted(EXAMPLES.glob("assessment-*.json"))
    }
    assert set(assessments) == {
        "assessment-clarification-required",
        "assessment-duplicate",
        "assessment-low-risk-ui",
        "assessment-protected-auth",
    }

    target_map = app_map["targets"]
    lane_c = protected["lane_C_approval_before_coding"]
    lane_b = protected["lane_B_implement_then_approve"]
    lane_c_patterns = lane_c["glob_patterns"] + lane_c["exact_paths"]
    lane_b_patterns = lane_b["glob_patterns"] + lane_b["exact_paths"]

    for name, assessment in assessments.items():
        assert assessment["schema_version"] == 1, name
        assert assessment["mode"] == "shadow", name
        assert re.fullmatch(r"ASMT-[A-Z0-9][A-Z0-9._-]{5,79}", assessment["assessment_id"]), name
        assert assessment["risk_lane"] in {"A", "B", "C", "D"}, name
        assert 0 <= assessment["confidence"] <= 1, name
        assert assessment["classification_reasons"], name
        assert all_disabled(assessment["automation"]), name
        assert assessment["policy_version"] == policy["policy_version"], name

        target_key = assessment["target"]["target_key"]
        if target_key in target_map:
            assert assessment["target"]["source_repository"] == target_map[target_key]["source_repository"], name
        else:
            assert target_key == "unresolved", name
            assert assessment["target"]["source_repository"] is None, name

        predicted_paths = assessment["scope"]["predicted_paths"]
        hits_lane_c = any(matches_any(path, lane_c_patterns) for path in predicted_paths)
        hits_lane_b = any(matches_any(path, lane_b_patterns) for path in predicted_paths)
        if hits_lane_c:
            assert assessment["risk_lane"] == "C", (name, predicted_paths)
            assert assessment["approvals"]["coding_required"] is True, name
            assert assessment["approvals"]["merge_required"] is True, name
        elif assessment["risk_lane"] == "A":
            assert not hits_lane_b, (name, predicted_paths)
            assert assessment["scope"]["predicted_file_count"] <= policy["lanes"]["A"]["limits"]["maximum_changed_files"]
            assert assessment["scope"]["predicted_changed_lines"] <= policy["lanes"]["A"]["limits"]["maximum_changed_lines"]

    low_risk = assessments["assessment-low-risk-ui"]
    assert low_risk["outcome"] == "implementation_candidate"
    assert low_risk["risk_lane"] == "A"
    assert low_risk["request"]["submitter"]["trust_source"] == "approved_actor_record"
    assert low_risk["automation"]["coding_authorized"] is False

    protected_auth = assessments["assessment-protected-auth"]
    assert protected_auth["outcome"] == "approval_required"
    assert protected_auth["risk_lane"] == "C"
    assert any(path.startswith("supabase/") for path in protected_auth["scope"]["predicted_paths"])

    clarification = assessments["assessment-clarification-required"]
    assert clarification["outcome"] == "clarification_required"
    assert clarification["risk_lane"] == "D"
    assert clarification["clarification"]["required"] is True
    assert clarification["clarification"]["questions"]
    assert clarification["scope"]["predicted_paths"] == []

    duplicate = assessments["assessment-duplicate"]
    assert duplicate["outcome"] == "duplicate"
    assert duplicate["duplicate"]["is_duplicate"] is True
    assert duplicate["duplicate"]["duplicate_of"]
    assert duplicate["automation"]["coding_authorized"] is False

    plan = load(EXAMPLES / "implementation-plan-shadow-ui.json")
    assert plan["schema_version"] == 1
    assert plan["assessment_id"] == low_risk["assessment_id"]
    assert re.fullmatch(r"[0-9a-f]{40}", plan["git"]["exact_base_commit"])
    assert re.fullmatch(r"(agent|codex|automation)/[a-z0-9][a-z0-9._/-]{2,150}", plan["git"]["proposed_branch"])
    assert plan["acceptance_checks"]
    assert plan["implementation_steps"]
    assert plan["tests"]
    assert plan["rollback"]["steps"]
    assert all_disabled(plan["automation"])
    assert plan["progress"]["stage"] == "planned"
    assert any("Shadow mode" in reason for reason in plan["progress"]["blocked_by"])

    serialized_examples = "\n".join(
        path.read_text(encoding="utf-8")
        for path in sorted(EXAMPLES.glob("*.json"))
    )
    for credential_marker in (
        "BEGIN PRIVATE KEY",
        "service_role_key",
        '"api_key"',
        '"access_token"',
        '"password"',
    ):
        assert credential_marker not in serialized_examples

    print(
        "PASS: assessment and implementation-plan contracts cover low-risk, "
        "protected, clarification and duplicate outcomes without authorizing execution"
    )


if __name__ == "__main__":
    main()

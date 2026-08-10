from __future__ import annotations

import json
import pathlib
import sys
from typing import Any


DECISIONS = {
    "implement",
    "approval_required",
    "clarification_required",
    "reject",
    "duplicate",
}
RISKS = {"low", "moderate", "high", "protected"}
LANES = {"A", "B", "C", "D"}
REQUIRED_TEXT = {
    "decision",
    "risk_level",
    "lane",
    "summary",
    "user_problem",
    "recommended_change",
    "target_repository",
    "rollback_plan",
}
REQUIRED_LISTS = {
    "target_pages",
    "likely_files",
    "dependencies",
    "acceptance_checks",
    "test_plan",
}
AUTHORITY_FIELDS = {
    "may_edit_repository",
    "may_create_pull_request",
    "may_merge",
    "may_deploy",
}


def load_json(path: pathlib.Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise AssertionError(f"{path} must contain a JSON object")
    return value


def validate(context: dict[str, Any], assessment: dict[str, Any]) -> None:
    for field in REQUIRED_TEXT:
        value = assessment.get(field)
        assert isinstance(value, str) and value.strip(), f"Missing text field: {field}"
    for field in REQUIRED_LISTS:
        value = assessment.get(field)
        assert isinstance(value, list), f"Missing list field: {field}"
        assert all(isinstance(item, str) and item.strip() for item in value), field

    assert assessment["decision"] in DECISIONS, assessment["decision"]
    assert assessment["risk_level"] in RISKS, assessment["risk_level"]
    assert assessment["lane"] in LANES, assessment["lane"]

    run = context.get("automation_run")
    assert isinstance(run, dict), "Context automation_run is missing"
    assert assessment["target_repository"] == run.get("target_repository"), (
        assessment["target_repository"],
        run.get("target_repository"),
    )

    authority = assessment.get("execution_authority")
    assert isinstance(authority, dict), "execution_authority is missing"
    assert set(authority) == AUTHORITY_FIELDS, authority
    assert all(authority[field] is False for field in AUTHORITY_FIELDS), authority

    confidence = assessment.get("confidence")
    assert isinstance(confidence, (int, float)) and not isinstance(confidence, bool)
    assert 0 <= float(confidence) <= 1, confidence

    if assessment["risk_level"] == "protected":
        assert assessment["lane"] in {"C", "D"}, assessment["lane"]
        assert assessment["decision"] != "implement", assessment["decision"]

    if assessment["decision"] == "implement":
        assert assessment["lane"] in {"A", "B"}, assessment["lane"]
    if assessment["decision"] in {"clarification_required", "reject", "duplicate"}:
        assert assessment["lane"] == "D", assessment["lane"]

    serialized = json.dumps(assessment, ensure_ascii=False)
    assert len(serialized) <= 100_000, "Assessment exceeds 100,000 characters"


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit(
            "Usage: validate_ai_suggestion_assessment.py "
            "<suggestion-context.json> <assessment.json>"
        )
    context_path = pathlib.Path(sys.argv[1])
    assessment_path = pathlib.Path(sys.argv[2])
    context = load_json(context_path)
    assessment = load_json(assessment_path)
    validate(context, assessment)
    print(
        "PASS: assessment is structurally valid, repository-routed and execution-disabled"
    )


if __name__ == "__main__":
    main()

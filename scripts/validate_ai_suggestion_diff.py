from __future__ import annotations

import fnmatch
import json
import pathlib
import subprocess
import sys
from typing import Any


ROOT = pathlib.Path(__file__).resolve().parents[1]
RUNTIME_ARTIFACTS = {
    "implementation-context.json",
    "suggestion-context.json",
}
RUNTIME_PREFIXES = (
    "automation-output/",
)


class DiffValidationError(ValueError):
    pass


def command(*args: str) -> str:
    result = subprocess.run(
        list(args),
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout


def load_json(path: pathlib.Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise DiffValidationError(f"{path} must contain an object")
    return value


def matches(path: str, exact_paths: set[str], patterns: list[str]) -> bool:
    return path in exact_paths or any(fnmatch.fnmatch(path, pattern) for pattern in patterns)


def classify(path: str, policy: dict[str, Any]) -> str:
    always_hold = policy["always_hold"]
    if matches(path, set(), list(always_hold["glob_patterns"])):
        return "HOLD"

    lane_c = policy["lane_C_approval_before_coding"]
    if matches(path, set(lane_c["exact_paths"]), list(lane_c["glob_patterns"])):
        return "C"

    lane_b = policy["lane_B_implement_then_approve"]
    if matches(path, set(lane_b["exact_paths"]), list(lane_b["glob_patterns"])):
        return "B"

    lane_a = policy["lane_A_candidate_paths"]
    if matches(path, set(), list(lane_a["glob_patterns"])):
        return "A"
    return "C"


def runtime_artifact(path: str) -> bool:
    return path in RUNTIME_ARTIFACTS or any(path.startswith(prefix) for prefix in RUNTIME_PREFIXES)


def changed_files(base_commit: str) -> tuple[list[str], set[str]]:
    tracked_output = command("git", "diff", "--name-only", "--diff-filter=ACMRT", base_commit, "--")
    tracked = {line.strip() for line in tracked_output.splitlines() if line.strip()}
    untracked_output = command("git", "ls-files", "--others", "--exclude-standard")
    untracked = {
        line.strip()
        for line in untracked_output.splitlines()
        if line.strip() and not runtime_artifact(line.strip())
    }
    files = sorted(tracked | untracked)
    return files, untracked


def untracked_numstat(path: str) -> dict[str, Any]:
    absolute = ROOT / path
    data = absolute.read_bytes()
    if b"\x00" in data:
        raise DiffValidationError(f"Binary change is not allowed in Lane A: {path}")
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as error:
        raise DiffValidationError(f"New file must be UTF-8 text in Lane A: {path}") from error
    added = len(text.splitlines())
    return {"path": path, "added": added, "deleted": 0, "changed": added, "untracked": True}


def diff_size(base_commit: str, untracked: set[str]) -> tuple[int, list[dict[str, Any]]]:
    output = command("git", "diff", "--numstat", base_commit, "--")
    total = 0
    entries: list[dict[str, Any]] = []
    tracked_paths: set[str] = set()
    for line in output.splitlines():
        if not line.strip():
            continue
        added, deleted, path = line.split("\t", 2)
        if added == "-" or deleted == "-":
            raise DiffValidationError(f"Binary change is not allowed in Lane A: {path}")
        changed = int(added) + int(deleted)
        total += changed
        tracked_paths.add(path)
        entries.append({"path": path, "added": int(added), "deleted": int(deleted), "changed": changed})
    for path in sorted(untracked - tracked_paths):
        entry = untracked_numstat(path)
        total += int(entry["changed"])
        entries.append(entry)
    return total, entries


def validate(base_commit: str, context_path: pathlib.Path, output_path: pathlib.Path) -> dict[str, Any]:
    context = load_json(context_path)
    policy = load_json(ROOT / ".automation/protected-paths.yml")

    if context.get("execution_authority", {}).get("lane") != "A":
        raise DiffValidationError("Implementation context is not Lane A")
    if context.get("execution_authority", {}).get("may_merge") is not False:
        raise DiffValidationError("Implementation context unexpectedly permits merge")
    if context.get("execution_authority", {}).get("may_deploy") is not False:
        raise DiffValidationError("Implementation context unexpectedly permits deployment")

    files, untracked = changed_files(base_commit)
    if not files:
        raise DiffValidationError("Codex produced no repository changes")
    if len(files) > 6:
        raise DiffValidationError(f"Lane A permits at most 6 files; found {len(files)}")

    classifications = {path: classify(path, policy) for path in files}
    disallowed = {path: lane for path, lane in classifications.items() if lane != "A"}
    if disallowed:
        detail = ", ".join(f"{path}={lane}" for path, lane in sorted(disallowed.items()))
        raise DiffValidationError(f"Protected or non-Lane-A paths changed: {detail}")

    changed_lines, entries = diff_size(base_commit, untracked)
    if changed_lines > 400:
        raise DiffValidationError(f"Lane A permits at most 400 changed lines; found {changed_lines}")

    planning_document = str(context.get("git", {}).get("planning_document", ""))
    if not planning_document or planning_document not in files:
        raise DiffValidationError("Required automation-run planning document was not changed")
    if not any(path.startswith("tests/") for path in files):
        raise DiffValidationError("Lane A implementation must add or update a deterministic test")

    command("git", "diff", "--check", base_commit, "--")

    evidence = {
        "base_commit": base_commit,
        "changed_files": files,
        "changed_file_count": len(files),
        "changed_lines": changed_lines,
        "classifications": classifications,
        "numstat": entries,
        "planning_document": planning_document,
        "lane": "A",
        "merge_authorized": False,
        "deployment_authorized": False,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return evidence


def main() -> None:
    if len(sys.argv) != 4:
        raise SystemExit(
            "Usage: validate_ai_suggestion_diff.py <base-commit> "
            "<implementation-context.json> <diff-evidence.json>"
        )
    try:
        evidence = validate(sys.argv[1], pathlib.Path(sys.argv[2]), pathlib.Path(sys.argv[3]))
    except (DiffValidationError, subprocess.CalledProcessError, json.JSONDecodeError, OSError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        raise SystemExit(1) from error
    print(
        f"PASS: {evidence['changed_file_count']} Lane A files, "
        f"{evidence['changed_lines']} changed lines, merge/deploy disabled"
    )


if __name__ == "__main__":
    main()

from __future__ import annotations

import json
import pathlib
import subprocess
import sys
from typing import Any


ROOT = pathlib.Path(__file__).resolve().parents[1]


def run(command: list[str]) -> dict[str, Any]:
    result = subprocess.run(
        command,
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    return {
        "command": " ".join(command),
        "status": "passed" if result.returncode == 0 else "failed",
        "return_code": result.returncode,
        "stdout": result.stdout[-4000:],
        "stderr": result.stderr[-4000:],
    }


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit(
            "Usage: run_ai_suggestion_checks.py <diff-evidence.json> <test-evidence.json>"
        )
    diff_path = pathlib.Path(sys.argv[1])
    output_path = pathlib.Path(sys.argv[2])
    evidence = json.loads(diff_path.read_text(encoding="utf-8"))
    files = [str(path) for path in evidence.get("changed_files", [])]

    commands: list[list[str]] = []
    javascript_files = [path for path in files if path.endswith((".js", ".mjs"))]
    python_files = [path for path in files if path.endswith(".py")]
    changed_tests = [path for path in files if path.startswith("tests/")]

    for path in javascript_files:
        commands.append(["node", "--check", path])
    for path in python_files:
        commands.append([sys.executable, "-m", "py_compile", path])
    for path in changed_tests:
        if path.endswith(".py"):
            commands.append([sys.executable, path])
        elif path.endswith((".mjs", ".js")):
            commands.append(["node", path])

    unique_commands: list[list[str]] = []
    seen: set[tuple[str, ...]] = set()
    for command in commands:
        key = tuple(command)
        if key not in seen:
            seen.add(key)
            unique_commands.append(command)

    if not unique_commands:
        raise SystemExit("No deterministic syntax or test commands were derived from the changed files")

    results = [run(command) for command in unique_commands]
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")

    failures = [result for result in results if result["status"] != "passed"]
    if failures:
        for failure in failures:
            print(f"FAIL: {failure['command']}", file=sys.stderr)
            if failure["stdout"]:
                print(failure["stdout"], file=sys.stderr)
            if failure["stderr"]:
                print(failure["stderr"], file=sys.stderr)
        raise SystemExit(1)

    print(f"PASS: {len(results)} deterministic suggestion checks completed")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Quality skill harness — analyzes code quality metrics and suggests improvements."""

import json
import re
import sys
from pathlib import Path

QUALITY_SIGNALS = {
    "long_function": {"pattern": r"def\s+\w+.*:\s*\n(?:.*\n){50,}", "message": "Function exceeds 50 lines — consider splitting", "severity": "warning"},
    "deep_nesting": {"pattern": r"^\s{24,}\S", "message": "Deep nesting (6+ levels) — extract inner logic", "severity": "warning"},
    "todo_fixme": {"pattern": r"(TODO|FIXME|HACK|XXX|TEMP)\b", "message": "Unresolved TODO/FIXME — address before merging", "severity": "info"},
    "complex_comprehension": {"pattern": r"\[.*for.*for.*if.*if", "message": "Complex comprehension — extract to named function", "severity": "info"},
    "no_docstring": {"pattern": r"def\s+\w+\s*\([^)]*\)\s*(?:->\s*\w+\s*)?:\s*\n\s+(?!\"\"\")", "message": "Missing docstring on function", "severity": "info"},
    "duplicate_code": {"pattern": r"(\w+\([^)]+\))\s*\n.*\1", "message": "Potential duplicate code — extract to shared function", "severity": "warning"},
}

def read_prompt(file_path: str) -> str:
    try:
        return Path(file_path).read_text()
    except Exception:
        return ""

def analyze_quality(prompt: str) -> dict:
    issues = []
    lines = prompt.split("\n")

    for line_num, line in enumerate(lines, 1):
        for rule_id, rule in QUALITY_SIGNALS.items():
            if re.search(rule["pattern"], line):
                issues.append({
                    "rule": rule_id,
                    "line": line_num,
                    "severity": rule["severity"],
                    "message": rule["message"],
                })

    metrics = {
        "total_lines": len(lines),
        "blank_lines": sum(1 for l in lines if not l.strip()),
        "comment_lines": sum(1 for l in lines if l.strip().startswith(("//", "#", "/*", "*"))),
        "avg_line_length": round(sum(len(l) for l in lines) / max(len(lines), 1)),
    }

    return {
        "analysis_type": "quality",
        "total_issues": len(issues),
        "issues": issues[:30],
        "metrics": metrics,
        "quality_score": max(0, 100 - len(issues) * 5),
    }

def main():
    prompt_file = None
    for i, arg in enumerate(sys.argv):
        if arg == "--prompt-file" and i + 1 < len(sys.argv):
            prompt_file = sys.argv[i + 1]
            break

    prompt = read_prompt(prompt_file) if prompt_file else ""
    if not prompt:
        print(json.dumps({"status": "skipped", "reason": "No prompt provided"}))
        sys.exit(0)

    result = analyze_quality(prompt)
    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main()

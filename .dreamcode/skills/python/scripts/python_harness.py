#!/usr/bin/env python3
"""Python-best-practices skill harness — analyzes Python code for best practice violations."""

import json
import re
import sys
from pathlib import Path

PYTHON_RULES = {
    "mutable_default": {"pattern": r"def\s+\w+\s*\(.*=\s*(\[\]|\{\}|set\(\))", "message": "Mutable default argument — use None and initialize inside"},
    "bare_except": {"pattern": r"except\s*:", "message": "Bare except — catch specific exceptions"},
    "type_comparison": {"pattern": r"isinstance\(.+\)", "message": "Verify isinstance() usage — prefer TypeGuard for complex types"},
    "global_usage": {"pattern": r"\bglobal\s+\w+", "message": "Global variable — prefer class or closure"},
    "print_debug": {"pattern": r"\bprint\s*\(", "message": "print() for debug — use logging module"},
    "import_star": {"pattern": r"from\s+\w+\s+import\s+\*", "message": "Wildcard import — import specific names"},
    "no_type_hint": {"pattern": r"def\s+\w+\s*\([^)]*\)\s*:", "message": "Missing return type hint — add -> Type"},
    "len_comparison": {"pattern": r"if\s+len\(\w+\)\s*[><=!]+\s*0", "message": "Use truthiness check instead of len() comparison"},
}

def read_prompt(file_path: str) -> str:
    try:
        return Path(file_path).read_text()
    except Exception:
        return ""

def analyze_python(prompt: str) -> dict:
    issues = []
    lines = prompt.split("\n")

    for line_num, line in enumerate(lines, 1):
        for rule_id, rule in PYTHON_RULES.items():
            if re.search(rule["pattern"], line):
                issues.append({
                    "rule": rule_id,
                    "line": line_num,
                    "message": rule["message"],
                    "source": line.strip()[:100],
                })

    return {
        "analysis_type": "python_best_practices",
        "total_issues": len(issues),
        "issues": issues[:30],
        "lines_scanned": len(lines),
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

    result = analyze_python(prompt)
    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main()

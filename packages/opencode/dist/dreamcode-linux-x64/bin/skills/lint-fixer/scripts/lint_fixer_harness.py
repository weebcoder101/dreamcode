#!/usr/bin/env python3
"""Lint-fixer skill harness — scans code patterns for common lint violations."""

import json
import re
import sys
from pathlib import Path

LINT_RULES = {
    "no_console_log": {"pattern": r"console\.(log|debug|info)\(", "message": "Remove console.log/debug statements", "severity": "warning"},
    "no_any_type": {"pattern": r":\s*any\b", "message": "Avoid 'any' type — use specific types", "severity": "warning"},
    "no_var_keyword": {"pattern": r"\bvar\s+", "message": "Use 'let' or 'const' instead of 'var'", "severity": "warning"},
    "no_eval": {"pattern": r"\beval\s*\(", "message": "Avoid eval() — use safer alternatives", "severity": "error"},
    "no_improper_indent": {"pattern": r"^\t+ ", "message": "Mixed tabs and spaces", "severity": "warning"},
    "no_trailing_whitespace": {"pattern": r" +$", "message": "Trailing whitespace", "severity": "info"},
    "no_empty_block": {"pattern": r"\{\s*\}", "message": "Empty code block", "severity": "info"},
    "no_magic_numbers": {"pattern": r"(?<!=)\s-?\d{3,}(?!\w*\.?\w*)", "message": "Magic number — extract to named constant", "severity": "info"},
}

def read_prompt(file_path: str) -> str:
    try:
        return Path(file_path).read_text()
    except Exception:
        return ""

def analyze_code(prompt: str) -> dict:
    violations = []
    lines = prompt.split("\n")

    for line_num, line in enumerate(lines, 1):
        for rule_id, rule in LINT_RULES.items():
            if re.search(rule["pattern"], line):
                violations.append({
                    "rule": rule_id,
                    "line": line_num,
                    "severity": rule["severity"],
                    "message": rule["message"],
                    "source": line.strip()[:100],
                })

    severity_counts = {}
    for v in violations:
        s = v["severity"]
        severity_counts[s] = severity_counts.get(s, 0) + 1

    return {
        "analysis_type": "lint",
        "total_violations": len(violations),
        "by_severity": severity_counts,
        "violations": violations[:50],
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

    result = analyze_code(prompt)
    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main()

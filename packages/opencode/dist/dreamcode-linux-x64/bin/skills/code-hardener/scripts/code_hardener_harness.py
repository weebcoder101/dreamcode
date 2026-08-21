#!/usr/bin/env python3
"""Code-hardener skill harness — analyzes code for security and robustness issues."""

import json
import re
import sys
from pathlib import Path

SECURITY_PATTERNS = {
    "sql_injection": {"pattern": r"(query|execute|raw)\s*\(\s*[\"'].*\+", "message": "Potential SQL injection — use parameterized queries", "severity": "high"},
    "hardcoded_secret": {"pattern": r"(password|secret|api_key|token)\s*=\s*[\"'][^\"']+[\"']", "message": "Hardcoded secret — use environment variables", "severity": "critical"},
    "eval_usage": {"pattern": r"\beval\s*\(", "message": "eval() usage — code injection risk", "severity": "high"},
    "exec_usage": {"pattern": r"\bexec\s*\(", "message": "exec() usage — code injection risk", "severity": "high"},
    "unsanitized_input": {"pattern": r"(req\.body|input|argv|args)\[", "message": "Unsanitized input — validate and sanitize", "severity": "medium"},
    "missing_error_handler": {"pattern": r"\.then\([^)]+\)(?!\.catch)", "message": "Promise without .catch() — unhandled rejection", "severity": "medium"},
    "prototype_pollution": {"pattern": r"Object\.assign\s*\(\s*(req|body|input)", "message": "Prototype pollution risk — validate keys", "severity": "high"},
    "path_traversal": {"pattern": r"(readFile|readFileSync|open)\s*\([^)]*req\.", "message": "Potential path traversal — validate file paths", "severity": "high"},
}

def read_prompt(file_path: str) -> str:
    try:
        return Path(file_path).read_text()
    except Exception:
        return ""

def analyze_security(prompt: str) -> dict:
    issues = []
    lines = prompt.split("\n")

    for line_num, line in enumerate(lines, 1):
        for rule_id, rule in SECURITY_PATTERNS.items():
            if re.search(rule["pattern"], line, re.IGNORECASE):
                issues.append({
                    "rule": rule_id,
                    "line": line_num,
                    "severity": rule["severity"],
                    "message": rule["message"],
                    "source": line.strip()[:100],
                })

    severity_counts = {}
    for issue in issues:
        s = issue["severity"]
        severity_counts[s] = severity_counts.get(s, 0) + 1

    return {
        "analysis_type": "security",
        "total_issues": len(issues),
        "by_severity": severity_counts,
        "issues": issues[:50],
        "lines_scanned": len(lines),
        "recommendation": "Review all flagged issues. Prioritize critical/high severity items first.",
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

    result = analyze_security(prompt)
    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Communication skill harness — analyzes documentation and comment quality."""

import json
import re
import sys
from pathlib import Path

def read_prompt(file_path: str) -> str:
    try:
        return Path(file_path).read_text()
    except Exception:
        return ""

def analyze_communication(prompt: str) -> dict:
    lines = prompt.split("\n")
    issues = []

    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        if not stripped:
            continue

        if len(stripped) > 200:
            issues.append({"line": i, "type": "long_line", "message": f"Line too long ({len(stripped)} chars) — break into shorter segments"})

        if re.match(r"^(//|/\*|\*|#)\s*[a-z]", stripped):
            issues.append({"line": i, "type": "comment_capitalization", "message": "Comment should start with capital letter"})

        if re.search(r"\b(very|really|basically|actually|just|simply)\b", stripped, re.IGNORECASE):
            issues.append({"line": i, "type": "weak_language", "message": "Weak filler word — remove for clarity"})

    has_readme = bool(re.search(r"#\s+\w+", prompt))
    has_api_docs = bool(re.search(r"(API|endpoint|request|response|parameter)", prompt, re.IGNORECASE))
    has_examples = bool(re.search(r"(example|e\.g\.|for instance|i\.e\.)", prompt, re.IGNORECASE))

    return {
        "analysis_type": "communication",
        "total_issues": len(issues),
        "issues": issues[:20],
        "documentation_signals": {
            "has_title": has_readme,
            "has_api_docs": has_api_docs,
            "has_examples": has_examples,
        },
        "readability_score": max(0, 100 - len(issues) * 3),
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

    result = analyze_communication(prompt)
    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main()

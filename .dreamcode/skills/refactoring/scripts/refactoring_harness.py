#!/usr/bin/env python3
"""Refactoring skill harness — identifies refactoring opportunities and suggests patterns."""

import json
import re
import sys
from pathlib import Path

REFACTOR_PATTERNS = {
    "long_function": {"pattern": r"def\s+(\w+).*:\s*\n(?:.*\n){30,}", "suggestion": "Extract sub-functions or use SRP"},
    "duplicated_logic": {"pattern": r"if\s+.*:.*\n.*else.*:.*\n.*if\s+.*:", "suggestion": "Consolidate conditional logic into strategy pattern"},
    "magic_strings": {"pattern": r"[\"'](?:error|success|pending|active|inactive|admin|user)[\"']", "suggestion": "Extract to enum or constant"},
    "nested_callbacks": {"pattern": r"\.then\(\s*\(?.*=>\s*\{.*\.then\(", "suggestion": "Flatten with async/await"},
    "god_object": {"pattern": r"class\s+\w+.*:\s*\n(?:.*\n){100,}", "suggestion": "Split into smaller focused classes"},
    "feature_envy": {"pattern": r"(\w+)\.(\w+)\.(\w+)\.(\w+)", "suggestion": "Feature envy — move logic closer to data"},
}

def read_prompt(file_path: str) -> str:
    try:
        return Path(file_path).read_text()
    except Exception:
        return ""

def analyze_refactoring(prompt: str) -> dict:
    opportunities = []
    lines = prompt.split("\n")

    for line_num, line in enumerate(lines, 1):
        for rule_id, rule in REFACTOR_PATTERNS.items():
            if re.search(rule["pattern"], line):
                opportunities.append({
                    "pattern": rule_id,
                    "line": line_num,
                    "suggestion": rule["suggestion"],
                    "source": line.strip()[:100],
                })

    return {
        "analysis_type": "refactoring",
        "total_opportunities": len(opportunities),
        "opportunities": opportunities[:20],
        "priority": "high" if len(opportunities) > 5 else "medium" if len(opportunities) > 2 else "low",
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

    result = analyze_refactoring(prompt)
    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Planning skill harness — analyzes task complexity and suggests decomposition strategies."""

import json
import re
import sys
from pathlib import Path

COMPLEXITY_SIGNALS = {
    "high": [
        r"\b(refactor|rewrite|migration|redesign|overhaul)\b",
        r"\b(multiple|several|all|every|entire)\b.*\b(file|module|component|service)\b",
        r"\b(breaking\s+change|api\s+change|schema\s+change)\b",
        r"\b(security|auth|permission|encrypt)\b",
        r"\b(concurrent|parallel|race|thread)\b",
        r"\b(database|migration|schema|column)\b",
    ],
    "medium": [
        r"\b(fix|update|modify|change|add|remove)\b",
        r"\b(test|spec|coverage)\b",
        r"\b(document|comment|readme)\b",
        r"\b(dependency|package|version|upgrade)\b",
        r"\b(config|setting|env|variable)\b",
    ],
    "low": [
        r"\b(typo|rename|format|style|whitespace)\b",
        r"\b(read|show|list|display|print)\b",
        r"\b(explain|describe|what|how)\b",
    ],
}

def read_prompt(file_path: str) -> str:
    try:
        return Path(file_path).read_text()
    except Exception:
        return ""

def analyze_task(prompt: str) -> dict:
    prompt_lower = prompt.lower()
    scores = {"high": 0, "medium": 0, "low": 0}

    for level, patterns in COMPLEXITY_SIGNALS.items():
        for pattern in patterns:
            matches = re.findall(pattern, prompt_lower)
            scores[level] += len(matches)

    total = sum(scores.values()) or 1
    weights = {"high": 3, "medium": 2, "low": 1}
    weighted_score = sum(scores[k] * weights[k] for k in scores) / total

    if weighted_score > 2.5:
        complexity = "high"
    elif weighted_score > 1.5:
        complexity = "medium"
    else:
        complexity = "low"

    decomposition = []
    if complexity == "high":
        decomposition = [
            "Break into independent sub-tasks",
            "Identify dependencies between sub-tasks",
            "Prioritize critical path items",
            "Estimate effort for each sub-task",
            "Identify risks and mitigation strategies",
        ]
    elif complexity == "medium":
        decomposition = [
            "Identify the core change needed",
            "Check for related files that need updates",
            "Plan testing strategy",
        ]
    else:
        decomposition = [
            "Make the change directly",
            "Verify with existing tests",
        ]

    return {
        "analysis_type": "planning",
        "complexity": complexity,
        "complexity_scores": scores,
        "weighted_score": round(weighted_score, 2),
        "decomposition_steps": decomposition,
        "estimated_subtasks": max(1, scores["high"] * 2 + scores["medium"]),
        "prompt_length": len(prompt),
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

    result = analyze_task(prompt)
    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main()

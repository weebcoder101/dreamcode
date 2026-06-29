#!/usr/bin/env python3
"""Breakthrough-overdrive-innovation skill harness — analyzes tasks for innovation potential."""

import json
import re
import sys
from pathlib import Path

INNOVATION_SIGNALS = {
    "paradigm_shift": [r"\b(unified|universal|fundamental|first.principles|axiom)\b", r"\b(derive|prove|derive|theorem)\b"],
    "novel_approach": [r"\b(novel|new|unprecedented|breakthrough|revolutionary)\b", r"\b(non.obvious|counter.intuitive|unexpected)\b"],
    "cross_domain": [r"\b(physics|biology|chemistry|mathematics|information.theory)\b", r"\b(economics|psychology|neuroscience)\b"],
    "high_impact": [r"\b(scale|universal|impact|transform|disrupt)\b", r"\b(fundamental|essential|critical)\b"],
    "deep_analysis": [r"\b(derive|calculate|simulate|model|formalize)\b", r"\b(equation|formula|theorem|proof)\b"],
}

def read_prompt(file_path: str) -> str:
    try:
        return Path(file_path).read_text()
    except Exception:
        return ""

def analyze_innovation(prompt: str) -> dict:
    prompt_lower = prompt.lower()
    scores = {}

    for category, patterns in INNOVATION_SIGNALS.items():
        matches = []
        for pattern in patterns:
            matches.extend(re.findall(pattern, prompt_lower))
        scores[category] = len(matches)

    total = sum(scores.values())
    innovation_score = min(100, total * 10)

    suggestions = []
    if scores["paradigm_shift"] > 0:
        suggestions.append("This task involves fundamental concepts — ground in first principles")
    if scores["novel_approach"] > 0:
        suggestions.append("Novel approach detected — document assumptions and validate rigorously")
    if scores["cross_domain"] > 0:
        suggestions.append("Cross-domain task — consider analogies from related fields")
    if scores["deep_analysis"] > 0:
        suggestions.append("Deep analysis required — ensure mathematical rigor")
    if not suggestions:
        suggestions.append("Standard task — apply existing patterns and best practices")

    return {
        "analysis_type": "innovation",
        "innovation_score": innovation_score,
        "signal_scores": scores,
        "total_signals": total,
        "suggestions": suggestions,
        "complexity": "breakthrough" if innovation_score > 70 else "advanced" if innovation_score > 40 else "standard",
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

    result = analyze_innovation(prompt)
    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main()

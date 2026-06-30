#!/usr/bin/env python3
"""Product-thinking skill harness — analyzes tasks for product impact and user value."""

import json
import re
import sys
from pathlib import Path

PRODUCT_SIGNALS = {
    "user_value": [r"\b(user|customer|client|end.user)\b", r"\b(experience|ux|ui|interface)\b", r"\b(ease|simple|intuitive|friendly)\b"],
    "business_impact": [r"\b(revenue|cost|efficiency|productivity|performance)\b", r"\b(scale|growth|retention|engagement)\b"],
    "technical_debt": [r"\b(debt|legacy|refactor|cleanup|technical)\b", r"\b(maintenance|overhead|complexity)\b"],
    "feature_request": [r"\b(feature|add|implement|build|create|new)\b", r"\b(requirement|spec|story|ticket)\b"],
    "bug_fix": [r"\b(bug|fix|issue|error|broken|crash|fail)\b", r"\b(reproduce|regression|symptom)\b"],
}

def read_prompt(file_path: str) -> str:
    try:
        return Path(file_path).read_text()
    except Exception:
        return ""

def analyze_product(prompt: str) -> dict:
    prompt_lower = prompt.lower()
    category_scores = {}

    for category, patterns in PRODUCT_SIGNALS.items():
        matches = []
        for pattern in patterns:
            matches.extend(re.findall(pattern, prompt_lower))
        category_scores[category] = len(matches)

    dominant = max(category_scores, key=category_scores.get) if any(category_scores.values()) else "general"

    prioritization = []
    if category_scores.get("bug_fix", 0) > 0:
        prioritization.append("Bug fix — high priority, affects existing users")
    if category_scores.get("user_value", 0) > 2:
        prioritization.append("User-facing change — validate with UX testing")
    if category_scores.get("technical_debt", 0) > 1:
        prioritization.append("Technical debt — schedule for dedicated cleanup sprint")
    if category_scores.get("feature_request", 0) > 0:
        prioritization.append("New feature — define acceptance criteria first")

    return {
        "analysis_type": "product",
        "dominant_category": dominant,
        "category_scores": category_scores,
        "prioritization": prioritization,
        "user_impact": "high" if category_scores.get("user_value", 0) > 2 else "medium" if category_scores.get("user_value", 0) > 0 else "low",
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

    result = analyze_product(prompt)
    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main()

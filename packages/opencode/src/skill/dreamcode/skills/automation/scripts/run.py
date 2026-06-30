#!/usr/bin/env python3
"""Automation analysis harness — assesses automation opportunities and workflow pipeline patterns."""

import json
import re
import sys
from pathlib import Path

AUTOMATION_PATTERNS = {
    "repetitive": [r"\b(repeat|manual|tedious|boring|every time|each time|regularly)\b"],
    "pipeline": [r"\b(pipeline|workflow|chain|sequence|step|stage|gate)\b"],
    "scheduling": [r"\b(schedule|cron|hourly|daily|weekly|nightly|periodic)\b"],
    "trigger": [r"\b(trigger|webhook|event|hook|on change|on push|on commit)\b"],
    "validation": [r"\b(validate|check|verify|lint|format|test|audit)\b"],
    "integration": [r"\b(integration|connect|sync|transfer|migrate|import|export)\b"],
    "notification": [r"\b(notify|alert|email|slack|discord|message|report)\b"],
    "transformation": [r"\b(transform|convert|generate|compile|build|package|render)\b"],
    "approval": [r"\b(approve|review|sign.?off|gate|permission|authorize)\b"],
    "monitoring": [r"\b(monitor|watch|health|status|uptime|check)\b"],
}

AUTOMATION_RECOMMENDATIONS = {
    "repetitive": "Automate repetitive tasks with scripts or CI/CD. Invest in automation that runs frequently.",
    "pipeline": "Design pipelines as DAGs. Each stage should be independently testable. Fail fast.",
    "scheduling": "Use cron or CI/CD scheduled triggers. Add monitoring for scheduled job failures.",
    "trigger": "Use webhook-based triggers for real-time automation. Polling is a fallback.",
    "validation": "Run validation in CI (lint, type-check, test). Gate deploys on validation passing.",
    "integration": "Use message queues for async integrations. Implement retry with backoff.",
    "notification": "Automate notifications on pipeline events. Use structured messages. Respect quiet hours.",
    "transformation": "Idempotent transformations. Cache intermediate results. Log transformations for audit.",
    "approval": "Implement approval gates for sensitive operations. Auto-approve low-risk changes.",
    "monitoring": "Automated health checks with alerting. Monitor automation itself (dead man's switch).",
}


def read_prompt(file_path: str) -> str:
    try:
        return Path(file_path).read_text()
    except Exception:
        return ""


def analyze_prompt(prompt: str) -> dict:
    prompt_lower = prompt.lower()
    findings = []
    recommendations = []

    for category, patterns in AUTOMATION_PATTERNS.items():
        all_matches = []
        for pattern in patterns:
            matches = re.findall(pattern, prompt_lower)
            all_matches.extend(matches)
        if all_matches:
            findings.append({"category": category, "match_count": len(all_matches)})

    if not findings:
        findings.append({"category": "general", "match_count": 1})

    for finding in findings:
        cat = finding["category"]
        if cat in AUTOMATION_RECOMMENDATIONS:
            recommendations.append({"category": cat, "recommendation": AUTOMATION_RECOMMENDATIONS[cat]})

    automation_roi = "high" if any(f["match_count"] > 2 for f in findings) else "medium"

    return {
        "analysis_type": "automation",
        "findings_count": len(findings),
        "automation_roi_estimate": automation_roi,
        "findings": findings,
        "recommendations": recommendations,
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

    result = analyze_prompt(prompt)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()

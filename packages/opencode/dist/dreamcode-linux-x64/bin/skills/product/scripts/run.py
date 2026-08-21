#!/usr/bin/env python3
"""Product / product analysis harness — analyzes prompts for product strategy, user needs, and feature prioritization."""

import json
import re
import sys
from pathlib import Path

PRODUCT_PATTERNS = {
    "user_needs": ["user need", "pain point", "user story", "persona", "customer", "audience"],
    "strategy": ["strategy", "vision", "roadmap", "goal", "objective", "kpi", "okr"],
    "prioritization": ["prioritize", "ice", "rice", "mvp", "must have", "should have", "backlog"],
    "market": ["market", "competitor", "landscape", "differentiation", "positioning", "swot"],
    "metrics": ["metric", "analytics", "conversion", "retention", "engagement", "funnel"],
    "feedback": ["feedback", "user research", "survey", "interview", "a/b test", "experiment"],
    "requirements": ["requirement", "spec", "acceptance criteria", "definition of done", "scope"],
    "stakeholder": ["stakeholder", "executive", "sponsor", "cross-functional", "alignment"],
    "risk_product": ["risk", "assumption", "unknown", "uncertainty", "dependency", "blocker"],
    "launch": ["launch", "release", "go-to-market", "rollout", "feature flag", "beta"],
}

PRODUCT_RECOMMENDATIONS = {
    "user_needs": "Start with user research. Define personas. Map user journeys. Validate assumptions with data.",
    "strategy": "Define North Star metric. Align roadmap with business goals. Communicate strategy clearly.",
    "prioritization": "Use RICE or ICE scoring. Prioritize outcomes over output. Revisit priorities quarterly.",
    "market": "Analyze competitors. Find white space. Define clear differentiation. Monitor market shifts.",
    "metrics": "Define leading and lagging indicators. Instrument early. Build dashboards. Review weekly.",
    "feedback": "Close the feedback loop. Prioritize based on impact vs effort. Share learnings across teams.",
    "requirements": "Write acceptance criteria in Gherkin format. Include edge cases. Review with stakeholders.",
    "stakeholder": "Communicate progress regularly. Manage expectations. Use data to support decisions.",
    "risk_product": "Identify risks early. Build validation experiments. Have contingency plans. Escalate proactively.",
    "launch": "Use feature flags for gradual rollout. Monitor metrics closely. Have rollback plan. Post-launch review.",
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

    for category, keywords in PRODUCT_PATTERNS.items():
        matches = [kw for kw in keywords if kw in prompt_lower]
        if matches:
            findings.append({"category": category, "matched_keywords": matches})

    if not findings:
        findings.append({"category": "general", "matched_keywords": ["product review"]})

    for finding in findings:
        cat = finding["category"]
        if cat in PRODUCT_RECOMMENDATIONS:
            recommendations.append({"category": cat, "recommendation": PRODUCT_RECOMMENDATIONS[cat]})

    return {
        "analysis_type": "product",
        "findings_count": len(findings),
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

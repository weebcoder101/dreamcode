#!/usr/bin/env python3
"""Onboarding analysis harness — analyzes prompts for onboarding, project setup, and developer experience."""

import json
import re
import sys
from pathlib import Path

ONBOARDING_PATTERNS = {
    "project_setup": ["setup", "install", "init", "scaffold", "boilerplate", "template", "clone"],
    "configuration": ["config", "env", "environment", "dotenv", "settings", "json", "yaml", "toml"],
    "dependencies": ["dependency", "package", "npm", "pip", "gem", "cargo", "maven", "requirement"],
    "development": ["dev", "development", "hot reload", "watch", "debug", "live server", "localhost"],
    "testing_guide": ["unit test", "integration test", "e2e", "coverage", "fixture", "mock"],
    "contribute": ["contribute", "pull request", "code review", "commit", "branch"],
    "documentation_onboard": ["readme", "getting started", "quickstart", "tutorial", "guide"],
    "troubleshooting": ["troubleshoot", "common issue", "faq", "error", "debug", "known issue"],
    "environment": ["node", "python", "runtime", "version", "compatible", "required"],
    "cicd_onboard": ["ci", "cd", "pipeline", "build", "deploy", "test suite"],
}

ONBOARDING_RECOMMENDATIONS = {
    "project_setup": "Provide a one-command setup script. Use `make setup` or equivalent. Include pre-commit hooks setup.",
    "configuration": "Provide .env.example with all vars documented. Use dotenv for local dev. Sensible defaults.",
    "dependencies": "Pin dependency versions. Use lockfiles. Document minimum versions. Run `npm audit` or equivalent.",
    "development": "Provide dev scripts (npm run dev / make dev). Hot reload defaults. Document debug configuration.",
    "testing_guide": "Include tests in setup. Provide test fixtures. Document how to run specific test suites.",
    "contribute": "CONTRIBUTING.md with clear steps. Code review checklist. Expected commit message format.",
    "documentation_onboard": "README must include: what, why, quickstart, install, usage, test, contribute.",
    "troubleshooting": "TROUBLESHOOTING.md or FAQ with common issues. Platform-specific gotchas.",
    "environment": "Document exact runtime versions required. Provide .nvmrc, .python-version, or equivalent.",
    "cicd_onboard": "Set up CI before first PR. CI should run lint, type-check, tests, build.",
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

    for category, keywords in ONBOARDING_PATTERNS.items():
        matches = [kw for kw in keywords if kw in prompt_lower]
        if matches:
            findings.append({"category": category, "matched_keywords": matches})

    if not findings:
        findings.append({"category": "general", "matched_keywords": ["onboarding review"]})

    for finding in findings:
        cat = finding["category"]
        if cat in ONBOARDING_RECOMMENDATIONS:
            recommendations.append({"category": cat, "recommendation": ONBOARDING_RECOMMENDATIONS[cat]})

    return {
        "analysis_type": "onboarding",
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

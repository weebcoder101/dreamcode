#!/usr/bin/env python3
"""Documentation analysis harness — analyzes prompts for documentation needs and standards."""

import json
import re
import sys
from pathlib import Path

DOC_PATTERNS = {
    "api_docs": ["api doc", "swagger", "openapi", "endpoint", "request", "response", "schema"],
    "readme": ["readme", "getting started", "quickstart", "installation", "usage", "example"],
    "code_docs": ["docstring", "comment", "jsdoc", "tsdoc", "javadoc", "rustdoc", "inline doc"],
    "architecture_docs": ["architecture", "adr", "decision record", "design doc", "whitepaper"],
    "changelog": ["changelog", "release notes", "version history", "migration guide"],
    "contributing": ["contributing", "code of conduct", "development setup", "style guide"],
    "tutorial": ["tutorial", "guide", "how-to", "walkthrough", "cookbook", "recipe"],
    "deployment_docs": ["deploy", "infrastructure", "configuration", "env", "setup", "installation"],
    "testing_docs": ["test", "coverage", "qa", "quality", "integration", "e2e"],
    "user_guide": ["user guide", "manual", "reference", "faq", "troubleshooting", "support"],
}


DOC_BEST_PRACTICES = {
    "api_docs": "Keep OpenAPI spec as source of truth. Include request/response examples. Document error codes.",
    "readme": "Include: what, why, quickstart, install, usage, config, contributing, license. Keep it current.",
    "code_docs": "Document public API and non-obvious logic. Use consistent format (TSDoc/JSDoc). Keep close to code.",
    "architecture_docs": "Use ADRs for key decisions. Include diagrams (C4 model). Document trade-offs and rationale.",
    "changelog": "Follow Keep a Changelog format. Group into Added/Changed/Deprecated/Removed/Fixed/Security.",
    "contributing": "Include setup instructions, coding standards, PR process, and review guidelines.",
    "tutorial": "Start with a concrete example. Show expected output. Include troubleshooting section.",
    "deployment_docs": "Document all env vars, dependencies, and infrastructure requirements. Include rollback steps.",
    "testing_docs": "Document test strategy, how to run tests, and coverage expectations.",
    "user_guide": "Write for the target audience. Use consistent terminology. Include searchable index.",
}


def read_prompt(file_path: str) -> str:
    try:
        return Path(file_path).read_text()
    except Exception:
        return ""


def analyze_prompt(prompt: str) -> dict:
    prompt_lower = prompt.lower()
    findings = []
    practices = []

    for category, keywords in DOC_PATTERNS.items():
        matches = [kw for kw in keywords if kw in prompt_lower]
        if matches:
            findings.append({"category": category, "matched_keywords": matches})

    if not findings:
        findings.append({"category": "general", "matched_keywords": ["documentation review"]})

    for finding in findings:
        cat = finding["category"]
        if cat in DOC_BEST_PRACTICES:
            practices.append({"category": cat, "practice": DOC_BEST_PRACTICES[cat]})

    return {
        "analysis_type": "documentation",
        "findings_count": len(findings),
        "findings": findings,
        "best_practices": practices,
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

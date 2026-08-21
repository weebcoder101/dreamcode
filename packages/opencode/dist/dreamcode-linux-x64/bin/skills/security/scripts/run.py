#!/usr/bin/env python3
"""Security analysis harness — scans prompts for security concerns and OWASP Top 10 patterns."""

import json
import re
import sys
from pathlib import Path

OWASP_PATTERNS = {
    "injection": ["sql injection", "sqli", "xss", "command injection", "nosql injection", "ldap injection"],
    "broken_auth": ["auth", "session", "password", "login", "token", "jwt", "oauth", "saml"],
    "sensitive_data": ["secret", "api key", "password", "credential", "pii", "encryption", "ssl", "tls"],
    "xxe": ["xml", "xxe", "entity", "dtd", "soap"],
    "broken_access": ["authorization", "access control", "permission", "rbac", "admin", "privilege"],
    "misconfiguration": ["config", "cors", "default", "debug", "verbose", "stack trace"],
    "csrf": ["csrf", "cross-site", "request forgery", "same-site"],
    "insecure_deser": ["deserialize", "pickle", "unserialize", "yaml", "marshal"],
    "known_vulns": ["cve", "vulnerability", "patch", "outdated", "dependency"],
    "logging_monitoring": ["log", "monitor", "audit", "alert", "trace", "observability"],
}

SEVERITY_MAP = {
    "injection": "critical",
    "broken_auth": "critical",
    "sensitive_data": "high",
    "xxe": "high",
    "broken_access": "high",
    "misconfiguration": "medium",
    "csrf": "medium",
    "insecure_deser": "high",
    "known_vulns": "high",
    "logging_monitoring": "medium",
}


def read_prompt(file_path: str) -> str:
    try:
        return Path(file_path).read_text()
    except Exception:
        return ""


def analyze_prompt(prompt: str) -> dict:
    prompt_lower = prompt.lower()
    findings = []
    risks = []

    for category, keywords in OWASP_PATTERNS.items():
        matches = [kw for kw in keywords if kw in prompt_lower]
        if matches:
            severity = SEVERITY_MAP.get(category, "medium")
            findings.append({"category": category, "severity": severity, "matched_keywords": matches})
            if severity in ("critical", "high"):
                risks.append({"category": category, "risk": f"OWASP {category.replace('_', ' ').title()}: {', '.join(matches)}"})

    if not findings:
        findings.append({"category": "general_review", "severity": "info", "matched_keywords": ["security review"]})

    max_severity = "info"
    for f in findings:
        s = f.get("severity", "info")
        if {"info": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}.get(s, 0) > {"info": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}.get(max_severity, 0):
            max_severity = s

    return {
        "analysis_type": "security",
        "findings_count": len(findings),
        "max_severity": max_severity,
        "risks": risks,
        "findings": findings,
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

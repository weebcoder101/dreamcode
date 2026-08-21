#!/usr/bin/env python3
"""Exhaustive cross-check harness — analyzes prompts for completeness gaps, edge cases, and verification needs."""

import json
import re
import sys
from pathlib import Path

CROSSCHECK_PATTERNS = {
    "error_paths": ["error", "failure", "exception", "crash", "fallback", "timeout", "retry"],
    "boundary_conditions": ["edge case", "boundary", "limit", "corner case", "empty", "null", "zero"],
    "security_cross": ["security", "auth", "injection", "xss", "csrf", "vulnerability", "exploit"],
    "concurrency": ["race", "deadlock", "thread", "async", "concurrent", "parallel", "lock"],
    "data_integrity": ["data loss", "corruption", "consistency", "integrity", "validation", "idempotent"],
    "performance_cross": ["performance", "slow", "memory", "leak", "bottleneck", "scale", "load"],
    "monitoring_cross": ["monitor", "log", "alert", "observability", "trace", "metric", "dashboard"],
    "rollback": ["rollback", "recovery", "undo", "revert", "backup", "restore", "compensate"],
    "dependencies_cross": ["dependency", "compat", "version", "integration", "third-party", "external"],
    "state_machine": ["state", "transition", "invariant", "precondition", "postcondition", "guard"],
}

CROSSCHECK_RECOMMENDATIONS = {
    "error_paths": "Test each error path. Ensure graceful degradation. Never expose internals in error messages.",
    "boundary_conditions": "Test min/max values, empty collections, and special inputs. Apply fuzzing for robustness.",
    "security_cross": "Apply STRIDE model. Review each component for threat surface. Run security linters.",
    "concurrency": "Test with race detector. Verify lock ordering. Consider async alternatives.",
    "data_integrity": "Add invariants. Validate at boundaries. Use transactions for atomicity. Test idempotency.",
    "performance_cross": "Benchmark under load. Profile memory. Check for N+1 queries. Review caching strategy.",
    "monitoring_cross": "Add metrics for key operations. Set up structured logging. Configure alert thresholds.",
    "rollback": "Design for recoverability. Test rollback scenarios. Have a runbook for each failure mode.",
    "dependencies_cross": "Pin dependency versions. Monitor for CVEs. Test with dependency updates in CI.",
    "state_machine": "Model states explicitly. Validate transitions. Handle illegal state errors gracefully.",
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

    for category, keywords in CROSSCHECK_PATTERNS.items():
        matches = [kw for kw in keywords if kw in prompt_lower]
        if matches:
            findings.append({"category": category, "matched_keywords": matches})

    if not findings:
        findings.append({"category": "general", "matched_keywords": ["cross-check review"]})

    for finding in findings:
        cat = finding["category"]
        if cat in CROSSCHECK_RECOMMENDATIONS:
            recommendations.append({"category": cat, "recommendation": CROSSCHECK_RECOMMENDATIONS[cat]})

    risk_score = min(10, len(findings) * 2)

    return {
        "analysis_type": "exhaustive-crosscheck",
        "findings_count": len(findings),
        "risk_score": risk_score,
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

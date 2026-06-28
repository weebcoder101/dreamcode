#!/usr/bin/env python3
"""Debugging skill harness — analyzes prompts for bug patterns and suggests debugging strategies."""

import json
import re
import sys
from pathlib import Path

BUG_PATTERNS = {
    "race_condition": ["concurrent", "race", "thread", "async", "parallel", "mutex", "lock", "deadlock"],
    "memory_leak": ["memory", "leak", "heap", "alloc", "gc", "garbage", "retain"],
    "null_reference": ["null", "undefined", "none", "optional", "nullable", "truthy", "falsy"],
    "error_handling": ["catch", "except", "error", "throw", "panic", "unwrap", "recover"],
    "type_safety": ["type", "cast", "any", "unknown", "coerce", "assert", "guard"],
    "off_by_one": ["index", "loop", "range", "boundary", "slice", "length", "count"],
    "state_management": ["state", "cache", "stale", "invalidat", "consistency", "sync"],
}

def read_prompt(file_path: str) -> str:
    try:
        return Path(file_path).read_text()
    except Exception:
        return ""

def analyze_prompt(prompt: str) -> dict:
    prompt_lower = prompt.lower()
    findings = []
    strategies = []

    for category, keywords in BUG_PATTERNS.items():
        matches = [kw for kw in keywords if kw in prompt_lower]
        if matches:
            findings.append({"category": category, "matched_keywords": matches})

    if not findings:
        findings.append({"category": "general", "matched_keywords": ["general debugging"]})

    strategy_map = {
        "race_condition": "Add deterministic ordering. Use mutex/lock. Prefer single-writer pattern.",
        "memory_leak": "Check reference cycles. Profile with heap snapshot. Ensure cleanup in finally/defer.",
        "null_reference": "Add null checks. Use guard clauses. Prefer Result/Either types.",
        "error_handling": "Ensure error propagation. Add context to errors. Don't swallow silently.",
        "type_safety": "Add explicit type annotations. Use type guards. Avoid any/unknown casts.",
        "off_by_one": "Check boundary conditions. Test with empty, single, and max-length inputs.",
        "state_management": "Add cache invalidation. Verify consistency. Use immutable state.",
    }

    for finding in findings:
        cat = finding["category"]
        if cat in strategy_map:
            strategies.append({"category": cat, "strategy": strategy_map[cat]})

    return {
        "analysis_type": "debugging",
        "findings_count": len(findings),
        "findings": findings,
        "strategies": strategies,
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

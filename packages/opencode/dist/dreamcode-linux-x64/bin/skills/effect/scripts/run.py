#!/usr/bin/env python3
"""Effect.ts analysis harness — analyzes prompts for Effect v4 patterns, schema, and functional error handling."""

import json
import re
import sys
from pathlib import Path

EFFECT_PATTERNS = {
    "effect_gen": [r"\b(Effect\.gen|function\*|yield\*)\b"],
    "schema": [r"\b(Schema\.|Schema\.Class|Schema\.Struct|Schema\.TaggedError)\b"],
    "error_handling_eff": [r"\b(Effect\.catch|Effect\.catchTag|Effect\.catchAll|Effect\.die|Effect\.orDie)\b"],
    "layer_di": [r"\b(Layer\.effect|Layer\.provide|Layer\.mergeAll|Context\.Service|Layer\.mock)\b"],
    "scope": [r"\b(Scope|forkIn|ScopedRef|Scope\.Service)\b"],
    "stream": [r"\b(Stream|Stream\.fromIterable|Stream\.runCollect|Effect\.stream)\b"],
    "concurrency_eff": [r"\b(Effect\.race|Effect\.zip|Effect\.all|concurrency|parallel)\b"],
    "ref": [r"\b(Ref|Ref\.make|Ref\.get|Ref\.set|Ref\.update|MutableRef)\b"],
    "testing_eff": [r"\b(Layer\.mock|test|TestContext|TestClock)\b"],
    "duration": [r"\b(Duration|Effect\.timeout|Schedule|retry)\b"],
}

EFFECT_RECOMMENDATIONS = {
    "effect_gen": "Use Effect.gen(function* () { ... }) for imperative composition. Tag all effects with Effect.fn('Tag.method').",
    "schema": "Use Schema.Class for multi-field data, Schema.TaggedErrorClass for errors. Struct for simple records.",
    "error_handling_eff": "Use Effect.catch for all errors, Effect.catchTag for tagged errors. Never use catchAll (doesn't exist).",
    "layer_di": "Use Layer.effect for construction, Layer.mock for tests. Layer.mergeAll to combine. Context.Service for tags.",
    "scope": "Use Effect.forkIn(scope) for forking. NOT Effect.fork (doesn't exist). Use Scope for resource management.",
    "stream": "Use Stream for large collections. Prefer Effect.forEach for bounded work. Stream for infinite sequences.",
    "concurrency_eff": "Use Effect.all with concurrency option for parallel execution. Effect.race for first-success.",
    "ref": "Use Ref for mutable state in functional way. Use MutableRef for performance-critical hot loops.",
    "testing_eff": "Use Layer.mock for stubs. Use TestClock for time-dependent tests. Live layer injection for integration.",
    "duration": "Use Effect.timeout for bounded operations. Schedule for retry policies. Duration.seconds/minutes.",
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

    for category, patterns in EFFECT_PATTERNS.items():
        all_matches = []
        for pattern in patterns:
            matches = re.findall(pattern, prompt)
            all_matches.extend(matches)
        if all_matches:
            findings.append({"category": category, "match_count": len(all_matches)})

    if not findings:
        findings.append({"category": "general", "match_count": 1})

    for finding in findings:
        cat = finding["category"]
        if cat in EFFECT_RECOMMENDATIONS:
            recommendations.append({"category": cat, "recommendation": EFFECT_RECOMMENDATIONS[cat]})

    return {
        "analysis_type": "effect",
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

#!/usr/bin/env python3
"""Architecture analysis harness — analyzes prompts for architectural concerns, patterns, and trade-offs."""

import json
import re
import sys
from pathlib import Path

ARCH_PATTERNS = {
    "layering": ["layer", "tier", "n-tier", "onion", "hexagonal", "clean architecture"],
    "coupling": ["coupling", "dependency", "interface", "abstraction", "separation"],
    "scalability": ["scale", "horizontal", "vertical", "load balancer", "shard", "partition"],
    "resilience": ["resilien", "fault tolerant", "circuit breaker", "fallback", "retry", "timeout"],
    "data_flow": ["data flow", "pipeline", "stream", "event", "message queue", "pub/sub"],
    "microservices": ["microservice", "service mesh", "api gateway", "bff", "service discovery"],
    "monolith": ["monolith", "modular monolith", "strangler", "migration"],
    "caching": ["cache", "redis", "memcached", "cdn", "varnish", "cache invalidation"],
    "database": ["database", "sql", "nosql", "read replica", "connection pool", "orm"],
    "security_arch": ["zero trust", "defense in depth", "firewall", "vpc", "iam", "encryption"],
}

ARCH_SUGGESTIONS = {
    "layering": "Enforce strict layer boundaries. Inner layers should not depend on outer layers. Use dependency injection.",
    "coupling": "Favor composition over inheritance. Depend on abstractions, not concretions. Use hexagonal architecture for core logic.",
    "scalability": "Design for horizontal scaling. Make services stateless where possible. Use event-driven patterns for async workloads.",
    "resilience": "Implement circuit breakers, bulkheads, and timeouts. Use graceful degradation. Have a clear fallback strategy.",
    "data_flow": "Prefer event-driven architectures for decoupling. Use CQRS for read/write separation in complex domains.",
    "microservices": "Start with a modular monolith. Extract bounded contexts when justified by team or scaling needs. Never extract prematurely.",
    "monolith": "Ensure modularity within the monolith. Use the Strangler Fig pattern to incrementally migrate.",
    "caching": "Cache at the correct layer (CDN, app, database). Use write-through or write-behind. Invalid aggressively.",
    "database": "Choose based on access pattern, not hype. SQL for relational data, NoSQL for document/key-value workloads.",
    "security_arch": "Defense in depth: perimeter, network, application, data layers of security. Least privilege principle everywhere.",
}


def read_prompt(file_path: str) -> str:
    try:
        return Path(file_path).read_text()
    except Exception:
        return ""


def analyze_prompt(prompt: str) -> dict:
    prompt_lower = prompt.lower()
    findings = []
    suggestions = []

    for category, keywords in ARCH_PATTERNS.items():
        matches = [kw for kw in keywords if kw in prompt_lower]
        if matches:
            findings.append({"category": category, "matched_keywords": matches})

    if not findings:
        findings.append({"category": "general", "matched_keywords": ["architecture review"]})

    for finding in findings:
        cat = finding["category"]
        if cat in ARCH_SUGGESTIONS:
            suggestions.append({"category": cat, "suggestion": ARCH_SUGGESTIONS[cat]})

    complexity = "high" if len(findings) > 4 else "medium" if len(findings) > 2 else "low"
    arch_style = "microservices" if "microservice" in prompt_lower else ("event-driven" if any(w in prompt_lower for w in ["event", "stream", "kafka"]) else "monolith")

    return {
        "analysis_type": "architecture",
        "findings_count": len(findings),
        "complexity": complexity,
        "arch_style_estimate": arch_style,
        "findings": findings,
        "suggestions": suggestions,
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

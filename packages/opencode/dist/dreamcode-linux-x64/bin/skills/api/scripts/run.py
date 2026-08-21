#!/usr/bin/env python3
"""API design analysis harness — analyzes prompts for API design concerns and patterns."""

import json
import re
import sys
from pathlib import Path

API_PATTERNS = {
    "restful_design": ["rest", "resource", "endpoint", "route", "url", "uri", "http"],
    "graphql": ["graphql", "query", "mutation", "resolver", "schema", "gql"],
    "error_handling": ["error", "status code", "4xx", "5xx", "exception", "retry"],
    "authentication": ["auth", "jwt", "token", "oauth", "login", "session", "api key"],
    "rate_limiting": ["rate limit", "throttle", "quota", "429", "backoff"],
    "versioning": ["version", "v1", "v2", "backward", "deprecat"],
    "pagination": ["page", "cursor", "offset", "limit", "paginate", "batch"],
    "serialization": ["json", "xml", "protobuf", "serialize", "deserialize", "schema"],
    "validation": ["valid", "sanitize", "assert", "input", "parameter", "required"],
    "documentation": ["swagger", "openapi", "docs", "documentation", "spec"],
}

API_SUGGESTIONS = {
    "restful_design": "Follow REST conventions: use nouns for resources, HTTP verbs for actions, consistent URL hierarchy.",
    "graphql": "Design schema-first. Use data loaders for N+1 prevention. Leverage GraphQL subscriptions for real-time.",
    "error_handling": "Return structured error responses with error codes, messages, and correlation IDs. Never leak stack traces.",
    "authentication": "Use token-based auth (JWT) with short expiry. Implement refresh token rotation. Follow OWASP guidance.",
    "rate_limiting": "Implement sliding-window rate limiting. Return Retry-After header. Use token bucket for burst tolerance.",
    "versioning": "Prefer URL-prefix versioning (v1, v2). Maintain backward compatibility for at least one major version.",
    "pagination": "Use cursor-based pagination for large datasets. Return next/prev cursors in response metadata.",
    "serialization": "Use JSON:API or similar standard. Keep payloads lean — include sparse fieldsets and includes.",
    "validation": "Validate at the boundary. Return all validation errors at once. Use standard HTTP 422 for validation failures.",
    "documentation": "Keep OpenAPI spec in sync with code (code-first or spec-first consistently). Include examples.",
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

    for category, keywords in API_PATTERNS.items():
        matches = [kw for kw in keywords if kw in prompt_lower]
        if matches:
            findings.append({"category": category, "matched_keywords": matches})

    if not findings:
        findings.append({"category": "general", "matched_keywords": ["api design"]})

    for finding in findings:
        cat = finding["category"]
        if cat in API_SUGGESTIONS:
            suggestions.append({"category": cat, "suggestion": API_SUGGESTIONS[cat]})

    domain_estimate = "public" if any(w in prompt_lower for w in ["public", "external", "third-party", "sdk"]) else "internal"
    protocol_estimate = "graphql" if "graphql" in prompt_lower else ("grpc" if "grpc" in prompt_lower else "rest")

    return {
        "analysis_type": "api",
        "findings_count": len(findings),
        "findings": findings,
        "suggestions": suggestions,
        "domain_estimate": domain_estimate,
        "protocol_estimate": protocol_estimate,
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

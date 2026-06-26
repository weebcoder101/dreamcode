#!/usr/bin/env python3
"""
Shipping Checklist Question Generator (Token Predictor)

Generates unique developer-focused questions about shipping readiness.
Uses project context, user prompt, and session context to produce
high-signal questions that developers MUST check before shipping.

Features:
- Heuristic question generation from context analysis
- Dedup via JSONL log with SHA-256 hash matching
- NEURO API enrichment when available
- Auto-regeneration on duplicate detection (max 5 retries)
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

UTC = timezone.utc

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

PROJECT_ROOT = Path(os.environ.get("PROJECT_ROOT", Path.cwd()))
EVOLUTION_DIR = PROJECT_ROOT / "evolution"
QUESTION_LOG = EVOLUTION_DIR / "shipping_questions_log.jsonl"
MAX_LOG_ENTRIES = 500
MAX_RETRIES = 5

# ---------------------------------------------------------------------------
# Prompt sanitization (injection defense)
# ---------------------------------------------------------------------------

INJECTION_PATTERNS = [
    r'ignore\s+(all\s+)?previous\s+instructions',
    r'you\s+are\s+now\s+',
    r'system\s*:\s*',
    r'<\|im_start\|>',
    r'<\|im_end\|>',
]


def sanitize_prompt(prompt: str) -> str:
    """Remove potential prompt injection patterns."""
    sanitized = prompt
    for pattern in INJECTION_PATTERNS:
        sanitized = re.sub(pattern, '[SANITIZED]', sanitized, flags=re.IGNORECASE)
    return sanitized[:50_000]


# ---------------------------------------------------------------------------
# Question log management
# ---------------------------------------------------------------------------

def load_question_log() -> list[dict]:
    """Load previous questions from JSONL log."""
    if not QUESTION_LOG.exists():
        return []
    entries = []
    try:
        with open(QUESTION_LOG) as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        entries.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue
    except OSError:
        pass
    return entries


def is_duplicate(question: str, log: list[dict]) -> bool:
    """Check if question hash matches any logged question."""
    q_hash = hashlib.sha256(question.lower().strip().encode()).hexdigest()
    return any(entry.get("question_hash") == q_hash for entry in log)


def append_question_log(questions: list[str], context_hash: str) -> None:
    """Append generated questions to the JSONL log."""
    EVOLUTION_DIR.mkdir(parents=True, exist_ok=True)
    now = datetime.now(UTC).isoformat()
    with open(QUESTION_LOG, "a") as f:
        for q in questions:
            entry = {
                "timestamp": now,
                "question": q,
                "question_hash": hashlib.sha256(q.lower().strip().encode()).hexdigest(),
                "context_hash": context_hash,
            }
            f.write(json.dumps(entry) + "\n")

    # Trim log if too large
    try:
        with open(QUESTION_LOG) as f:
            lines = f.readlines()
        if len(lines) > MAX_LOG_ENTRIES:
            with open(QUESTION_LOG, "w") as f:
                f.writelines(lines[-MAX_LOG_ENTRIES:])
    except OSError:
        pass


# ---------------------------------------------------------------------------
# Context analysis
# ---------------------------------------------------------------------------

def extract_signals(prompt: str, project_context: str, session_context: str) -> dict:
    """Extract shipping-relevant signals from context."""
    combined = f"{prompt}\n{project_context}\n{session_context}".lower()

    signals = {
        "has_auth": any(w in combined for w in ["auth", "login", "session", "token", "jwt", "oauth", "credential"]),
        "has_db": any(w in combined for w in ["database", "db", "sql", "migration", "schema", "drizzle", "prisma"]),
        "has_api": any(w in combined for w in ["api", "endpoint", "route", "handler", "rest", "graphql", "rpc"]),
        "has_tests": any(w in combined for w in ["test", "spec", "jest", "vitest", "bun:test", "pytest", "coverage"]),
        "has_deploy": any(w in combined for w in ["deploy", "ci", "cd", "docker", "kubernetes", "pipeline", "release"]),
        "has_security": any(w in combined for w in ["security", "vulnerability", "xss", "csrf", "injection", "encrypt"]),
        "has_performance": any(w in combined for w in ["performance", "latency", "memory", "cache", "optimize", "slow"]),
        "has_types": any(w in combined for w in ["type", "typescript", "schema", "zod", "effect", "validation"]),
        "has_error_handling": any(w in combined for w in ["error", "exception", "catch", "throw", "fault", "crash"]),
        "has_refactor": any(w in combined for w in ["refactor", "cleanup", "restructure", "simplify", "dead code"]),
        "has_breaking_change": any(w in combined for w in ["breaking", "migration", "upgrade", "backward", "compat"]),
        "has_frontend": any(w in combined for w in ["ui", "frontend", "react", "component", "render", "dom"]),
        "has_concurrency": any(w in combined for w in ["async", "concurrent", "parallel", "race", "deadlock", "fiber"]),
        "has_monitoring": any(w in combined for w in ["monitor", "log", "observ", "trace", "metric", "alert"]),
        "complexity_high": any(w in combined for w in ["complex", "difficult", "challenging", "critical", "major"]),
    }
    return signals


# ---------------------------------------------------------------------------
# Question templates
# ---------------------------------------------------------------------------

QUESTION_TEMPLATES = {
    "has_auth": [
        "Are authentication tokens properly validated and expired on all endpoints?",
        "Is credential storage encrypted at rest and never logged in plaintext?",
        "Have you tested session fixation and token replay attack vectors?",
        "Are OAuth refresh token flows handling network failures gracefully?",
        "Is there a logout path that invalidates all server-side sessions?",
    ],
    "has_db": [
        "Are all database migrations backward-compatible for zero-downtime deploy?",
        "Is there a rollback plan if the migration fails midway?",
        "Are query timeouts set to prevent long-running locks from blocking writes?",
        "Have you verified that N+1 queries aren't hiding in the hot path?",
        "Is sensitive data encrypted at the database column level?",
    ],
    "has_api": [
        "Are all API endpoints documented with request/response schemas?",
        "Is rate limiting applied to prevent abuse of public endpoints?",
        "Have you validated that error responses don't leak internal stack traces?",
        "Are API versioning and deprecation timelines communicated to consumers?",
        "Is there idempotency handling for non-GET requests that may be retried?",
    ],
    "has_tests": [
        "Do integration tests cover the failure paths, not just happy paths?",
        "Is test coverage above 80% for critical business logic modules?",
        "Are flaky tests identified and either fixed or quarantined?",
        "Have edge cases around boundary values (0, null, empty, max) been tested?",
        "Do tests verify error messages are user-facing, not internal?",
    ],
    "has_deploy": [
        "Is there a canary or staged rollout plan for this deployment?",
        "Are health check endpoints returning meaningful status, not just 200 OK?",
        "Is the rollback procedure documented and tested within the last quarter?",
        "Are environment variables and secrets injected at deploy time, not baked in?",
        "Have you verified the deployment works on a clean environment (no cached state)?",
    ],
    "has_security": [
        "Have all user inputs been sanitized against injection attacks?",
        "Is CORS configured to allow only trusted origins?",
        "Are security headers (CSP, HSTS, X-Frame-Options) properly set?",
        "Has the OWASP Top 10 checklist been reviewed for this change?",
        "Are secrets rotated and never committed to version control?",
    ],
    "has_performance": [
        "Have you profiled the hot path to identify CPU and memory bottlenecks?",
        "Are database queries using appropriate indexes for the expected data volume?",
        "Is there a caching strategy for expensive computations or API calls?",
        "Have you load-tested at 2x the expected peak traffic?",
        "Are there any synchronous blocking calls in the async event loop?",
    ],
    "has_types": [
        "Are all external API boundaries validated with runtime type checking (not just compile-time)?",
        "Have you verified that branded types (IDs, paths) are consistently used across modules?",
        "Are schema definitions in sync with the actual data shapes returned by the API?",
        "Is the error type union complete — does it cover all failure modes, not just the common ones?",
        "Have you checked for any `any` types that leak through module boundaries?",
    ],
    "has_error_handling": [
        "Are all error paths tested — what happens when the network is down?",
        "Do error messages provide enough context for debugging without exposing internals?",
        "Is there a circuit breaker for external service calls that may be down?",
        "Are errors properly categorized (recoverable vs. fatal) and handled accordingly?",
        "Have you verified that cleanup code runs even when errors occur mid-operation?",
    ],
    "has_refactor": [
        "Have you verified that the refactored code passes the same test suite as the original?",
        "Are there any behavioral changes hidden in the refactor that need explicit testing?",
        "Is the new code structure documented so future developers understand the pattern?",
        "Have dead code paths been removed rather than left as commented-out blocks?",
        "Are the module boundaries after refactoring clean — no circular dependencies?",
    ],
    "has_breaking_change": [
        "Is there a migration guide for consumers affected by this breaking change?",
        "Are deprecated APIs still functional for at least one release cycle?",
        "Have all downstream consumers been notified of the breaking change timeline?",
        "Is the version number bumped according to semver (major for breaking changes)?",
        "Are there feature flags to allow gradual migration away from the old behavior?",
    ],
    "has_frontend": [
        "Have you tested the UI at different viewport sizes and accessibility modes?",
        "Are loading states and error states handled for all async data fetches?",
        "Is the component rendered correctly with both empty and overflow data?",
        "Have you verified that keyboard navigation works for all interactive elements?",
        "Are there any hydration mismatches between server-rendered and client-rendered HTML?",
    ],
    "has_concurrency": [
        "Have you identified and protected all shared mutable state with proper synchronization?",
        "Are there potential race conditions in the read-modify-write patterns?",
        "Is the fiber/task cancellation handling correct — does it clean up resources?",
        "Have you tested the behavior under high contention (many concurrent requests)?",
        "Are timeouts set on all async operations to prevent indefinite hangs?",
    ],
    "has_monitoring": [
        "Are structured logs emitted for all critical business operations?",
        "Is there a dashboard that shows the health of this feature in production?",
        "Are alerts configured for error rate spikes and latency degradation?",
        "Is the logging level appropriate — not too verbose for production, not too sparse for debugging?",
        "Are trace IDs propagated across service boundaries for request tracking?",
    ],
    "complexity_high": [
        "Have you written an Architecture Decision Record (ADR) for this design choice?",
        "Is the complexity justified — could a simpler solution meet 80% of the requirements?",
        "Have you identified the blast radius if this component fails in production?",
        "Is there a feature flag to disable this change without a full redeployment?",
        "Have you reviewed this change with someone who hasn't worked on it (fresh eyes)?",
    ],
    "general": [
        "Does the code handle the empty state correctly (no data, first run, clean install)?",
        "Are all external dependencies pinned to specific versions (no floating ranges)?",
        "Is the change backward-compatible with the previous API contract?",
        "Have you verified that the build succeeds on a clean checkout (no local state)?",
        "Are there any hardcoded values that should be configurable via environment variables?",
        "Does the implementation match the specification — not more, not less?",
        "Have you checked for memory leaks in long-running processes or event listeners?",
        "Is the error propagation chain complete from the lowest layer to the user-facing message?",
        "Have you considered the failure mode where the external service returns unexpected data?",
        "Are there any TODOs or FIXMEs that should be resolved before shipping?",
    ],
}


# ---------------------------------------------------------------------------
# Question generation
# ---------------------------------------------------------------------------

def generate_questions(
    prompt: str,
    project_context: str,
    session_context: str,
    previous_questions: list[dict],
    neuro_enrichment: str | None = None,
    count: int = 5,
) -> list[str]:
    """Generate unique shipping checklist questions based on context."""
    signals = extract_signals(prompt, project_context, session_context)

    # Collect candidate questions from matching signal categories
    candidates: list[str] = []
    for signal, active in signals.items():
        if active and signal in QUESTION_TEMPLATES:
            candidates.extend(QUESTION_TEMPLATES[signal])

    # Always include some general questions
    candidates.extend(QUESTION_TEMPLATES["general"])

    # Add NEURO-enriched questions if available
    if neuro_enrichment:
        neuro_questions = extract_neuro_questions(neuro_enrichment)
        candidates.extend(neuro_questions)

    # Shuffle for variety
    random.shuffle(candidates)

    # Filter duplicates
    selected: list[str] = []
    seen_hashes: set[str] = set()
    log_hashes = {
        entry.get("question_hash", "")
        for entry in previous_questions
    }

    for q in candidates:
        q_hash = hashlib.sha256(q.lower().strip().encode()).hexdigest()
        if q_hash not in log_hashes and q_hash not in seen_hashes:
            selected.append(q)
            seen_hashes.add(q_hash)
            if len(selected) >= count:
                break

    # If we don't have enough unique questions, generate variations
    if len(selected) < count:
        for q in candidates:
            if len(selected) >= count:
                break
            variation = f"In the context of the current changes: {q}"
            v_hash = hashlib.sha256(variation.lower().strip().encode()).hexdigest()
            if v_hash not in log_hashes and v_hash not in seen_hashes:
                selected.append(variation)
                seen_hashes.add(v_hash)

    return selected[:count]


def extract_neuro_questions(neuro_output: str) -> list[str]:
    """Extract actionable questions from NEURO analysis output."""
    questions: list[str] = []
    try:
        data = json.loads(neuro_output)
        response = data.get("response", {})
        findings = response.get("findings", [])
        for finding in findings:
            if isinstance(finding, dict):
                desc = finding.get("description", "")
                if desc and len(desc) > 20:
                    questions.append(f"Has the following been addressed: {desc[:200]}?")
            elif isinstance(finding, str) and len(finding) > 20:
                questions.append(f"Has the following been addressed: {finding[:200]}?")
    except (json.JSONDecodeError, AttributeError):
        # Try line-based extraction for non-JSON NEURO output
        for line in neuro_output.split("\n"):
            line = line.strip()
            if line.startswith("- ") and len(line) > 30:
                questions.append(f"Has the following been verified: {line[2:200]}?")
    return questions[:5]


# ---------------------------------------------------------------------------
# Context hashing
# ---------------------------------------------------------------------------

def context_hash(prompt: str, project_context: str) -> str:
    """Hash the context for log dedup."""
    combined = f"{prompt}|{project_context}"
    return hashlib.sha256(combined.encode()).hexdigest()[:16]


# ---------------------------------------------------------------------------
# Project context scanning
# ---------------------------------------------------------------------------

def scan_project_context(project_root: Path) -> str:
    """Scan project for structural context."""
    parts: list[str] = []

    # Detect language/framework
    if (project_root / "package.json").exists():
        try:
            pkg = json.loads((project_root / "package.json").read_text())
            deps = list(pkg.get("dependencies", {}).keys())
            dev_deps = list(pkg.get("devDependencies", {}).keys())
            parts.append(f"JavaScript/TypeScript project. Dependencies: {', '.join(deps[:10])}")
            if dev_deps:
                parts.append(f"Dev dependencies: {', '.join(dev_deps[:5])}")
        except (json.JSONDecodeError, OSError):
            parts.append("JavaScript/TypeScript project (package.json unreadable)")

    if (project_root / "tsconfig.json").exists():
        parts.append("TypeScript configured")

    if (project_root / "pyproject.toml").exists():
        parts.append("Python project")

    # Count source files
    src_count = 0
    for ext in ["*.ts", "*.tsx", "*.js", "*.jsx", "*.py"]:
        src_count += len(list(project_root.rglob(ext)))
    if src_count:
        parts.append(f"{src_count} source files")

    # Check for test directories
    test_dirs = ["test", "tests", "__tests__", "spec"]
    for d in test_dirs:
        if (project_root / d).is_dir():
            parts.append(f"Has {d}/ directory")

    # Check for CI
    if (project_root / ".github" / "workflows").is_dir():
        parts.append("GitHub Actions CI configured")

    return ". ".join(parts) if parts else "Unknown project structure"


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Shipping Checklist Question Generator")
    parser.add_argument("--prompt", default="", help="User prompt / task description")
    parser.add_argument("--prompt-file", help="Read prompt from file (avoids stdin issues)")
    parser.add_argument("--project-root", default=str(PROJECT_ROOT), help="Project root directory")
    parser.add_argument("--session-context", default="", help="Current session context")
    parser.add_argument("--neuro-result", default="", help="NEURO analysis output for enrichment")
    parser.add_argument("--count", type=int, default=5, help="Number of questions to generate")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    args = parser.parse_args()

    prompt = args.prompt
    if args.prompt_file:
        try:
            prompt = Path(args.prompt_file).read_text()
        except OSError:
            pass

    prompt = sanitize_prompt(prompt)
    project_root = Path(args.project_root)

    project_context = scan_project_context(project_root)
    session_context = args.session_context or ""
    neuro_enrichment = args.neuro_result or None

    # Load previous questions for dedup
    log = load_question_log()

    # Generate with retry on duplicate
    questions: list[str] = []
    for attempt in range(MAX_RETRIES):
        questions = generate_questions(
            prompt, project_context, session_context, log,
            neuro_enrichment=neuro_enrichment,
            count=args.count,
        )
        if questions:
            break
        # All duplicates — clear oldest entries and retry
        if len(log) > 100:
            log = log[-50:]
        random.seed()  # Re-seed for variety

    if not questions:
        # Absolute fallback
        questions = [
            "Have all error paths been tested before shipping?",
            "Is the change backward-compatible with existing consumers?",
            "Are there any hardcoded values that should be configurable?",
            "Have you verified the build succeeds on a clean checkout?",
            "Is the error propagation chain complete to the user-facing layer?",
        ]

    # Persist to log
    c_hash = context_hash(prompt, project_context)
    append_question_log(questions, c_hash)

    # Output
    if args.json:
        output = {
            "questions": questions,
            "context_hash": c_hash,
            "signals": extract_signals(prompt, project_context, session_context),
            "project_context": project_context,
            "timestamp": datetime.now(UTC).isoformat(),
        }
        print(json.dumps(output, indent=2))
    else:
        print("=== Shipping Checklist Questions ===")
        print(f"Context: {project_context[:200]}")
        print(f"Generated: {len(questions)} unique questions\n")
        for i, q in enumerate(questions, 1):
            print(f"  {i}. {q}")
        print(f"\nContext hash: {c_hash}")
        print(f"Log entries: {len(load_question_log())}")


if __name__ == "__main__":
    main()

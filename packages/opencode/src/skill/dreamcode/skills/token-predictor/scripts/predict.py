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
EVOLUTION_DIR = Path.home() / ".dreamcode" / "evolution"


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


def append_question_log(questions: list[str | dict], context_hash: str) -> None:
    """Append generated questions (with complexity) to the JSONL log."""
    EVOLUTION_DIR.mkdir(parents=True, exist_ok=True)
    now = datetime.now(UTC).isoformat()
    with open(QUESTION_LOG, "a") as f:
        for q in questions:
            q_text = q["question"] if isinstance(q, dict) else q
            q_complexity = q.get("complexity", "low") if isinstance(q, dict) else "low"
            entry = {
                "timestamp": now,
                "question": q_text,
                "complexity": q_complexity,
                "question_hash": hashlib.sha256(q_text.lower().strip().encode()).hexdigest(),
                "context_hash": context_hash,
                "last_used": time.time(),
                "hit_count": 1,
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

# Each question now carries a complexity rating:
#   "low"    → 0-1 subagents (trivial, well-understood, single-domain)
#   "medium" → 1-3 subagents (moderate depth, multi-domain, needs analysis)
#   "high"   → 2-5 subagents (architecture, security, cross-cutting concerns)

QUESTION_TEMPLATES = {
    "has_auth": [
        {"question": "Are authentication tokens properly validated and expired on all endpoints?", "complexity": "high"},
        {"question": "Is credential storage encrypted at rest and never logged in plaintext?", "complexity": "high"},
        {"question": "Have you tested session fixation and token replay attack vectors?", "complexity": "medium"},
        {"question": "Are OAuth refresh token flows handling network failures gracefully?", "complexity": "medium"},
        {"question": "Is there a logout path that invalidates all server-side sessions?", "complexity": "low"},
    ],
    "has_db": [
        {"question": "Are all database migrations backward-compatible for zero-downtime deploy?", "complexity": "high"},
        {"question": "Is there a rollback plan if the migration fails midway?", "complexity": "medium"},
        {"question": "Are query timeouts set to prevent long-running locks from blocking writes?", "complexity": "medium"},
        {"question": "Have you verified that N+1 queries aren't hiding in the hot path?", "complexity": "medium"},
        {"question": "Is sensitive data encrypted at the database column level?", "complexity": "high"},
    ],
    "has_api": [
        {"question": "Are all API endpoints documented with request/response schemas?", "complexity": "low"},
        {"question": "Is rate limiting applied to prevent abuse of public endpoints?", "complexity": "medium"},
        {"question": "Have you validated that error responses don't leak internal stack traces?", "complexity": "high"},
        {"question": "Are API versioning and deprecation timelines communicated to consumers?", "complexity": "medium"},
        {"question": "Is there idempotency handling for non-GET requests that may be retried?", "complexity": "medium"},
    ],
    "has_tests": [
        {"question": "Do integration tests cover the failure paths, not just happy paths?", "complexity": "medium"},
        {"question": "Is test coverage above 80% for critical business logic modules?", "complexity": "low"},
        {"question": "Are flaky tests identified and either fixed or quarantined?", "complexity": "low"},
        {"question": "Have edge cases around boundary values (0, null, empty, max) been tested?", "complexity": "medium"},
        {"question": "Do tests verify error messages are user-facing, not internal?", "complexity": "low"},
    ],
    "has_deploy": [
        {"question": "Is there a canary or staged rollout plan for this deployment?", "complexity": "medium"},
        {"question": "Are health check endpoints returning meaningful status, not just 200 OK?", "complexity": "low"},
        {"question": "Is the rollback procedure documented and tested within the last quarter?", "complexity": "medium"},
        {"question": "Are environment variables and secrets injected at deploy time, not baked in?", "complexity": "high"},
        {"question": "Have you verified the deployment works on a clean environment (no cached state)?", "complexity": "low"},
    ],
    "has_security": [
        {"question": "Have all user inputs been sanitized against injection attacks?", "complexity": "high"},
        {"question": "Is CORS configured to allow only trusted origins?", "complexity": "high"},
        {"question": "Are security headers (CSP, HSTS, X-Frame-Options) properly set?", "complexity": "medium"},
        {"question": "Has the OWASP Top 10 checklist been reviewed for this change?", "complexity": "high"},
        {"question": "Are secrets rotated and never committed to version control?", "complexity": "high"},
    ],
    "has_performance": [
        {"question": "Have you profiled the hot path to identify CPU and memory bottlenecks?", "complexity": "medium"},
        {"question": "Are database queries using appropriate indexes for the expected data volume?", "complexity": "medium"},
        {"question": "Is there a caching strategy for expensive computations or API calls?", "complexity": "medium"},
        {"question": "Have you load-tested at 2x the expected peak traffic?", "complexity": "high"},
        {"question": "Are there any synchronous blocking calls in the async event loop?", "complexity": "high"},
    ],
    "has_types": [
        {"question": "Are all external API boundaries validated with runtime type checking (not just compile-time)?", "complexity": "medium"},
        {"question": "Have you verified that branded types (IDs, paths) are consistently used across modules?", "complexity": "low"},
        {"question": "Are schema definitions in sync with the actual data shapes returned by the API?", "complexity": "medium"},
        {"question": "Is the error type union complete — does it cover all failure modes, not just the common ones?", "complexity": "high"},
        {"question": "Have you checked for any `any` types that leak through module boundaries?", "complexity": "low"},
    ],
    "has_error_handling": [
        {"question": "Are all error paths tested — what happens when the network is down?", "complexity": "high"},
        {"question": "Do error messages provide enough context for debugging without exposing internals?", "complexity": "low"},
        {"question": "Is there a circuit breaker for external service calls that may be down?", "complexity": "medium"},
        {"question": "Are errors properly categorized (recoverable vs. fatal) and handled accordingly?", "complexity": "medium"},
        {"question": "Have you verified that cleanup code runs even when errors occur mid-operation?", "complexity": "high"},
    ],
    "has_refactor": [
        {"question": "Have you verified that the refactored code passes the same test suite as the original?", "complexity": "low"},
        {"question": "Are there any behavioral changes hidden in the refactor that need explicit testing?", "complexity": "medium"},
        {"question": "Is the new code structure documented so future developers understand the pattern?", "complexity": "low"},
        {"question": "Have dead code paths been removed rather than left as commented-out blocks?", "complexity": "low"},
        {"question": "Are the module boundaries after refactoring clean — no circular dependencies?", "complexity": "medium"},
    ],
    "has_breaking_change": [
        {"question": "Is there a migration guide for consumers affected by this breaking change?", "complexity": "medium"},
        {"question": "Are deprecated APIs still functional for at least one release cycle?", "complexity": "high"},
        {"question": "Have all downstream consumers been notified of the breaking change timeline?", "complexity": "low"},
        {"question": "Is the version number bumped according to semver (major for breaking changes)?", "complexity": "low"},
        {"question": "Are there feature flags to allow gradual migration away from the old behavior?", "complexity": "high"},
    ],
    "has_frontend": [
        {"question": "Have you tested the UI at different viewport sizes and accessibility modes?", "complexity": "low"},
        {"question": "Are loading states and error states handled for all async data fetches?", "complexity": "medium"},
        {"question": "Is the component rendered correctly with both empty and overflow data?", "complexity": "low"},
        {"question": "Have you verified that keyboard navigation works for all interactive elements?", "complexity": "low"},
        {"question": "Are there any hydration mismatches between server-rendered and client-rendered HTML?", "complexity": "high"},
    ],
    "has_concurrency": [
        {"question": "Have you identified and protected all shared mutable state with proper synchronization?", "complexity": "high"},
        {"question": "Are there potential race conditions in the read-modify-write patterns?", "complexity": "high"},
        {"question": "Is the fiber/task cancellation handling correct — does it clean up resources?", "complexity": "medium"},
        {"question": "Have you tested the behavior under high contention (many concurrent requests)?", "complexity": "medium"},
        {"question": "Are timeouts set on all async operations to prevent indefinite hangs?", "complexity": "low"},
    ],
    "has_monitoring": [
        {"question": "Are structured logs emitted for all critical business operations?", "complexity": "low"},
        {"question": "Is there a dashboard that shows the health of this feature in production?", "complexity": "low"},
        {"question": "Are alerts configured for error rate spikes and latency degradation?", "complexity": "medium"},
        {"question": "Is the logging level appropriate — not too verbose for production, not too sparse for debugging?", "complexity": "low"},
        {"question": "Are trace IDs propagated across service boundaries for request tracking?", "complexity": "high"},
    ],
    "complexity_high": [
        {"question": "Have you written an Architecture Decision Record (ADR) for this design choice?", "complexity": "high"},
        {"question": "Is the complexity justified — could a simpler solution meet 80% of the requirements?", "complexity": "high"},
        {"question": "Have you identified the blast radius if this component fails in production?", "complexity": "high"},
        {"question": "Is there a feature flag to disable this change without a full redeployment?", "complexity": "medium"},
        {"question": "Have you reviewed this change with someone who hasn't worked on it (fresh eyes)?", "complexity": "medium"},
    ],
    "general": [
        {"question": "Does the code handle the empty state correctly (no data, first run, clean install)?", "complexity": "low"},
        {"question": "Are all external dependencies pinned to specific versions (no floating ranges)?", "complexity": "low"},
        {"question": "Is the change backward-compatible with the previous API contract?", "complexity": "medium"},
        {"question": "Have you verified that the build succeeds on a clean checkout (no local state)?", "complexity": "low"},
        {"question": "Are there any hardcoded values that should be configurable via environment variables?", "complexity": "low"},
        {"question": "Does the implementation match the specification — not more, not less?", "complexity": "low"},
        {"question": "Have you checked for memory leaks in long-running processes or event listeners?", "complexity": "high"},
        {"question": "Is the error propagation chain complete from the lowest layer to the user-facing message?", "complexity": "medium"},
        {"question": "Have you considered the failure mode where the external service returns unexpected data?", "complexity": "medium"},
        {"question": "Are there any TODOs or FIXMEs that should be resolved before shipping?", "complexity": "low"},
    ],
}


# ---------------------------------------------------------------------------
# Question Store — persistent rated question database with evolution support
# ---------------------------------------------------------------------------

class QuestionStore:
    """Persistent store for rated questions with decay and evolution."""

    def __init__(self, path: Path = QUESTION_LOG):
        self.path = path

    def load_rated(self) -> list[dict]:
        """Load questions with their ratings and stats."""
        entries = load_question_log()
        # Merge with template-defined complexity ratings where available
        rated: list[dict] = []
        for entry in entries:
            q = entry.get("question", "")
            complexity = entry.get("complexity", None)
            if not complexity:
                complexity = self._infer_complexity(q)
            rated.append({
                "question": q,
                "question_hash": entry.get("question_hash", hashlib.sha256(q.lower().strip().encode()).hexdigest()),
                "complexity": complexity,
                "category": self._categorize(q),
                "last_used": entry.get("last_used", 0),
                "hit_count": entry.get("hit_count", 1),
            })
        return rated

    def get_by_complexity(self, level: str) -> list[dict]:
        """Filter questions by complexity rating."""
        return [q for q in self.load_rated() if q["complexity"] == level]

    def decay_stale(self, max_age_days: int = 30) -> int:
        """Remove questions not seen in N days."""
        entries = load_question_log()
        now = time.time()
        cutoff = now - (max_age_days * 86400)
        fresh = [e for e in entries if e.get("last_used", now) > cutoff]
        removed = len(entries) - len(fresh)
        if removed > 0:
            EVOLUTION_DIR.mkdir(parents=True, exist_ok=True)
            with open(self.path, "w") as f:
                for entry in fresh:
                    f.write(json.dumps(entry) + "\n")
        return removed

    def _infer_complexity(self, question: str) -> str:
        """Infer a question's complexity when it lacks an explicit rating."""
        q = question.lower()
        high_keywords = ["architect", "security", "encrypt", "migration", "blast radius",
                         "adr", "deadlock", "race condition", "owasp", "cors", "csrf"]
        medium_keywords = ["backward", "compat", "rollback", "timeout", "rate limit",
                           "circuit breaker", "n+1", "versioning", "idempotency"]
        if any(w in q for w in high_keywords):
            return "high"
        if any(w in q for w in medium_keywords):
            return "medium"
        return "low"

    def _categorize(self, question: str) -> str:
        """Categorize a question by its topic."""
        q = question.lower()
        if any(w in q for w in ["auth", "credential", "token", "session"]):
            return "security"
        if any(w in q for w in ["database", "migration", "query", "sql"]):
            return "data"
        if any(w in q for w in ["test", "coverage", "edge case"]):
            return "testing"
        if any(w in q for w in ["deploy", "rollback", "release"]):
            return "deployment"
        if any(w in q for w in ["performance", "latency", "cache"]):
            return "performance"
        if any(w in q for w in ["error", "exception", "fault"]):
            return "reliability"
        return "general"


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
) -> list[dict]:
    """Generate unique rated shipping checklist questions based on context."""
    signals = extract_signals(prompt, project_context, session_context)

    # Collect candidate question dicts from matching signal categories
    candidates: list[dict] = []
    for signal, active in signals.items():
        if active and signal in QUESTION_TEMPLATES:
            candidates.extend(QUESTION_TEMPLATES[signal])

    # Always include some general questions
    candidates.extend(QUESTION_TEMPLATES["general"])

    # Add NEURO-enriched questions if available
    if neuro_enrichment:
        neuro_questions = extract_neuro_questions(neuro_enrichment)
        for nq in neuro_questions:
            candidates.append({"question": nq, "complexity": "medium"})

    # Shuffle for variety
    random.shuffle(candidates)

    # Filter duplicates
    selected: list[dict] = []
    seen_hashes: set[str] = set()
    log_hashes = {
        entry.get("question_hash", "")
        for entry in previous_questions
    }

    for c in candidates:
        q = c["question"] if isinstance(c, dict) else c
        q_hash = hashlib.sha256(q.lower().strip().encode()).hexdigest()
        if q_hash not in log_hashes and q_hash not in seen_hashes:
            selected.append({"question": q, "complexity": c.get("complexity", "low")} if isinstance(c, dict) else {"question": c, "complexity": "low"})
            seen_hashes.add(q_hash)
            if len(selected) >= count:
                break

    # If we don't have enough unique questions, generate variations
    if len(selected) < count:
        for c in candidates:
            if len(selected) >= count:
                break
            q = c["question"] if isinstance(c, dict) else c
            variation = f"In the context of the current changes: {q}"
            v_hash = hashlib.sha256(variation.lower().strip().encode()).hexdigest()
            if v_hash not in log_hashes and v_hash not in seen_hashes:
                selected.append({"question": variation, "complexity": c.get("complexity", "low")} if isinstance(c, dict) else {"question": variation, "complexity": "low"})
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
    questions: list[dict] = []
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
        # Absolute fallback with default ratings
        questions = [
            {"question": "Have all error paths been tested before shipping?", "complexity": "medium"},
            {"question": "Is the change backward-compatible with existing consumers?", "complexity": "medium"},
            {"question": "Are there any hardcoded values that should be configurable?", "complexity": "low"},
            {"question": "Have you verified the build succeeds on a clean checkout?", "complexity": "low"},
            {"question": "Is the error propagation chain complete to the user-facing layer?", "complexity": "medium"},
        ]

    # Persist to log
    c_hash = context_hash(prompt, project_context)
    append_question_log(questions, c_hash)

    # Compute aggregate complexity from generated questions
    complexity_levels = [q.get("complexity", "low") for q in questions]
    max_complexity = "high" if "high" in complexity_levels else ("medium" if "medium" in complexity_levels else "low")

    # Output
    if args.json:
        output = {
            "questions": questions,
            "max_complexity": max_complexity,
            "context_hash": c_hash,
            "signals": extract_signals(prompt, project_context, session_context),
            "project_context": project_context,
            "timestamp": datetime.now(UTC).isoformat(),
        }
        print(json.dumps(output, indent=2))
    else:
        print("=== Shipping Checklist Questions ===")
        print(f"Context: {project_context[:200]}")
        print(f"Max Complexity: {max_complexity}")
        print(f"Generated: {len(questions)} unique questions\n")
        for i, q in enumerate(questions, 1):
            q_text = q["question"] if isinstance(q, dict) else q
            q_comp = q.get("complexity", "?") if isinstance(q, dict) else "?"
            print(f"  {i}. [{q_comp}] {q_text}")
        print(f"\nContext hash: {c_hash}")
        print(f"Log entries: {len(load_question_log())}")


if __name__ == "__main__":
    main()

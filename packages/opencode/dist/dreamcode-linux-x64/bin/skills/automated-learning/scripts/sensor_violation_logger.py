#!/usr/bin/env python3
"""
SENSOR Automation Violation Logger

Logs when the SENSOR automation is skipped or incomplete.
Used by the agent to self-track compliance.
"""

import json
from datetime import datetime, timezone
UTC = timezone.utc  # Python 3.2+ compat (not 3.11+ only)
from pathlib import Path

VIOLATIONS_FILE = Path(__file__).parent.parent / "evolution" / "automation_violations.jsonl"


def log_violation(
    violation_type: str,
    prompt_excerpt: str,
    missing_stages: list[str],
    notes: str = "",
) -> None:
    """Log a SENSOR automation violation."""
    VIOLATIONS_FILE.parent.mkdir(parents=True, exist_ok=True)

    entry = {
        "timestamp": datetime.now(UTC).isoformat(),
        "violation_type": violation_type,
        "prompt_excerpt": prompt_excerpt[:200],
        "missing_stages": missing_stages,
        "notes": notes,
    }

    with open(VIOLATIONS_FILE, "a") as f:
        f.write(json.dumps(entry) + "\n")


def log_near_miss(
    prompt_excerpt: str,
    missing_stages: list[str],
    recovered: bool = True,
) -> None:
    """Log a near-miss (caught before final response)."""
    log_violation(
        violation_type="near_miss" if recovered else "violation",
        prompt_excerpt=prompt_excerpt,
        missing_stages=missing_stages,
        notes=f"Recovered: {recovered}",
    )


def get_violation_count() -> int:
    """Get total number of violations."""
    if not VIOLATIONS_FILE.exists():
        return 0
    with open(VIOLATIONS_FILE) as f:
        return sum(1 for line in f if line.strip())


def get_recent_violations(limit: int = 10) -> list[dict]:
    """Get recent violations."""
    if not VIOLATIONS_FILE.exists():
        return []
    violations = []
    with open(VIOLATIONS_FILE) as f:
        for line in f:
            if line.strip():
                violations.append(json.loads(line))
    return violations[-limit:]


def print_violation_report() -> None:
    """Print a violation report."""
    count = get_violation_count()
    recent = get_recent_violations(5)

    print("=== SENSOR Automation Violation Report ===")
    print(f"Total violations: {count}")
    print()

    if recent:
        print("Recent violations:")
        for v in recent:
            print(f"  [{v['timestamp']}] {v['violation_type']}: {v['missing_stages']}")
            print(f"    Prompt: {v['prompt_excerpt'][:80]}...")
    else:
        print("No violations recorded.")


if __name__ == "__main__":
    print_violation_report()

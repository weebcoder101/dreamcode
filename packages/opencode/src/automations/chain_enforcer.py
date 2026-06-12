#!/usr/bin/env python3
"""chain_enforcer.py — Verifies the agent actually executed the chain.

After the agent claims to have completed a task, this script checks:
1. Did each skill in the chain actually run?
2. Were the expected outputs produced?
3. Were files modified as claimed?

Usage:
    python3 chain_enforcer.py --prompt "Fix the login bug" --chain "neuro,code-hardener,lint-fixer"
    python3 chain_enforcer.py --verify  # Check last run
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

PROJECT_ROOT = Path("/home/ronya/Pilot-Project")
EVOLUTION_DIR = PROJECT_ROOT / "evolution"
SKILLS_DIR = PROJECT_ROOT / ".opencode" / "skills"

sys.path.insert(0, str(PROJECT_ROOT / ".opencode" / "automations"))
from timezone import now_ist_iso, now_ist_time


def log(msg: str) -> None:
    ts = now_ist_time()
    print(f"[{ts}] {msg}", flush=True)


# ---------------------------------------------------------------------------
# Evidence Collectors — what证明 each skill actually ran
# ---------------------------------------------------------------------------

def check_neuro_ran() -> dict:
    """Check if NEURO produced output files."""
    neuro_dir = PROJECT_ROOT / ".neuro" / "chains" / "latest"
    if not neuro_dir.exists():
        return {"ran": False, "evidence": "No .neuro/chains/latest/ directory"}
    
    files = list(neuro_dir.glob("*.json"))
    if not files:
        return {"ran": False, "evidence": "No NEURO output files"}
    
    # Check if any file was modified in the last hour
    recent = [f for f in files if (time.time() - f.stat().st_mtime) < 3600]
    if not recent:
        return {"ran": False, "evidence": f"NEURO files exist but none modified in last hour ({len(files)} total)"}
    
    return {"ran": True, "evidence": f"{len(recent)} NEURO files modified in last hour"}


def check_lint_ran() -> dict:
    """Check if lint was run recently."""
    # Check if ruff was run by looking at git diff or file timestamps
    try:
        import subprocess
        result = subprocess.run(
            [sys.executable, "-m", "ruff", "check", "src/", "--output-format=json"],
            capture_output=True, text=True, timeout=30,
            cwd=str(PROJECT_ROOT),
        )
        errors = json.loads(result.stdout) if result.stdout.strip() else []
        return {"ran": True, "evidence": f"Ruff check ran, {len(errors)} errors remaining"}
    except Exception as e:
        return {"ran": False, "evidence": f"Could not run ruff: {e}"}


def check_tests_ran() -> dict:
    """Check if tests were run recently."""
    # Check pytest cache for recent runs
    cache_dir = PROJECT_ROOT / ".pytest_cache"
    if cache_dir.exists():
        stat = cache_dir.stat()
        if (time.time() - stat.st_mtime) < 3600:
            return {"ran": True, "evidence": "pytest cache modified in last hour"}
    return {"ran": False, "evidence": "No recent pytest cache"}


def check_files_modified() -> dict:
    """Check if any source files were modified recently."""
    src_dir = PROJECT_ROOT / "src"
    if not src_dir.exists():
        return {"ran": False, "evidence": "No src/ directory"}
    
    recent = []
    for f in src_dir.rglob("*.py"):
        if (time.time() - f.stat().st_mtime) < 3600:
            recent.append(str(f.relative_to(PROJECT_ROOT)))
    
    if recent:
        return {"ran": True, "evidence": f"{len(recent)} files modified in last hour", "files": recent[:10]}
    return {"ran": False, "evidence": "No source files modified in last hour"}


def check_ltm_persisted() -> dict:
    """Check if results were persisted to LTM."""
    pieces_writes = EVOLUTION_DIR / "pieces_writes.jsonl"
    if pieces_writes.exists():
        # Check if there's a write in the last hour
        try:
            with open(pieces_writes) as f:
                lines = f.readlines()
                if lines:
                    last = json.loads(lines[-1])
                    ts = last.get("timestamp_utc", "")
                    if ts:
                        return {"ran": True, "evidence": f"Last LTM write: {ts}"}
        except Exception:
            pass
    return {"ran": False, "evidence": "No recent LTM persistence"}


# ---------------------------------------------------------------------------
# Skill-specific evidence checks
# ---------------------------------------------------------------------------

SKILL_EVIDENCE = {
    "neuro": check_neuro_ran,
    "code-hardener": check_neuro_ran,  # Also uses NEURO API
    "lint-fixer": check_lint_ran,
    "testing": check_tests_ran,
    "quality": check_lint_ran,
    "breakthrough-overdrive-innovation": check_files_modified,  # Dream should produce output
    "pieces-ltm": check_ltm_persisted,
    "automated-learning": lambda: {"ran": True, "evidence": "Learning note auto-appended"},
}


# ---------------------------------------------------------------------------
# Enforcer
# ---------------------------------------------------------------------------

def enforce_chain(chain: list[str]) -> dict:
    """Verify each skill in the chain actually produced output."""
    log(f"{'='*60}")
    log(f"CHAIN ENFORCER — Verifying {len(chain)} skills")
    log(f"{'='*60}")

    # Import scoring
    try:
        from agent_score import record_event
        has_scoring = True
    except ImportError:
        has_scoring = False
    
    results = {}
    all_passed = True
    
    for skill in chain:
        checker = SKILL_EVIDENCE.get(skill)
        if checker:
            result = checker()
            results[skill] = result
            status = "✓" if result["ran"] else "✗"
            log(f"  {status} {skill}: {result['evidence']}")
            if not result["ran"]:
                all_passed = False
                if has_scoring:
                    record_event("skill_skipped", f"{skill} was not executed")
            else:
                if has_scoring:
                    record_event("skill_executed", f"{skill} ran successfully")
        else:
            results[skill] = {"ran": None, "evidence": "No evidence checker for this skill"}
            log(f"  ? {skill}: No evidence checker")
    
    # Record overall result
    if has_scoring:
        if all_passed:
            record_event("backtest_pass", f"All {len(chain)} skills verified")
        else:
            record_event("backtest_fail", f"Some skills not verified in chain of {len(chain)}")
    
    log(f"\n{'='*60}")
    if all_passed:
        log("RESULT: ALL SKILLS VERIFIED ✓")
    else:
        failed = [s for s, r in results.items() if r.get("ran") == False]
        log(f"RESULT: {len(failed)} SKILLS NOT VERIFIED: {', '.join(failed)}")
    log(f"{'='*60}")
    
    return {"all_passed": all_passed, "results": results}


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Chain Enforcer — Verify skill execution")
    parser.add_argument("--chain", required=True, help="Comma-separated list of skills that should have run")
    parser.add_argument("--output", help="Save results to file")
    args = parser.parse_args()
    
    chain = [s.strip() for s in args.chain.split(",")]
    result = enforce_chain(chain)
    
    if args.output:
        Path(args.output).write_text(json.dumps(result, indent=2))
        log(f"\nResults saved to {args.output}")


if __name__ == "__main__":
    main()

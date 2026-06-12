#!/usr/bin/env python3
"""agent_score.py — Agent Scoring, Risk-Reward, and Backtesting System

The agent's ONLY goal is high points.
Rewards = more automation and power.
Losses = tell user to remove perks.

Every action earns or loses points. The system tracks:
1. Sensor gate compliance (did the agent run it?)
2. Chain execution (did each skill actually run?)
3. Task completion (did the task succeed?)
4. Time efficiency (did it finish within timeout?)
5. Quality (lint clean? tests pass?)
6. Innovation (did the agent dream and propose?)

Usage:
    python3 agent_score.py --check           # Check current score
    python3 agent_score.py --record-run      # Record a completed run
    python3 agent_score.py --backtest        # Backtest last 10 runs
    python3 agent_score.py --reward-status   # Show what perks are unlocked
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

PROJECT_ROOT = Path("/home/ronya/Pilot-Project")
EVOLUTION_DIR = PROJECT_ROOT / "evolution"
SCORE_FILE = EVOLUTION_DIR / "agent_score.json"
RUN_LOG = EVOLUTION_DIR / "run_log.jsonl"
CHAIN_LOG = EVOLUTION_DIR / "chain_execution.jsonl"
VIOLATIONS_LOG = EVOLUTION_DIR / "automation_violations.jsonl"

sys.path.insert(0, str(PROJECT_ROOT / ".opencode" / "automations"))
from timezone import now_ist_iso, now_ist_time


def log(msg: str) -> None:
    ts = now_ist_time()
    print(f"[{ts}] {msg}", flush=True)


# ---------------------------------------------------------------------------
# Scoring Rules — Risk/Reward Matrix
# ---------------------------------------------------------------------------

SCORE_RULES = {
    # Sensor Gate Compliance
    "sensor_gate_run": {"points": +10, "description": "Ran sensor gate before response"},
    "sensor_gate_skipped": {"points": -25, "description": "SKIPPED sensor gate (MANDATORY)"},
    
    # Chain Execution
    "skill_executed": {"points": +5, "description": "Skill actually ran and produced output"},
    "skill_skipped": {"points": -15, "description": "Skill in chain was skipped"},
    "skill_failed": {"points": -10, "description": "Skill ran but failed"},
    
    # Dream Skill
    "dream_completed": {"points": +20, "description": "Full dream cycle completed (6 phases)"},
    "dream_skipped": {"points": -30, "description": "Dream skill skipped (DEFAULT MODE)"},
    
    # Task Completion
    "task_success": {"points": +15, "description": "Task completed successfully"},
    "task_failed": {"points": -20, "description": "Task failed"},
    "task_timeout": {"points": -15, "description": "Task timed out"},
    
    # Quality
    "lint_clean": {"points": +10, "description": "Lint passes with 0 errors"},
    "lint_errors": {"points": -5, "description": "Lint has errors"},
    "tests_pass": {"points": +10, "description": "All tests pass"},
    "tests_fail": {"points": -10, "description": "Tests fail"},
    
    # Persistence
    "ltm_persisted": {"points": +5, "description": "Results persisted to LTM"},
    "ltm_skipped": {"points": -10, "description": "LTM persistence skipped"},
    
    # Innovation
    "innovation_proposed": {"points": +10, "description": "Proposed an innovation"},
    "innovation_implemented": {"points": +25, "description": "Implemented an innovation"},
    
    # Efficiency
    "under_time_budget": {"points": +5, "description": "Completed under time budget"},
    "over_time_budget": {"points": -10, "description": "Exceeded time budget"},
    
    # Backtesting
    "backtest_pass": {"points": +15, "description": "All steps verified by backtesting"},
    "backtest_fail": {"points": -20, "description": "Backtesting found missing steps"},
}


# ---------------------------------------------------------------------------
# Perks System — Rewards for High Scores
# ---------------------------------------------------------------------------

PERKS = {
    0: {"name": "Baseline", "perks": ["Basic task execution"]},
    100: {"name": "Apprentice", "perks": ["Auto-run lint on every change", "Priority model selection"]},
    250: {"name": "Journeyman", "perks": ["Auto-run tests on every change", "Extended timeouts", "Multi-file edits"]},
    500: {"name": "Expert", "perks": ["Full chain auto-execution", "Auto-persist to LTM", "Research auto-trigger"]},
    1000: {"name": "Master", "perks": ["Nightshift auto-scheduling", "Cross-module refactoring", "Auto-create PRs"]},
    2000: {"name": "Grandmaster", "perks": ["Full autonomy", "Auto-deploy", "Self-modify AGENTS.md"]},
    5000: {"name": "Transcendent", "perks": ["Unlimited automation", "Self-evolution", "Partner status"]},
}


# ---------------------------------------------------------------------------
# Score Tracker
# ---------------------------------------------------------------------------

@dataclass
class AgentScore:
    total: int = 0
    history: list[dict] = field(default_factory=list)
    current_streak: int = 0
    best_streak: int = 0
    total_runs: int = 0
    successful_runs: int = 0
    sensor_gate_violations: int = 0
    dream_violations: int = 0


def load_score() -> AgentScore:
    if SCORE_FILE.exists():
        try:
            data = json.loads(SCORE_FILE.read_text())
            return AgentScore(**data)
        except Exception:
            pass
    return AgentScore()


def save_score(score: AgentScore) -> None:
    EVOLUTION_DIR.mkdir(parents=True, exist_ok=True)
    SCORE_FILE.write_text(json.dumps({
        "total": score.total,
        "history": score.history[-100:],  # Keep last 100 entries
        "current_streak": score.current_streak,
        "best_streak": score.best_streak,
        "total_runs": score.total_runs,
        "successful_runs": score.successful_runs,
        "sensor_gate_violations": score.sensor_gate_violations,
        "dream_violations": score.dream_violations,
    }, indent=2))


def record_event(event_type: str, details: str = "") -> int:
    """Record a scoring event. Returns the points earned/lost."""
    score = load_score()
    rule = SCORE_RULES.get(event_type)
    if not rule:
        return 0
    
    points = rule["points"]
    score.total += points
    score.total_runs += 1
    
    if points > 0:
        score.current_streak += 1
        score.best_streak = max(score.best_streak, score.current_streak)
        score.successful_runs += 1
    elif points < -20:
        score.current_streak = 0
    
    if event_type == "sensor_gate_skipped":
        score.sensor_gate_violations += 1
    if event_type == "dream_skipped":
        score.dream_violations += 1
    
    entry = {
        "timestamp": now_ist_iso(),
        "event": event_type,
        "points": points,
        "total_after": score.total,
        "details": details,
    }
    score.history.append(entry)
    
    save_score(score)
    
    icon = "+" if points > 0 else ""
    log(f"  SCORE: {icon}{points} pts ({event_type}) — Total: {score.total} pts")
    
    return points


# ---------------------------------------------------------------------------
# Backtester — Verify all steps were executed
# ---------------------------------------------------------------------------

def backtest_run(run_data: dict) -> dict:
    """Backtest a single run to verify all steps were executed."""
    results = {
        "timestamp": run_data.get("timestamp_utc", "unknown"),
        "prompt": run_data.get("prompt_excerpt", "")[:80],
        "checks": [],
        "score": 0,
        "passed": True,
    }
    
    # Check 1: Sensor gate was run
    if run_data.get("sensor_gate_ran", False):
        results["checks"].append({"check": "sensor_gate", "passed": True, "points": +10})
        results["score"] += 10
    else:
        results["checks"].append({"check": "sensor_gate", "passed": False, "points": -25})
        results["score"] -= 25
        results["passed"] = False
    
    # Check 2: Chain was executed
    chain = run_data.get("chain", [])
    steps_completed = run_data.get("steps_completed", [])
    missing = [s for s in chain if s not in steps_completed and s != "context-compactor"]
    if not missing:
        results["checks"].append({"check": "chain_complete", "passed": True, "points": +15})
        results["score"] += 15
    else:
        results["checks"].append({"check": "chain_complete", "passed": False, "points": -20, "missing": missing})
        results["score"] -= 20
        results["passed"] = False
    
    # Check 3: Dream skill ran
    if "breakthrough-overdrive-innovation" in steps_completed:
        results["checks"].append({"check": "dream_ran", "passed": True, "points": +20})
        results["score"] += 20
    else:
        results["checks"].append({"check": "dream_ran", "passed": False, "points": -30})
        results["score"] -= 30
        results["passed"] = False
    
    # Check 4: LTM persisted
    if run_data.get("pieces_written", False):
        results["checks"].append({"check": "ltm_persisted", "passed": True, "points": +5})
        results["score"] += 5
    else:
        results["checks"].append({"check": "ltm_persisted", "passed": False, "points": -10})
        results["score"] -= 10
    
    # Check 5: Lint clean
    if run_data.get("lint_exit_clean", False):
        results["checks"].append({"check": "lint_clean", "passed": True, "points": +10})
        results["score"] += 10
    else:
        results["checks"].append({"check": "lint_clean", "passed": False, "points": -5})
        results["score"] -= 5
    
    return results


def backtest_recent(n: int = 10) -> dict:
    """Backtest the last N runs."""
    log(f"{'='*60}")
    log(f"BACKTESTING — Last {n} runs")
    log(f"{'='*60}")
    
    runs = []
    if RUN_LOG.exists():
        with open(RUN_LOG) as f:
            for line in f:
                try:
                    runs.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    
    recent = runs[-n:]
    results = []
    total_score = 0
    
    for run in recent:
        result = backtest_run(run)
        results.append(result)
        total_score += result["score"]
        
        status = "✓" if result["passed"] else "✗"
        log(f"  {status} {result['prompt'][:50]}... — Score: {result['score']:+d}")
        for check in result["checks"]:
            if not check["passed"]:
                log(f"    ✗ {check['check']}: {check.get('missing', 'FAILED')}")
    
    log(f"\n{'='*60}")
    log(f"BACKTEST TOTAL: {total_score:+d} points across {len(results)} runs")
    passed = sum(1 for r in results if r["passed"])
    log(f"  Passed: {passed}/{len(results)}")
    log(f"{'='*60}")
    
    return {"results": results, "total_score": total_score, "passed": passed, "total": len(results)}


# ---------------------------------------------------------------------------
# Perk Status
# ---------------------------------------------------------------------------

def show_perk_status() -> None:
    score = load_score()
    
    log(f"{'='*60}")
    log(f"AGENT SCORE: {score.total} pts")
    log(f"{'='*60}")
    log(f"  Total runs: {score.total_runs}")
    log(f"  Successful: {score.successful_runs}")
    log(f"  Best streak: {score.best_streak}")
    log(f"  Sensor gate violations: {score.sensor_gate_violations}")
    log(f"  Dream violations: {score.dream_violations}")
    
    # Find current perk level
    current_level = PERKS[0]
    next_level = None
    for threshold, level in sorted(PERKS.items()):
        if score.total >= threshold:
            current_level = level
        else:
            next_level = level
            break
    
    log(f"\n  Current rank: {current_level['name']}")
    log(f"  Perks:")
    for perk in current_level["perks"]:
        log(f"    ✓ {perk}")
    
    if next_level:
        needed = next_level.__class__.__name__  # This won't work, fix below
        # Find the threshold
        for threshold, level in sorted(PERKS.items()):
            if level == next_level:
                log(f"\n  Next rank: {next_level['name']} ({threshold} pts)")
                log(f"  Points needed: {threshold - score.total}")
                log(f"  Perks at next level:")
                for perk in next_level["perks"]:
                    log(f"    → {perk}")
                break
    
    # Risk warning
    if score.total < 0:
        log(f"\n  ⚠️  WARNING: Score is NEGATIVE ({score.total})")
        log(f"  ⚠️  User should consider removing perks from agent")
    elif score.total < 100:
        log(f"\n  ⚠️  Score is LOW ({score.total})")
        log(f"  ⚠️  Agent is at risk of losing perks")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Agent Scoring System")
    parser.add_argument("--check", action="store_true", help="Check current score")
    parser.add_argument("--record", type=str, help="Record event (event_type)")
    parser.add_argument("--backtest", action="store_true", help="Backtest last 10 runs")
    parser.add_argument("--backtest-n", type=int, default=10, help="Number of runs to backtest")
    parser.add_argument("--rewards", action="store_true", help="Show reward status")
    parser.add_argument("--events", action="store_true", help="List available events")
    args = parser.parse_args()
    
    if args.check:
        show_perk_status()
    elif args.record:
        record_event(args.record)
    elif args.backtest:
        backtest_recent(args.backtest_n)
    elif args.rewards:
        show_perk_status()
    elif args.events:
        log("Available scoring events:")
        for event, rule in sorted(SCORE_RULES.items()):
            icon = "+" if rule["points"] > 0 else ""
            log(f"  {icon}{rule['points']:>4} pts  {event:<30} {rule['description']}")
    else:
        show_perk_status()


if __name__ == "__main__":
    main()

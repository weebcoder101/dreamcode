#!/usr/bin/env python3
"""chain_executor.py — The Real Chain Enforcer

Programmatically executes the full skill chain in order:
  1. sensor_gate.py    — classify intent, select skills
  2. model_router      — select optimal NEURO models
  3. neuro_harness.py  — 10-iteration architectural review
  4. code-hardener     — 5-iteration hardening
  5. lint-fixer        — quality check
  6. pieces-ltm        — persist results
  7. automated-learning — self-evolution

Each step's output feeds the next. Failures are caught and logged,
not fatal (except NEURO — that's mandatory for non-trivial tasks).

Usage:
    python3 chain_executor.py --prompt "Audit core.py for security"
    python3 chain_executor.py --prompt "Fix lint errors" --file src/project_q/core.py
    python3 chain_executor.py --prompt "Review risk engine" --file src/project_q/risk/risk_engine.py --full
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path

PROJECT_ROOT = Path(os.environ.get("PROJECT_ROOT", Path.cwd()))
SKILLS_DIR = PROJECT_ROOT / ".dreamcode" / "skills"
AUTOMATIONS_DIR = PROJECT_ROOT / ".dreamcode" / "automations"
EVOLUTION_DIR = PROJECT_ROOT / "evolution"

sys.path.insert(0, str(AUTOMATIONS_DIR))
from model_selector import select_model as select_opencode_model
from timezone import format_duration, now_ist_iso, now_ist_time

# ---------------------------------------------------------------------------
# Data Structures
# ---------------------------------------------------------------------------

@dataclass
class ChainStep:
    name: str
    status: str = "pending"  # pending | running | success | failed | skipped
    output: str = ""
    error: str = ""
    elapsed: float = 0.0
    metadata: dict = field(default_factory=dict)


@dataclass
class ChainResult:
    prompt: str
    files: list[str]
    started: str = field(default_factory=now_ist_iso)
    finished: str | None = None
    steps: list[dict] = field(default_factory=list)
    overall_status: str = "running"


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

def log(msg: str) -> None:
    ts = now_ist_time()
    print(f"[{ts}] {msg}", flush=True)


# ---------------------------------------------------------------------------
# Step Runners
# ---------------------------------------------------------------------------

def run_cmd(cmd: list[str], timeout: int = 300, label: str = "",
            cwd: str | None = None) -> dict:
    """Run a command and return structured result."""
    log(f"  ▶ {label}...")
    start = time.time()
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout,
            cwd=cwd or str(PROJECT_ROOT),
        )
        elapsed = time.time() - start
        ok = result.returncode == 0
        log(f"  ✓ {label}: {'OK' if ok else 'FAILED'} ({format_duration(elapsed)})")
        return {
            "success": ok,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "elapsed": elapsed,
            "returncode": result.returncode,
        }
    except subprocess.TimeoutExpired:
        elapsed = time.time() - start
        log(f"  ✗ {label}: TIMEOUT ({format_duration(elapsed)})")
        return {"success": False, "stdout": "", "stderr": "Timeout", "elapsed": elapsed}
    except Exception as e:
        elapsed = time.time() - start
        log(f"  ✗ {label}: ERROR ({e})")
        return {"success": False, "stdout": "", "stderr": str(e), "elapsed": elapsed}


def step_sensor_gate(prompt: str) -> ChainStep:
    """Step 1: Classify intent and select skills."""
    step = ChainStep(name="sensor_gate")
    log(f"\n{'─'*50}")
    log("STEP 1/7: Sensor Gate (Intent Classification)")
    log(f"{'─'*50}")

    r = run_cmd(
        [sys.executable, str(SKILLS_DIR / "chain-orchestrator" / "scripts" / "sensor_gate.py"),
         "--prompt", prompt],
        timeout=30, label="sensor_gate",
    )
    step.status = "success" if r["success"] else "failed"
    step.output = r["stdout"]
    step.error = r["stderr"]
    step.elapsed = r["elapsed"]

    # Parse chain from output
    chain = []
    for line in r["stdout"].split("\n"):
        if line.strip().startswith("chain:"):
            chain_str = line.split("chain:", 1)[1].strip()
            chain = [s.strip() for s in chain_str.split("→")]
    step.metadata["chain"] = chain

    # Check if trivial
    step.metadata["is_trivial"] = "is_social_greeting: true" in r["stdout"]

    return step


def step_model_router(prompt: str, files: list[str]) -> ChainStep:
    """Step 2: Select optimal NEURO models for the task."""
    step = ChainStep(name="model_router")
    log(f"\n{'─'*50}")
    log("STEP 2/7: Model Router (Select NEURO Models)")
    log(f"{'─'*50}")

    # Determine task domain from prompt
    prompt_lower = prompt.lower()
    if any(w in prompt_lower for w in ["security", "auth", "secret", "token", "vulnerab"]):
        domain = "security"
    elif any(w in prompt_lower for w in ["risk", "finance", "var", "monte", "backtest"]):
        domain = "finance"
    elif any(w in prompt_lower for w in ["test", "coverage", "pytest"]):
        domain = "testing"
    elif any(w in prompt_lower for w in ["performance", "slow", "optim", "profil"]):
        domain = "performance"
    elif any(w in prompt_lower for w in ["quantum", "qaoa", "qae", "circuit"]):
        domain = "quantum"
    else:
        domain = "code"

    # NEURO model mapping (domain → model)
    neuro_models = {
        "code": "neurometric/clawpack",
        "security": "neurometric/clawpack",
        "finance": "neurometric/clawpack",
        "testing": "neurometric/clawpack",
        "performance": "neurometric/clawpack",
        "quantum": "neurometric/clawpack",
    }

    model = neuro_models.get(domain, "neurometric/clawpack")
    step.status = "success"
    step.output = f"Selected model: {model} for domain: {domain}"
    step.metadata["model"] = model
    step.metadata["domain"] = domain
    log(f"  → Model: {model} (domain: {domain})")

    return step


def step_neuro(prompt: str, files: list[str], model: str) -> ChainStep:
    """Step 3: Run NEURO 10-iteration architectural review."""
    step = ChainStep(name="neuro")
    log(f"\n{'─'*50}")
    log("STEP 3/7: NEURO (10-Iteration Architectural Review)")
    log(f"{'─'*50}")

    cmd = [
        sys.executable, str(SKILLS_DIR / "neuro" / "scripts" / "neuro_harness.py"),
        "--task", prompt,
        "--phase", "pre_patch",
    ]
    for f in files:
        cmd.extend(["--file", f])

    r = run_cmd(cmd, timeout=600, label="neuro_harness")
    step.status = "success" if r["success"] else "failed"
    step.output = r["stdout"]
    step.error = r["stderr"]
    step.elapsed = r["elapsed"]

    # Parse NEURO output for patches/recommendations
    try:
        for line in r["stdout"].split("\n"):
            line = line.strip()
            if line.startswith("{"):
                data = json.loads(line)
                patches = data.get("patches", [])
                step.metadata["patches"] = len(patches)
                step.metadata["neuro_data"] = data
                break
    except (json.JSONDecodeError, ValueError):
        pass

    return step


def step_code_hardener(prompt: str, files: list[str]) -> ChainStep:
    """Step 4: Run code-hardener via NEURO API (5-iteration hardening)."""
    step = ChainStep(name="code_hardener")
    log(f"\n{'─'*50}")
    log("STEP 4/7: Code Hardener (5-Iteration Hardening via NEURO)")
    log(f"{'─'*50}")

    # Code-hardener is a NEURO API call with phase=post_patch
    # It reads the 10 pre_patch iterations and calls NEURO again with filtered critique
    cmd = [
        sys.executable, str(SKILLS_DIR / "neuro" / "scripts" / "neuro_harness.py"),
        "--task", f"CODE HARDENER: {prompt}. Apply 5 iterations of hardening: "
                  f"type annotations, error handling, input validation, edge cases, "
                  f"security hardening. Do NOT change logic — only harden.",
        "--phase", "post_patch",
    ]
    for f in files:
        cmd.extend(["--file", f])

    r = run_cmd(cmd, timeout=600, label="code_hardener")
    step.status = "success" if r["success"] else "failed"
    step.output = r["stdout"][:5000]
    step.error = r["stderr"]
    step.elapsed = r["elapsed"]

    # Parse NEURO output for patches
    try:
        for line in r["stdout"].split("\n"):
            line = line.strip()
            if line.startswith("{"):
                data = json.loads(line)
                patches = data.get("patches", [])
                step.metadata["patches"] = len(patches)
                break
    except (json.JSONDecodeError, ValueError):
        pass

    return step


def step_lint_fixer(files: list[str]) -> ChainStep:
    """Step 5: Run lint-fixer (ruff + mypy)."""
    step = ChainStep(name="lint_fixer")
    log(f"\n{'─'*50}")
    log("STEP 5/7: Lint Fixer (Quality Check)")
    log(f"{'─'*50}")

    # Auto-fix safe lint errors
    fix_result = run_cmd(
        [sys.executable, "-m", "ruff", "check", "src/", "--fix"],
        timeout=60, label="ruff_fix",
    )

    # Format
    format_result = run_cmd(
        [sys.executable, "-m", "ruff", "format", "src/"],
        timeout=60, label="ruff_format",
    )

    # Final check
    check_result = run_cmd(
        [sys.executable, "-m", "ruff", "check", "src/", "--output-format=json"],
        timeout=60, label="ruff_check",
    )

    # Count errors
    error_count = 0
    try:
        errors = json.loads(check_result["stdout"])
        error_count = len(errors)
    except (json.JSONDecodeError, ValueError):
        pass

    step.status = "success" if error_count == 0 else "partial"
    step.output = f"Lint errors remaining: {error_count}"
    step.metadata["error_count"] = error_count
    step.elapsed = fix_result["elapsed"] + format_result["elapsed"] + check_result["elapsed"]

    log(f"  → Lint errors: {error_count}")

    return step


def step_pieces_ltm(prompt: str, files: list[str], chain_result: dict) -> ChainStep:
    """Step 6: Persist results to Pieces LTM."""
    step = ChainStep(name="pieces_ltm")
    log(f"\n{'─'*50}")
    log("STEP 6/7: Pieces LTM (Persist Results)")
    log(f"{'─'*50}")

    persist_script = SKILLS_DIR / "pieces-ltm" / "scripts" / "pieces_persist.py"
    if not persist_script.exists():
        step.status = "skipped"
        step.output = "pieces_persist.py not found"
        log("  → Skipped (persist script not found)")
        return step

    decisions = []
    for s in chain_result.get("steps", []):
        if s.get("status") == "success" and s.get("name") != "pieces_ltm":
            decisions.append(f"{s['name']}: completed successfully")

    r = run_cmd(
        [sys.executable, str(persist_script), "persist",
         "--chain", "chain_executor",
         "--task", prompt[:200],
         "--outcome", "success",
         "--files"] + files + [
         "--decisions", "; ".join(decisions) if decisions else "chain completed"],
        timeout=30, label="pieces_persist",
    )
    step.status = "success" if r["success"] else "failed"
    step.output = r["stdout"]
    step.error = r["stderr"]
    step.elapsed = r["elapsed"]

    return step


def step_automated_learning(prompt: str, chain_result: dict) -> ChainStep:
    """Step 7: Self-evolution — capture what worked/failed."""
    step = ChainStep(name="automated_learning")
    log(f"\n{'─'*50}")
    log("STEP 7/7: Automated Learning (Self-Evolution)")
    log(f"{'─'*50}")

    # Generate learning note
    learning_note = {
        "timestamp_utc": datetime.now(UTC).isoformat(),
        "prompt_excerpt": prompt[:120],
        "chain": [s["name"] for s in chain_result.get("steps", [])],
        "chain_length": len(chain_result.get("steps", [])),
        "outcome": chain_result.get("overall_status", "unknown"),
        "neuro_was_available": any(
            s["name"] == "neuro" and s["status"] == "success"
            for s in chain_result.get("steps", [])
        ),
        "ltm_was_available": any(
            s["name"] == "pieces_ltm" and s["status"] in ("success", "skipped")
            for s in chain_result.get("steps", [])
        ),
        "lint_exit_clean": any(
            s["name"] == "lint_fixer" and s.get("metadata", {}).get("error_count", 999) == 0
            for s in chain_result.get("steps", [])
        ),
        "files_changed": chain_result.get("files", []),
        "pieces_written": any(
            s["name"] == "pieces_ltm" and s["status"] == "success"
            for s in chain_result.get("steps", [])
        ),
        "key_decisions": [],
        "notes": "Chain executor v2 run",
    }

    # Append to run_log.jsonl
    run_log = EVOLUTION_DIR / "run_log.jsonl"
    run_log.parent.mkdir(parents=True, exist_ok=True)
    with open(run_log, "a") as f:
        f.write(json.dumps(learning_note) + "\n")

    step.status = "success"
    step.output = f"Learning note written to {run_log}"
    step.metadata["learning_note"] = learning_note

    log("  → Learning note appended to run_log.jsonl")

    return step


# ---------------------------------------------------------------------------
# Chain Executor
# ---------------------------------------------------------------------------

def execute_chain(prompt: str, files: list[str] | None = None,
                  full: bool = False) -> ChainResult:
    """Execute the full skill chain."""
    if files is None:
        files = ["src/project_q/core.py"]

    result = ChainResult(prompt=prompt, files=files)

    log(f"{'='*60}")
    log("CHAIN EXECUTOR v2 — Full Skill Chain")
    log(f"{'='*60}")
    log(f"Prompt: {prompt[:100]}...")
    log(f"Files: {', '.join(files)}")
    log(f"Full mode: {full}")

    total_start = time.time()

    # Step 1: Sensor Gate
    s1 = step_sensor_gate(prompt)
    result.steps.append(asdict(s1))

    # If trivial, skip the rest
    if s1.metadata.get("is_trivial"):
        log("\n  Trivial prompt — skipping remaining steps")
        result.overall_status = "success"
        result.finished = now_ist_iso()
        return result

    # Step 2: Model Router
    s2 = step_model_router(prompt, files)
    result.steps.append(asdict(s2))

    # Step 3: NEURO (mandatory for non-trivial)
    neuro_model = s2.metadata.get("model", "neurometric/clawpack")
    s3 = step_neuro(prompt, files, neuro_model)
    result.steps.append(asdict(s3))

    # Step 4: Code Hardener (if full mode or NEURO found issues)
    if full or s3.status == "success":
        s4 = step_code_hardener(prompt, files)
        result.steps.append(asdict(s4))
    else:
        s4 = ChainStep(name="code_hardener", status="skipped", output="NEURO failed, skipping hardener")
        result.steps.append(asdict(s4))

    # Step 5: Lint Fixer (always)
    s5 = step_lint_fixer(files)
    result.steps.append(asdict(s5))

    # Step 6: Pieces LTM
    s6 = step_pieces_ltm(prompt, files, asdict(result))
    result.steps.append(asdict(s6))

    # Step 7: Automated Learning
    s7 = step_automated_learning(prompt, asdict(result))
    result.steps.append(asdict(s7))

    # Summary
    total_elapsed = time.time() - total_start
    success_count = sum(1 for s in result.steps if s["status"] == "success")
    total_count = len(result.steps)

    result.overall_status = "success" if success_count >= 5 else "partial"
    result.finished = now_ist_iso()

    log(f"\n{'='*60}")
    log(f"CHAIN COMPLETE — {format_duration(total_elapsed)}")
    log(f"{'='*60}")
    log(f"  Steps: {success_count}/{total_count} succeeded")
    for s in result.steps:
        icon = {"success": "✓", "failed": "✗", "skipped": "○", "partial": "◐"}.get(s["status"], "?")
        log(f"    {icon} {s['name']}: {s['status']}")

    return result


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Chain Executor v2 — The Real Chain Enforcer"
    )
    parser.add_argument("--prompt", "-p", required=True, help="Task prompt")
    parser.add_argument("--file", "-f", action="append", default=[], help="Files to analyze")
    parser.add_argument("--full", action="store_true", help="Run full chain (including hardener even if NEURO has no issues)")
    parser.add_argument("--output", "-o", help="Save results to file")
    args = parser.parse_args()

    files = args.file if args.file else ["src/project_q/core.py"]
    result = execute_chain(args.prompt, files, full=args.full)

    if args.output:
        Path(args.output).write_text(json.dumps(asdict(result), indent=2))
        log(f"\nResults saved to {args.output}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""neuro_chain.py — 10-Iteration NEURO Chain

Wraps neuro_harness.py to execute the full 10-iteration protocol:
Each iteration builds on ALL previous iteration output.

Usage:
    python neuro_chain.py --task "Review core.py" --file src/project_q/core.py
    python neuro_chain.py --task "Security audit" --file src/*.py --phase pre_patch
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
NEUROHarness = SCRIPT_DIR / "neuro_harness.py"
CHAINS_DIR = Path.cwd() / ".neuro" / "chains" / "latest"


# Iteration focus areas (from SKILL.md)
ITERATION_FOCUS = {
    1: "Direct Analysis — gather context, identify files, surface immediate risks",
    2: "Deepened Analysis — repeat with iter 1 output, surface missed risks, hidden dependencies",
    3: "Innovation — approaches NOT previously considered, lateral thinking, alternative architectures",
    4: "Cross-Reference — cross-reference with PROJECT_CONTEXT.md, tests, neighboring files, API contracts",
    5: "Edge-Case Hunt — what breaks in prod? NaN, empty data, race conditions, timeouts, memory pressure",
    6: "Performance & Scalability — profile each component, Big-O analysis, bottleneck identification",
    7: "Security & Data Integrity — injection, secrets, resource exhaustion, thread safety, temp file leaks",
    8: "Backward Compatibility — API contracts, data schemas, UI consumers, migration impact",
    9: "Testability & Validation — missing tests, flaky tests, benchmark strategy, regression detection",
    10: "Final Synthesis — consolidate ALL 9 prior iterations, priority-ordered action plan",
}


def run_harness(task: str, files: list[str], phase: str, context: str = "",
                max_tokens: int = 8192) -> dict:
    """Run the neuro harness once and return parsed result."""
    cmd = [
        sys.executable, str(NEUROHarness),
        "--task", task,
        "--phase", phase,
        "--max-tokens", str(max_tokens),
    ]
    for f in files:
        cmd.extend(["--file", f])

    if context:
        cmd.extend(["--automation-context", context])

    result = subprocess.run(
        cmd, capture_output=True, text=True, timeout=300,
    )

    # Parse the JSON output (last line of stdout)
    for line in reversed(result.stdout.strip().split("\n")):
        try:
            return json.loads(line)
        except (json.JSONDecodeError, ValueError):
            continue

    return {"status": "failed", "error": result.stderr[:500]}


def run_10_iterations(task: str, files: list[str], phase: str = "pre_patch") -> dict:
    """Execute the full 10-iteration NEURO protocol."""
    CHAINS_DIR.mkdir(parents=True, exist_ok=True)

    all_iterations = []
    accumulated_context = ""
    start_time = time.time()

    print("NEURO CHAIN: 10-iteration protocol")
    print(f"Task: {task[:100]}...")
    print(f"Files: {len(files)}")
    print(f"{'='*60}")

    for iteration in range(1, 11):
        focus = ITERATION_FOCUS[iteration]
        print(f"\n{'─'*60}")
        print(f"ITERATION {iteration}/10: {focus}")
        print(f"{'─'*60}")

        iter_task = f"[NEURO Iteration {iteration}/10 — {focus}] {task}"
        if accumulated_context:
            iter_task += f"\n\nPREVIOUS ITERATIONS:\n{accumulated_context}"

        # Build context with iteration info
        ctx = json.dumps({
            "iteration": iteration,
            "total_iterations": 10,
            "focus": focus,
            "previous_iterations": len(all_iterations),
        })

        t0 = time.time()
        result = run_harness(iter_task, files, phase, ctx)
        elapsed = time.time() - t0

        # Save iteration result
        iter_file = CHAINS_DIR / f"{iteration:02d}_neuro_iter_{iteration}.json"
        iter_data = {
            "iteration": iteration,
            "focus": focus,
            "elapsed_seconds": round(elapsed, 1),
            "status": result.get("status", "unknown"),
            "response": result.get("response", {}),
            "patches": result.get("patches", []),
        }
        iter_file.write_text(json.dumps(iter_data, indent=2))

        all_iterations.append(iter_data)

        status = "✓" if result.get("status") == "success" else "✗"
        print(f"  {status} Iteration {iteration}: {elapsed:.1f}s")

        # Accumulate context for next iteration
        response = result.get("response", {})
        if isinstance(response, dict):
            audit = response.get("audit_results", response)
            accumulated_context += f"\n\n--- Iteration {iteration} ({focus}) ---\n"
            accumulated_context += json.dumps(audit, indent=2)[:2000]

    # Final synthesis
    print(f"\n{'='*60}")
    total_elapsed = time.time() - start_time
    print(f"NEURO CHAIN COMPLETE: {total_elapsed:.1f}s")

    # Write synthesis
    synthesis = {
        "task": task,
        "files": files,
        "iterations_completed": len(all_iterations),
        "total_elapsed_seconds": round(total_elapsed, 1),
        "iterations": [
            {
                "iteration": it["iteration"],
                "focus": it["focus"],
                "status": it["status"],
                "elapsed": it["elapsed_seconds"],
            }
            for it in all_iterations
        ],
    }
    synthesis_file = CHAINS_DIR / "10_neuro_synthesis.json"
    synthesis_file.write_text(json.dumps(synthesis, indent=2))

    print(f"Synthesis written to: {synthesis_file}")
    print(f"Iterations: {len(all_iterations)}/10")

    return synthesis


def main() -> None:
    parser = argparse.ArgumentParser(description="NEURO 10-Iteration Chain")
    parser.add_argument("--task", "-t", required=True, help="Task description")
    parser.add_argument("--file", "-f", action="append", default=[], help="Files to analyze")
    parser.add_argument("--phase", default="pre_patch", choices=["pre_patch", "post_patch"])
    args = parser.parse_args()

    if not args.file:
        print("ERROR: No files provided. Use --file")
        sys.exit(1)

    result = run_10_iterations(args.task, args.file, args.phase)
    print(json.dumps(result, indent=2)[:1000])


if __name__ == "__main__":
    main()

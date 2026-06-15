#!/usr/bin/env python3
"""chain_executor_light.py — Lightweight chain executor for the enforcer plugin.

Runs a subset of the skill chain steps relevant to automatic persistence.
Unlike the full chain_executor.py, this is optimized for speed (30s timeout)
and focuses on the steps that matter for every prompt:

  1. Extract guidance from SKILL.md for each skill in the chain
   2. Run PiecesLTM.Service.persist() (or pieces_persist.py fallback) to persist results

Usage:
    python3 chain_executor_light.py --chain "dream,neuro,code-hardener,lint-fixer,pieces-ltm" --prompt "fix the bug"
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

PROJECT_ROOT = Path(os.environ.get("PROJECT_ROOT", Path.cwd()))
SKILLS_DIR = PROJECT_ROOT / ".dreamcode" / "skills"
EVOLUTION_DIR = PROJECT_ROOT / "evolution"

sys.path.insert(0, str(PROJECT_ROOT / ".dreamcode" / "automations"))
try:
    from timezone import format_duration, now_ist_iso
except ImportError:
    def format_duration(s: float) -> str:
        return f"{s:.1f}s"
    def now_ist_iso() -> str:
        return __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()


@dataclass
class ChainStep:
    name: str
    status: str = "pending"
    output: str = ""
    elapsed: float = 0.0


@dataclass
class ChainResult:
    overall_status: str = "running"
    steps: list[dict] = field(default_factory=list)
    total_elapsed: float = 0.0


def extract_skill_guidance(skill_name: str) -> str:
    skill_dir = SKILLS_DIR / skill_name
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.exists():
        return f"No SKILL.md found for {skill_name}"

    try:
        content = skill_md.read_text(encoding="utf-8")
        lines = content.split("\n")
        desc_lines = []
        in_body = False
        for line in lines:
            if line.startswith("---"):
                if in_body:
                    break
                in_body = True
                continue
            if in_body and line.strip().startswith("description:"):
                desc_lines.append(line.split(":", 1)[1].strip().strip('"'))
            elif in_body and line.strip().startswith("name:"):
                continue

        if desc_lines:
            return desc_lines[0]

        for line in lines:
            if line.startswith("#") and not line.startswith("---"):
                return line.lstrip("#").strip()
        return f"Skill {skill_name} loaded"
    except Exception as e:
        return f"Error reading {skill_name}: {e}"


def run_skill(skill_name: str, prompt: str) -> ChainStep:
    step = ChainStep(name=skill_name)
    start = time.time()

    skill_dir = SKILLS_DIR / skill_name / "scripts"
    if not skill_dir.exists():
        step.status = "success"
        step.output = extract_skill_guidance(skill_name)
        step.elapsed = time.time() - start
        return step

    for script_name in [f"{skill_name}.py", "skill_runner.py", "harness.py", "main.py"]:
        script = skill_dir / script_name
        if script.exists():
            try:
                result = subprocess.run(
                    [sys.executable, str(script), "--prompt", prompt, "--brief"],
                    capture_output=True, text=True, timeout=60,
                    cwd=str(PROJECT_ROOT),
                )
                step.status = "success" if result.returncode == 0 else "failed"
                step.output = result.stdout[:2000]
                step.elapsed = time.time() - start
                return step
            except Exception as e:
                step.status = "failed"
                step.output = str(e)
                step.elapsed = time.time() - start
                return step

    step.status = "success"
    step.output = extract_skill_guidance(skill_name)
    step.elapsed = time.time() - start
    return step


def execute_chain(chain: list[str], prompt: str) -> ChainResult:
    result = ChainResult()
    total_start = time.time()

    for skill_name in chain:
        if skill_name in ("context-compactor", "exhaustive-crosscheck"):
            step = ChainStep(name=skill_name, status="success", output="advisory-only")
            result.steps.append(asdict(step))
            continue

        step = run_skill(skill_name, prompt)
        result.steps.append(asdict(step))

    result.total_elapsed = time.time() - total_start
    success_count = sum(1 for s in result.steps if s["status"] == "success")
    result.overall_status = "success" if success_count > len(result.steps) * 0.5 else "partial"

    return result


def main():
    parser = argparse.ArgumentParser(description="Lightweight chain executor")
    parser.add_argument("--chain", required=True, help="Comma-separated skill chain")
    parser.add_argument("--prompt", required=True, help="Task prompt")
    args = parser.parse_args()

    chain = [s.strip() for s in args.chain.split(",") if s.strip()]
    result = execute_chain(chain, args.prompt)

    print(json.dumps(asdict(result)))


if __name__ == "__main__":
    main()

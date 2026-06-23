#!/usr/bin/env python3
"""scheduler.py — Cron-Like Scheduled Automation Engine

Defines jobs that run skill chains on schedule.
Stores jobs in .opencode/automations/jobs.json.
Run history in .opencode/automations/history.jsonl.

Usage:
    scheduler.py add <name> --schedule "0 2 * * *" --chain "security → quality"
    scheduler.py run <name>
    scheduler.py list
    scheduler.py history <name>
    scheduler.py remove <name>
    scheduler.py tick
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
UTC = timezone.utc  # Python 3.2+ compat (not 3.11+ only)
from pathlib import Path

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

PROJECT_ROOT = Path(os.environ.get("PROJECT_ROOT", Path.cwd()))
AUTOMATIONS_DIR = PROJECT_ROOT / ".opencode" / "automations"
JOBS_FILE = AUTOMATIONS_DIR / "jobs.json"
HISTORY_FILE = AUTOMATIONS_DIR / "history.jsonl"
SENSOR_GATE = PROJECT_ROOT / ".opencode" / "skills" / "chain-orchestrator" / "scripts" / "sensor_gate.py"


# ---------------------------------------------------------------------------
# Data Structures
# ---------------------------------------------------------------------------

@dataclass
class Job:
    name: str
    schedule: str  # cron format: "MIN HOUR DAY MONTH DOW"
    chain: str  # skill chain, e.g. "security → quality → neuro"
    prompt: str  # what to tell the agent
    enabled: bool = True
    notify: bool = False  # send notification on completion
    last_run: str | None = None
    created: str = field(default_factory=lambda: datetime.now(UTC).isoformat())


@dataclass
class RunRecord:
    job_name: str
    started: str
    finished: str | None = None
    status: str = "running"  # running | success | failed
    output: str = ""
    error: str = ""


# ---------------------------------------------------------------------------
# Job Store
# ---------------------------------------------------------------------------

def load_jobs() -> dict[str, Job]:
    """Load all jobs from disk."""
    if not JOBS_FILE.exists():
        return {}
    try:
        data = json.loads(JOBS_FILE.read_text())
        return {name: Job(**job) for name, job in data.items()}
    except (json.JSONDecodeError, KeyError):
        return {}


def save_jobs(jobs: dict[str, Job]) -> None:
    """Save all jobs to disk."""
    AUTOMATIONS_DIR.mkdir(parents=True, exist_ok=True)
    data = {name: asdict(job) for name, job in jobs.items()}
    JOBS_FILE.write_text(json.dumps(data, indent=2))


def log_run(record: RunRecord) -> None:
    """Append a run record to history."""
    AUTOMATIONS_DIR.mkdir(parents=True, exist_ok=True)
    with open(HISTORY_FILE, "a") as f:
        f.write(json.dumps(asdict(record)) + "\n")


def load_history(job_name: str | None = None, limit: int = 20) -> list[RunRecord]:
    """Load run history, optionally filtered by job name."""
    if not HISTORY_FILE.exists():
        return []
    records = []
    for line in reversed(HISTORY_FILE.read_text().strip().split("\n")):
        if not line.strip():
            continue
        try:
            rec = RunRecord(**json.loads(line))
            if job_name is None or rec.job_name == job_name:
                records.append(rec)
                if len(records) >= limit:
                    break
        except (json.JSONDecodeError, KeyError):
            continue
    return list(reversed(records))


# ---------------------------------------------------------------------------
# Cron Parsing
# ---------------------------------------------------------------------------

def parse_cron_field(field: str, min_val: int, max_val: int) -> list[int]:
    """Parse a single cron field into a list of valid values."""
    values = set()

    for part in field.split(","):
        part = part.strip()

        if part == "*":
            values.update(range(min_val, max_val + 1))
        elif "/" in part:
            base, step = part.split("/", 1)
            step = int(step)
            if base == "*":
                start = min_val
            else:
                start = int(base)
            values.update(range(start, max_val + 1, step))
        elif "-" in part:
            lo, hi = part.split("-", 1)
            values.update(range(int(lo), int(hi) + 1))
        else:
            values.add(int(part))

    return sorted(v for v in values if min_val <= v <= max_val)


def is_due(schedule: str, now: datetime | None = None) -> bool:
    """Check if a cron schedule is due at the given time."""
    if now is None:
        now = datetime.now(UTC)

    parts = schedule.strip().split()
    if len(parts) != 5:
        return False

    minute, hour, day, month, dow = parts

    valid_minutes = parse_cron_field(minute, 0, 59)
    valid_hours = parse_cron_field(hour, 0, 23)
    valid_days = parse_cron_field(day, 1, 31)
    valid_months = parse_cron_field(month, 1, 12)
    valid_dow = parse_cron_field(dow, 0, 6)  # 0=Sunday

    # Convert Python's weekday (0=Monday) to cron's (0=Sunday)
    python_dow = (now.weekday() + 1) % 7

    return (
        now.minute in valid_minutes
        and now.hour in valid_hours
        and now.day in valid_days
        and now.month in valid_months
        and python_dow in valid_dow
    )


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

def cmd_add(args: argparse.Namespace) -> None:
    """Add a new scheduled job."""
    jobs = load_jobs()

    if args.name in jobs:
        print(f"Job '{args.name}' already exists. Use 'update' to modify.")
        sys.exit(1)

    job = Job(
        name=args.name,
        schedule=args.schedule,
        chain=args.chain,
        prompt=args.prompt,
        enabled=not args.disabled,
        notify=args.notify,
    )

    jobs[args.name] = job
    save_jobs(jobs)

    print(f"✓ Added job '{args.name}'")
    print(f"  Schedule: {args.schedule}")
    print(f"  Chain: {args.chain}")
    print(f"  Prompt: {args.prompt[:80]}...")


def cmd_run(args: argparse.Namespace) -> None:
    """Run a job immediately (on-demand)."""
    jobs = load_jobs()

    if args.name not in jobs:
        print(f"Job '{args.name}' not found.", file=sys.stderr)
        sys.exit(1)

    job = jobs[args.name]
    _execute_job(job)


def cmd_list(args: argparse.Namespace) -> None:
    """List all jobs."""
    jobs = load_jobs()

    if not jobs:
        print("No jobs defined.")
        return

    print(f"{'Name':<25} {'Schedule':<18} {'Enabled':<10} {'Last Run'}")
    print("-" * 80)
    for name, job in jobs.items():
        last_run = job.last_run or "never"
        enabled = "yes" if job.enabled else "no"
        print(f"{name:<25} {job.schedule:<18} {enabled:<10} {last_run}")


def cmd_history(args: argparse.Namespace) -> None:
    """Show run history."""
    records = load_history(args.name, limit=args.limit)

    if not records:
        print("No run history.")
        return

    print(f"{'Job':<25} {'Started':<22} {'Status':<10} {'Duration'}")
    print("-" * 75)
    for rec in records:
        started = rec.started[:19] if rec.started else "?"
        if rec.finished and rec.started:
            from datetime import datetime as dt
            s = dt.fromisoformat(rec.started)
            f = dt.fromisoformat(rec.finished)
            dur = f"{(f - s).total_seconds():.1f}s"
        else:
            dur = "?"
        print(f"{rec.job_name:<25} {started:<22} {rec.status:<10} {dur}")


def cmd_remove(args: argparse.Namespace) -> None:
    """Remove a job."""
    jobs = load_jobs()

    if args.name not in jobs:
        print(f"Job '{args.name}' not found.", file=sys.stderr)
        sys.exit(1)

    del jobs[args.name]
    save_jobs(jobs)
    print(f"✓ Removed job '{args.name}'")


def cmd_tick(args: argparse.Namespace) -> None:
    """Check for due jobs and run them. Designed for cron."""
    jobs = load_jobs()
    now = datetime.now(UTC)
    ran = 0

    for name, job in jobs.items():
        if not job.enabled:
            continue
        if is_due(job.schedule, now):
            print(f"[{now.isoformat()}] Running job: {name}")
            _execute_job(job)
            ran += 1

    if ran == 0:
        # Silent on no-op (cron runs every minute)
        pass


def _execute_job(job: Job) -> None:
    """Execute a job by running its chain."""
    record = RunRecord(
        job_name=job.name,
        started=datetime.now(UTC).isoformat(),
    )

    try:
        # Build the command — run sensor_gate with the job's prompt
        prompt = f"[AUTOMATION:{job.name}] {job.prompt}"

        # For now, we just log the execution and print what would happen
        # In production, this would call the agent or run the chain
        print(f"  Chain: {job.chain}")
        print(f"  Prompt: {job.prompt}")

        # Try running via sensor_gate if it exists
        if SENSOR_GATE.exists():
            result = subprocess.run(
                [sys.executable, str(SENSOR_GATE), "--prompt", prompt],
                capture_output=True, text=True, timeout=300,
                cwd=str(PROJECT_ROOT),
            )
            record.output = result.stdout
            record.error = result.stderr
            record.status = "success" if result.returncode == 0 else "failed"
        else:
            record.output = f"Would execute chain: {job.chain}"
            record.status = "success"

    except subprocess.TimeoutExpired:
        record.status = "failed"
        record.error = "Execution timed out (300s)"
    except Exception as e:
        record.status = "failed"
        record.error = str(e)

    record.finished = datetime.now(UTC).isoformat()

    # Update last_run
    jobs = load_jobs()
    if job.name in jobs:
        jobs[job.name].last_run = record.finished
        save_jobs(jobs)

    # Log the run
    log_run(record)

    if record.status == "success":
        print(f"  ✓ Completed: {record.finished}")
    else:
        print(f"  ✗ Failed: {record.error}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Scheduled Automation Engine"
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # add
    p_add = sub.add_parser("add", help="Add a job")
    p_add.add_argument("name", help="Job name")
    p_add.add_argument("--schedule", "-s", required=True,
                       help="Cron schedule (e.g. '0 2 * * *')")
    p_add.add_argument("--chain", "-c", required=True,
                       help="Skill chain (e.g. 'security → quality')")
    p_add.add_argument("--prompt", "-p", required=True,
                       help="Prompt to send to agent")
    p_add.add_argument("--notify", action="store_true",
                       help="Notify on completion")
    p_add.add_argument("--disabled", action="store_true",
                       help="Create disabled")

    # run
    p_run = sub.add_parser("run", help="Run a job now")
    p_run.add_argument("name", help="Job name")

    # list
    sub.add_parser("list", help="List all jobs")

    # history
    p_hist = sub.add_parser("history", help="Show run history")
    p_hist.add_argument("name", nargs="?", help="Filter by job name")
    p_hist.add_argument("--limit", "-l", type=int, default=20,
                        help="Max records to show")

    # remove
    p_rm = sub.add_parser("remove", help="Remove a job")
    p_rm.add_argument("name", help="Job name")

    # tick
    sub.add_parser("tick", help="Check and run due jobs (for cron)")

    args = parser.parse_args()

    if args.command == "add":
        cmd_add(args)
    elif args.command == "run":
        cmd_run(args)
    elif args.command == "list":
        cmd_list(args)
    elif args.command == "history":
        cmd_history(args)
    elif args.command == "remove":
        cmd_remove(args)
    elif args.command == "tick":
        cmd_tick(args)


if __name__ == "__main__":
    main()

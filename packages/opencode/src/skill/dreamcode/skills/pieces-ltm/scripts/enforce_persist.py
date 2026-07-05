#!/usr/bin/env python3
"""
Pieces LTM Persistence Enforcer

MANDATORY post-chain script that enforces every non-trivial skill chain
to persist its results to Pieces LTM. This script is auto-executed by
the chain executor after every skill chain run.

Key behaviors:
1. Detects whether the chain was non-trivial (4+ skills, 1+ files modified)
2. Checks if persistence already occurred via Effect service or direct MCP call
3. If not persisted, auto-persists with classified memory type
4. Logs violation if persistence fails
5. Provides context-pull helper that queries LTM for related prior context

Exit codes:
  0 - Persistence successful or gracefully skipped (Pieces unavailable)
  1 - Persistence failed critically
  2 - No persistence needed (trivial chain)
"""

from __future__ import annotations
import json
import os
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

UTC = timezone.utc

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

PIECES_MCP_URL = os.environ.get(
    "PIECES_MCP_URL",
    "http://localhost:39302/model_context_protocol/2024-11-05",
)
PIECES_MCP_TIMEOUT = int(os.environ.get("PIECES_MCP_TIMEOUT", "10"))

EVOLUTION_DIR = Path(os.environ.get("EVOLUTION_DIR", str(Path.home() / ".dreamcode" / "evolution")))
VIOLATIONS_LOG = EVOLUTION_DIR / "violations.log"
WRITES_LOG = EVOLUTION_DIR / "pieces_writes.jsonl"
METRICS_PATH = Path.home() / ".dreamcode" / "evolution" / "pieces_writes.jsonl"

CHAIN_EXECUTION_LOG = EVOLUTION_DIR / "chain_execution.jsonl"
RUN_LOG = EVOLUTION_DIR / "run_log.jsonl"

# Minimum chain size to consider non-trivial
MIN_SKILLS = 4
MIN_FILES_CHANGED = 1

MEMORY_TYPES = {
    "standup": {"retention_days": 30, "priority": "low"},
    "decision": {"retention_days": -1, "priority": "high"},
    "breakthrough": {"retention_days": -1, "priority": "high"},
    "bugfix": {"retention_days": 90, "priority": "medium"},
    "learn": {"retention_days": -1, "priority": "high"},
    "incident": {"retention_days": -1, "priority": "high"},
}


# ---------------------------------------------------------------------------
# MCP Client (with retry)
# ---------------------------------------------------------------------------

def call_mcp_tool(tool_name: str, arguments: dict, retries: int = 2) -> dict:
    """Call a Pieces MCP tool via HTTP with retry."""
    url = f"{PIECES_MCP_URL}/messages"
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": tool_name, "arguments": arguments},
    }
    payload_bytes = json.dumps(payload).encode()

    last_error = None
    for attempt in range(1 + retries):
        try:
            req = urllib.request.Request(
                url,
                data=payload_bytes,
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=PIECES_MCP_TIMEOUT) as resp:
                result = json.loads(resp.read().decode())
                return result.get("result", result)
        except (urllib.error.URLError, urllib.error.HTTPError) as e:
            last_error = str(e)
            if attempt < retries:
                import time
                time.sleep(0.5 * (attempt + 1))
        except Exception as e:
            last_error = str(e)
            break

    return {"error": last_error, "unavailable": True}


# ---------------------------------------------------------------------------
# Health Check
# ---------------------------------------------------------------------------

def pieces_available() -> bool:
    """Check if Pieces MCP is reachable."""
    result = call_mcp_tool("health_check", {})
    return "error" not in result or not result.get("unavailable", False)


# ---------------------------------------------------------------------------
# Context Pull
# ---------------------------------------------------------------------------

def pull_prior_context(
    topics: list[str],
    task_description: str = "",
    time_window: str | None = "last 7 days",
) -> list[dict]:
    """
    Pull relevant prior context from Pieces LTM for a given task.

    This should be called BEFORE starting a significant piece of work
    to ensure the agent has full context from past sessions.
    """
    query_parts = [task_description] if task_description else []
    query_parts.extend(topics)
    query = " ".join(query_parts) if query_parts else "recent work"

    arguments = {
        "question": query,
    }
    if time_window:
        arguments["time_ranges"] = [{"from": time_window}]
    if topics:
        arguments["topics"] = topics

    result = call_mcp_tool("ask_pieces_ltm", arguments)
    events = result.get("events", [])
    summaries = result.get("summaries", [])

    # Try search_memory as fallback
    if not events and not summaries:
        search_result = call_mcp_tool("search_memory", {
            "query": query,
            "hints": [{"value": t} for t in topics] if topics else [],
        })
        events = search_result.get("events", [])

    return events[:10]  # Return top 10 most relevant


# ---------------------------------------------------------------------------
# Persistence Check
# ---------------------------------------------------------------------------

def check_already_persisted(chain_id: str) -> bool:
    """Check if this chain execution was already persisted."""
    if not WRITES_LOG.exists():
        return False
    try:
        with open(WRITES_LOG) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                entry = json.loads(line)
                if entry.get("chain_id") == chain_id:
                    return True
    except (json.JSONDecodeError, OSError):
        pass
    return False


def read_last_chain_execution() -> dict | None:
    """Read the most recent chain execution from the log."""
    if not CHAIN_EXECUTION_LOG.exists():
        return None
    try:
        lines = CHAIN_EXECUTION_LOG.read_text().strip().split("\n")
        if not lines:
            return None
        return json.loads(lines[-1])
    except (json.JSONDecodeError, OSError):
        return None


def read_last_run_log() -> dict | None:
    """Read the most recent run log entry."""
    if not RUN_LOG.exists():
        return None
    try:
        lines = RUN_LOG.read_text().strip().split("\n")
        if not lines:
            return None
        return json.loads(lines[-1])
    except (json.JSONDecodeError, OSError):
        return None


# ---------------------------------------------------------------------------
# Memory Classification
# ---------------------------------------------------------------------------

def classify_memory(
    task_description: str,
    outcome: str,
    files_changed: list[str],
    key_decisions: list[str],
) -> str:
    """Auto-classify the memory type based on content."""
    desc_lower = task_description.lower()

    if any(w in desc_lower for w in ["fix", "bug", "error", "crash", "broken"]):
        return "bugfix"
    elif any(w in desc_lower for w in ["decided", "chose", "architecture", "design"]):
        return "decision"
    elif any(w in desc_lower for w in ["breakthrough", "novel", "first time"]):
        return "breakthrough"
    elif any(w in desc_lower for w in ["learned", "pattern", "discovered", "rule"]):
        return "learn"
    elif any(w in desc_lower for w in ["incident", "production", "outage"]):
        return "incident"
    elif outcome == "success" and len(files_changed) > 0:
        return "standup"
    return "standup"


# ---------------------------------------------------------------------------
# Build Memory
# ---------------------------------------------------------------------------

def build_memory_summary(
    chain_name: str,
    task_description: str,
    outcome: str,
    files_changed: list[str],
    key_decisions: list[str],
    metrics: dict,
) -> str:
    """Build a structured memory summary."""
    lines = [
        f"## {chain_name}",
        "",
        f"**Task:** {task_description}",
        f"**Outcome:** {outcome}",
        f"**Time:** {datetime.now(UTC).isoformat()}",
        "",
    ]
    if files_changed:
        lines.append("**Files Changed:**")
        for f in files_changed:
            lines.append(f"- `{f}`")
        lines.append("")
    if key_decisions:
        lines.append("**Key Decisions:**")
        for d in key_decisions:
            lines.append(f"- {d}")
        lines.append("")
    if metrics:
        lines.append("**Metrics:**")
        for k, v in metrics.items():
            lines.append(f"- {k}: {v}")
        lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Persist
# ---------------------------------------------------------------------------

def persist_chain_result(
    chain_id: str,
    chain_name: str,
    task_description: str,
    outcome: str,
    files_changed: list[str] | None = None,
    key_decisions: list[str] | None = None,
    metrics: dict | None = None,
    memory_type: str | None = None,
) -> dict:
    """
    Persist a skill chain result to Pieces LTM.
    Returns dict with success/error info.
    """
    files_changed = files_changed or []
    key_decisions = key_decisions or []
    metrics = metrics or {}

    if not memory_type:
        memory_type = classify_memory(task_description, outcome, files_changed, key_decisions)

    summary = build_memory_summary(
        chain_name, task_description, outcome,
        files_changed, key_decisions, metrics,
    )
    description = f"[{memory_type.upper()}] {task_description[:100]} — {outcome}"

    # Persist via MCP
    maybe_root = os.environ.get("PROJECT_ROOT", os.getcwd())
    result = call_mcp_tool("create_pieces_memory", {
        "summary": summary,
        "summary_description": description,
        "project": maybe_root,
        "files": [str(Path(maybe_root) / f) for f in files_changed] if files_changed else [],
        "connected_client": "dreamcode",
    })

    # Log the write
    _log_write(chain_id, memory_type, task_description, outcome, len(files_changed), result)

    return {
        "memory_type": memory_type,
        "description": description,
        "success": "error" not in result,
        "mcp_result": result,
    }


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

def _log_write(
    chain_id: str,
    memory_type: str,
    task_description: str,
    outcome: str,
    files_count: int,
    result: dict,
) -> None:
    """Log the write to the writes log."""
    EVOLUTION_DIR.mkdir(parents=True, exist_ok=True)
    entry = {
        "chain_id": chain_id,
        "timestamp": datetime.now(UTC).isoformat(),
        "memory_type": memory_type,
        "task_description": task_description[:200],
        "outcome": outcome,
        "files_count": files_count,
        "success": "error" not in result,
    }
    with open(WRITES_LOG, "a") as f:
        f.write(json.dumps(entry) + "\n")


def log_violation(message: str) -> None:
    """Log a persistence violation."""
    EVOLUTION_DIR.mkdir(parents=True, exist_ok=True)
    entry = {
        "timestamp": datetime.now(UTC).isoformat(),
        "type": "persistence_violation",
        "message": message,
    }
    with open(VIOLATIONS_LOG, "a") as f:
        f.write(json.dumps(entry) + "\n")


# ---------------------------------------------------------------------------
# Main Enforcement Logic
# ---------------------------------------------------------------------------

def enforce() -> int:
    """
    Main enforcement logic.

    Flow:
    1. Read the most recent chain execution info
    2. Determine if it was non-trivial (4+ skills, 1+ files changed)
    3. Check if persistence already happened
    4. If not, persist and report
    5. If Pieces unavailable, log violation but don't fail
    """
    chain_id = os.environ.get("CHAIN_EXECUTION_ID", f"run-{datetime.now(UTC).strftime('%Y%m%d%H%M%S')}")
    chain_name = os.environ.get("CHAIN_NAME", "unknown")
    task_description = os.environ.get("TASK_DESCRIPTION", "")
    prompt_file = None

    # Parse CLI args
    for i, arg in enumerate(sys.argv):
        if arg == "--prompt-file" and i + 1 < len(sys.argv):
            prompt_file = sys.argv[i + 1]
        if arg == "--chain-id" and i + 1 < len(sys.argv):
            chain_id = sys.argv[i + 1]
        if arg == "--chain-name" and i + 1 < len(sys.argv):
            chain_name = sys.argv[i + 1]
        if arg == "--task" and i + 1 < len(sys.argv):
            task_description = sys.argv[i + 1]

    # Read prompt file if provided
    if prompt_file:
        try:
            task_description = Path(prompt_file).read_text().strip()[:500]
        except Exception:
            pass

    # Try to read last chain execution for context
    last_chain = read_last_chain_execution()
    last_run = read_last_run_log()

    # Extract info from logs if not provided via env/cmdline
    if last_chain and not task_description:
        task_description = last_chain.get("task_description", task_description)
        chain_name = last_chain.get("chain_name", chain_name)
        chain_id = last_chain.get("chain_id", chain_id)

    if last_run and not task_description:
        task_description = last_run.get("prompt_excerpt", task_description)

    # Determine if the chain is non-trivial
    skills_count = int(os.environ.get("SKILLS_FIRED", last_chain.get("chain_length", 0) if last_chain else "0"))
    files_changed_str = os.environ.get("FILES_CHANGED",
        json.dumps(last_chain.get("files_changed", [])) if last_chain else "[]")
    files_changed = json.loads(files_changed_str) if isinstance(files_changed_str, str) else files_changed_str
    key_decisions_str = os.environ.get("KEY_DECISIONS",
        json.dumps(last_chain.get("key_decisions", [])) if last_chain else "[]")
    key_decisions = json.loads(key_decisions_str) if isinstance(key_decisions_str, str) else key_decisions_str

    is_non_trivial = skills_count >= MIN_SKILLS or len(files_changed) >= MIN_FILES_CHANGED

    if not is_non_trivial:
        # Trivial chain - skip persistence
        return 2

    # Check if already persisted
    if check_already_persisted(chain_id):
        return 0

    # Check Pieces availability
    if not pieces_available():
        log_violation(
            f"Pieces MCP unavailable for chain {chain_id} ({chain_name}). "
            f"Persistence skipped. Task: {task_description[:100]}"
        )
        print(json.dumps({
            "status": "skipped",
            "reason": "pieces_unavailable",
            "chain_id": chain_id,
        }))
        return 0  # Graceful degradation

    # Also pull prior context for enrichment
    topics = last_chain.get("topics", []) if last_chain else []
    prior_context = pull_prior_context(topics, task_description)

    # Persist
    outcome = last_chain.get("outcome", "success") if last_chain else "success"
    result = persist_chain_result(
        chain_id=chain_id,
        chain_name=chain_name,
        task_description=task_description,
        outcome=outcome,
        files_changed=files_changed,
        key_decisions=key_decisions,
        metrics={
            "skills_count": skills_count,
            "files_changed": len(files_changed),
            "prior_context_events": len(prior_context),
        },
    )

    if result["success"]:
        print(json.dumps({"status": "persisted", "chain_id": chain_id, "memory_type": result["memory_type"]}))
        return 0
    else:
        log_violation(
            f"Persistence FAILED for chain {chain_id} ({chain_name}): "
            f"{result['mcp_result'].get('error', 'unknown error')}"
        )
        print(json.dumps({"status": "failed", "chain_id": chain_id, "error": result["mcp_result"].get("error")}))
        return 1


# ---------------------------------------------------------------------------
# CLI Entry Point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    sys.exit(enforce())

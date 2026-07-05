#!/usr/bin/env python3
"""
Pieces LTM Enforcer — Hybrid Persistence + Context Pull for Skill Chains

This script serves two modes:

1. PERSIST mode (default): Enforces the parent agent to persist the entire
   learning from a skill chain execution to Pieces LTM. Must be called at the
   END of every non-trivial chain.

2. PULL mode: Retrieves context from Pieces LTM via semantic search, used
   by the parent agent when establishing context at the start of a chain.

Usage:
    # Persist (after chain completes):
    python3 pieces_ltm_enforcer.py persist \\
        --chain "neuro -> code-hardener -> lint-fixer" \\
        --task "Fixed black screen dialog race condition" \\
        --outcome success \\
        --files "packages/tui/src/ui/dialog.tsx" \\
                 "packages/tui/src/app.tsx" \\
        --decisions "Added re-entrant clear() guard" \\
                    "Added stopPropagation() to dialog option mouseup" \\
        --metrics '{"tokens_used": 42000, "iterations": 3}'

    # Pull context (at chain start):
    python3 pieces_ltm_enforcer.py pull \\
        --query "black screen dialog race condition fix" \\
        --topics "tui dialog clear selection" \\
        --time_window "this week"
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

UTC = timezone.utc

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

PIECES_MCP_URL = os.environ.get(
    "PIECES_MCP_URL",
    "http://localhost:39302/model_context_protocol/2024-11-05",
)
# Resolve evolution dir from project root or home fallback
PROJECT_ROOT = Path(os.environ.get("PROJECT_ROOT", Path.cwd()))
HOME_EVOLUTION = Path.home() / ".dreamcode" / "evolution"
EVOLUTION_DIR = HOME_EVOLUTION
VIOLATIONS_PATH = EVOLUTION_DIR / "violations.log"
PIECES_WRITES_PATH = EVOLUTION_DIR / "pieces_writes.jsonl"

# ---------------------------------------------------------------------------
# MCP Client
# ---------------------------------------------------------------------------

MCP_TOOL_TIMEOUT = 15  # seconds


def call_mcp_tool(tool_name: str, arguments: dict) -> dict:
    """Call a Pieces MCP tool via HTTP with timeout."""
    url = f"{PIECES_MCP_URL}/messages"
    payload = {
        "jsonrpc": "2.0",
        "id": int(time.time() * 1000) % 100000,
        "method": "tools/call",
        "params": {"name": tool_name, "arguments": arguments},
    }
    payload_bytes = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload_bytes,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=MCP_TOOL_TIMEOUT) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            return result.get("result", result)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        return {"error": f"HTTP {e.code}: {body[:200]}"}
    except urllib.error.URLError as e:
        return {"error": f"Connection failed: {e.reason}"}
    except Exception as e:
        return {"error": str(e)}


# ---------------------------------------------------------------------------
# Memory Type Classification
# ---------------------------------------------------------------------------

MEMORY_TYPES = {
    "standup": {"retention_days": 30, "priority": "low"},
    "decision": {"retention_days": -1, "priority": "high"},
    "breakthrough": {"retention_days": -1, "priority": "high"},
    "bugfix": {"retention_days": 90, "priority": "medium"},
    "learn": {"retention_days": -1, "priority": "high"},
    "incident": {"retention_days": -1, "priority": "high"},
}


def classify_memory(
    task_description: str,
    outcome: str,
    files_changed: list[str],
    key_decisions: list[str],
) -> str:
    """Auto-classify the memory type based on content keywords."""
    desc_lower = task_description.lower()
    decision_text = " ".join(key_decisions).lower()

    if "fix" in desc_lower or "bug" in desc_lower or "error" in desc_lower or "race" in desc_lower:
        return "bugfix"
    elif "breakthrough" in desc_lower or "novel" in desc_lower or "first time" in desc_lower:
        return "breakthrough"
    elif any(kw in decision_text for kw in ["decided", "chose", "architecture", "pattern", "design"]):
        return "decision"
    elif "learned" in desc_lower or "pattern" in desc_lower or "discovered" in desc_lower:
        return "learn"
    elif "incident" in desc_lower or "production" in desc_lower or "outage" in desc_lower:
        return "incident"
    elif outcome == "success" and len(files_changed) > 0:
        return "standup"
    else:
        return "standup"


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------

def persist_chain_result(
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
    Returns dict with: memory_type, description, mcp_result, pieces_written.
    """
    files_changed = files_changed or []
    key_decisions = key_decisions or []
    metrics = metrics or {}

    # Auto-classify if not provided
    if not memory_type:
        memory_type = classify_memory(task_description, outcome, files_changed, key_decisions)

    ts = datetime.now(UTC).isoformat()

    # Build structured summary (detailed narrative)
    summary_lines = [
        f"## {chain_name}",
        "",
        f"**Task:** {task_description}",
        f"**Outcome:** {outcome}",
        f"**Time:** {ts}",
        "",
    ]
    if files_changed:
        summary_lines.append("**Files Changed:**")
        for f in files_changed:
            summary_lines.append(f"- `{f}`")
        summary_lines.append("")
    if key_decisions:
        summary_lines.append("**Key Decisions:**")
        for d in key_decisions:
            summary_lines.append(f"- {d}")
        summary_lines.append("")
    if metrics:
        summary_lines.append("**Metrics:**")
        for k, v in metrics.items():
            summary_lines.append(f"- {k}: {v}")
        summary_lines.append("")

    summary = "\n".join(summary_lines)
    description = f"[{memory_type.upper()}] {task_description[:150]} — {outcome}"

    # Resolve absolute file paths from project root
    abs_files = []
    for f in files_changed:
        p = Path(f)
        if p.is_absolute():
            abs_files.append(str(p))
        else:
            abs_files.append(str(PROJECT_ROOT / f))

    # Persist via MCP
    mcp_result = call_mcp_tool("create_pieces_memory", {
        "summary": summary,
        "summary_description": description,
        "project": str(PROJECT_ROOT),
        "files": abs_files,
        "connected_client": "opencode",
    })

    # Log the write locally
    _log_write(memory_type, task_description, outcome, len(files_changed), mcp_result)

    return {
        "memory_type": memory_type,
        "description": description,
        "pieces_written": "error" not in mcp_result,
        "mcp_result": mcp_result,
    }


def pull_context(
    query: str,
    topics: list[str] | None = None,
    time_window: str | None = None,
    memory_type: str | None = None,
    max_results: int = 5,
) -> dict:
    """
    Pull context from Pieces LTM via hybrid search.

    Uses ask_pieces_ltm for semantic question answering and
    search_memory for candidate retrieval.
    """
    topics = topics or []
    result: dict[str, Any] = {"query": query, "contexts": [], "sources": []}

    # Method 1: Direct question to LTM
    ask_args: dict[str, Any] = {"question": query}
    if topics:
        ask_args["topics"] = topics
    if time_window:
        ask_args["time_window"] = time_window

    ask_result = call_mcp_tool("ask_pieces_ltm", ask_args)
    if "error" not in ask_result:
        result["sources"].append({"method": "ask_pieces_ltm", "result": ask_result})

    # Method 2: Search memory for candidates
    search_args: dict[str, Any] = {
        "hints": [{"value": t} for t in (topics or [query])],
    }
    if time_window:
        # time_window is a string like "this week" — create from/to if needed
        pass

    search_result = call_mcp_tool("search_memory", search_args)
    if "error" not in search_result:
        candidates = search_result.get("candidates", [])
        result["contexts"] = candidates[:max_results]
        result["sources"].append({"method": "search_memory", "count": len(candidates)})

    # Method 3: materials_vector_search for semantic similarity
    vector_args: dict[str, Any] = {
        "query": query,
        "material_type": "WORKSTREAM_SUMMARIES",
        "limit": max_results,
    }
    vector_result = call_mcp_tool("materials_vector_search", vector_args)
    if "error" not in vector_result:
        vector_items = vector_result.get("identifiers", [])[:max_results]
        if vector_items:
            result["sources"].append({"method": "materials_vector_search", "count": len(vector_items)})
            result["vector_results"] = vector_items

    result["total_contexts"] = len(result["contexts"])
    return result


# ---------------------------------------------------------------------------
# Health Check / Diagnostics
# ---------------------------------------------------------------------------

def health_check() -> dict:
    """Check if Pieces MCP is reachable."""
    start = time.time()
    result = call_mcp_tool("ask_pieces_ltm", {"question": "health check"})
    elapsed = time.time() - start
    return {
        "reachable": "error" not in result,
        "latency_ms": round(elapsed * 1000),
        "mcp_url": PIECES_MCP_URL,
        "result": result,
    }


def get_write_stats() -> dict:
    """Get persistence statistics from local audit log."""
    if not PIECES_WRITES_PATH.exists():
        return {"total_writes": 0, "by_type": {}, "recent": []}

    writes = []
    with open(PIECES_WRITES_PATH) as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    writes.append(json.loads(line))
                except json.JSONDecodeError:
                    continue

    by_type: dict[str, int] = {}
    for w in writes:
        t = w.get("memory_type", "unknown")
        by_type[t] = by_type.get(t, 0) + 1

    return {
        "total_writes": len(writes),
        "by_type": by_type,
        "recent": writes[-5:],
    }


# ---------------------------------------------------------------------------
# Audit Logging
# ---------------------------------------------------------------------------

def _log_write(
    memory_type: str,
    task_description: str,
    outcome: str,
    files_count: int,
    mcp_result: dict,
) -> None:
    """Log the write to local audit trail."""
    EVOLUTION_DIR.mkdir(parents=True, exist_ok=True)

    entry = {
        "timestamp_utc": datetime.now(UTC).isoformat(),
        "memory_type": memory_type,
        "task_description": task_description[:200],
        "outcome": outcome,
        "files_count": files_count,
        "pieces_written": "error" not in mcp_result,
    }

    with open(PIECES_WRITES_PATH, "a") as f:
        f.write(json.dumps(entry) + "\n")


def log_violation(message: str) -> None:
    """Log a persistence violation."""
    EVOLUTION_DIR.mkdir(parents=True, exist_ok=True)
    entry = {
        "timestamp_utc": datetime.now(UTC).isoformat(),
        "type": "persistence_violation",
        "message": message,
    }
    with open(VIOLATIONS_PATH, "a") as f:
        f.write(json.dumps(entry) + "\n")


# ---------------------------------------------------------------------------
# Enforcement Entry Point
# ---------------------------------------------------------------------------

def enforce_persist(
    chain: list[str],
    prompt: str,
    outcome: str,
    files: list[str],
    decisions: list[str],
    metrics: dict | None = None,
) -> dict:
    """
    Enforce Pieces LTM persistence for a completed chain.

    This is the main entry point called by the chain executor after
    all steps complete. It:
    1. Persists the result to Pieces LTM
    2. Logs the write locally for audit
    3. Verifies persistence succeeded
    4. Reports any violations
    """
    metrics = metrics or {}
    chain_name = " → ".join(chain)

    print(f"\n{'='*60}")
    print(f"PIECES LTM ENFORCER — Persisting Chain Results")
    print(f"{'='*60}")
    print(f"  Chain:      {chain_name}")
    print(f"  Task:       {prompt[:80]}...")
    print(f"  Outcome:    {outcome}")
    print(f"  Files:      {len(files)} changed")
    print(f"  Decisions:  {len(decisions)}")

    # Step 1: Health check
    health = health_check()
    if not health["reachable"]:
        msg = f"Pieces MCP unreachable at {PIECES_MCP_URL} (latency: {health['latency_ms']}ms)"
        print(f"  ⚠ {msg}")
        log_violation(msg)
        return {
            "persisted": False,
            "error": msg,
            "health": health,
        }

    print(f"  ✓ Pieces MCP reachable ({health['latency_ms']}ms)")

    # Step 2: Persist
    result = persist_chain_result(
        chain_name=chain_name,
        task_description=prompt,
        outcome=outcome,
        files_changed=files,
        key_decisions=decisions,
        metrics=metrics,
    )

    # Step 3: Verify
    if result["pieces_written"]:
        print(f"  ✓ Persisted to Pieces LTM ({result['memory_type']})")
        print(f"  ✓ Audit logged to {PIECES_WRITES_PATH}")
    else:
        msg = f"Failed to persist: {result.get('mcp_result', {}).get('error', 'unknown')}"
        print(f"  ✗ {msg}")
        log_violation(msg)

    print(f"{'='*60}\n")
    return result


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(
        description="Pieces LTM Enforcer — persist chain results & pull context"
    )
    sub = parser.add_subparsers(dest="command")

    # ── persist ──
    persist_cmd = sub.add_parser("persist", help="Persist chain result to Pieces LTM")
    persist_cmd.add_argument("--chain", nargs="*", default=[], help="Skills in the chain")
    persist_cmd.add_argument("--task", required=True, help="Task description (user prompt)")
    persist_cmd.add_argument("--outcome", default="success", choices=["success", "failed", "partial"],
                             help="Execution outcome")
    persist_cmd.add_argument("--files", nargs="*", default=[], help="Files changed")
    persist_cmd.add_argument("--decisions", nargs="*", default=[], help="Key decisions made")
    persist_cmd.add_argument("--type", help="Memory type override (bugfix/decision/breakthrough/learn/etc)")
    persist_cmd.add_argument("--metrics", help="JSON metrics dict")

    # ── pull ──
    pull_cmd = sub.add_parser("pull", help="Pull context from Pieces LTM")
    pull_cmd.add_argument("--query", required=True, help="Search query")
    pull_cmd.add_argument("--topics", nargs="*", default=[], help="Topic keywords")
    pull_cmd.add_argument("--time_window", help="Time window (e.g., 'this week', 'yesterday')")

    # ── health ──
    sub.add_parser("health", help="Check Pieces MCP health")

    # ── stats ──
    sub.add_parser("stats", help="Show persistence statistics")

    args = parser.parse_args()

    if args.command == "persist":
        metrics = {}
        if args.metrics:
            try:
                metrics = json.loads(args.metrics)
            except json.JSONDecodeError as e:
                print(f"Warning: invalid metrics JSON: {e}", file=sys.stderr)

        result = enforce_persist(
            chain=args.chain,
            prompt=args.task,
            outcome=args.outcome,
            files=args.files,
            decisions=args.decisions,
            metrics=metrics,
        )
        print(json.dumps(result, indent=2, default=str))

    elif args.command == "pull":
        result = pull_context(
            query=args.query,
            topics=args.topics,
            time_window=args.time_window,
        )
        print(json.dumps(result, indent=2, default=str))

    elif args.command == "health":
        result = health_check()
        print(json.dumps(result, indent=2))

    elif args.command == "stats":
        stats = get_write_stats()
        print(json.dumps(stats, indent=2))

    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Pieces LTM Persistence Wrapper

Auto-persists skill chain results to Pieces LTM via MCP.
Provides structured memory creation with metadata.
"""

from __future__ import annotations
import json
import os
import urllib.request
from datetime import datetime, timezone
UTC = timezone.utc  # Python 3.2+ compat (not 3.11+ only)
from pathlib import Path

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

PIECES_MCP_URL = os.environ.get(
    "PIECES_MCP_URL",
    "http://localhost:39302/model_context_protocol/2024-11-05",
)
PROJECT_ROOT = Path(os.environ.get("PROJECT_ROOT", Path.cwd()))
METRICS_PATH = PROJECT_ROOT / "evolution" / "pieces_writes.jsonl"


# ---------------------------------------------------------------------------
# Memory Types
# ---------------------------------------------------------------------------

MEMORY_TYPES = {
    "standup": {"retention_days": 30, "priority": "low"},
    "decision": {"retention_days": -1, "priority": "high"},  # -1 = permanent
    "breakthrough": {"retention_days": -1, "priority": "high"},
    "bugfix": {"retention_days": 90, "priority": "medium"},
    "learn": {"retention_days": -1, "priority": "high"},
    "incident": {"retention_days": -1, "priority": "high"},
}


# ---------------------------------------------------------------------------
# MCP Client
# ---------------------------------------------------------------------------

def call_mcp_tool(tool_name: str, arguments: dict) -> dict:
    """Call a Pieces MCP tool via the legacy SSE transport.

    Pieces for Developers exposes MCP over legacy SSE: GET /sse yields an
    'endpoint' event with the real JSON-RPC POST target (sessionId+token).
    A bare POST to /messages 404s, and the JSON-RPC response for a call
    arrives back on the *same* SSE stream that was opened for the session,
    so we must keep that one stream open across the POST and read from it.
    """
    import time
    import urllib.parse

    sse_url = f"{PIECES_MCP_URL}/sse"
    sse_req = urllib.request.Request(sse_url, headers={"Accept": "text/event-stream"})
    sse_resp = urllib.request.urlopen(sse_req, timeout=15)
    buf = ""
    endpoint = None
    try:
        # 1) Read the 'endpoint' event from the live SSE stream.
        while endpoint is None:
            chunk = sse_resp.read(1).decode("utf-8", "replace")
            if not chunk:
                break
            buf += chunk
            if buf.endswith("\n\n"):
                for frame in buf.split("\n\n"):
                    if "event:" in frame:
                        lines = frame.splitlines()
                        kind = next(
                            (l for l in lines if l.startswith("event:")), "event: message"
                        ).split(":", 1)[1].strip()
                        data = "".join(
                            l.split(":", 1)[1] if l.startswith("data:") else ""
                            for l in lines[1:]
                        )
                        if kind == "endpoint" and data.strip():
                            endpoint = data.strip()
                buf = ""

        if not endpoint:
            raise RuntimeError("SSE session yielded no endpoint event")

        msg_url = (
            endpoint
            if endpoint.startswith("http")
            else urllib.parse.urljoin(PIECES_MCP_URL, endpoint)
        )

        # 2) POST the JSON-RPC call to that endpoint (returns 202).
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": tool_name, "arguments": arguments},
        }
        post_req = urllib.request.Request(
            msg_url,
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(post_req, timeout=30) as _post:
            _post.read()

        # 3) Read the matching response off the SAME SSE stream.
        deadline = time.time() + 15
        while time.time() < deadline:
            if not buf.endswith("\n\n"):
                chunk = sse_resp.read(1).decode("utf-8", "replace")
                if not chunk:
                    break
                buf += chunk
            if buf.endswith("\n\n"):
                for frame in buf.split("\n\n"):
                    if "event:" in frame:
                        lines = frame.splitlines()
                        kind = next(
                            (l for l in lines if l.startswith("event:")), "event: message"
                        ).split(":", 1)[1].strip()
                        data = "".join(
                            l.split(":", 1)[1] if l.startswith("data:") else ""
                            for l in lines[1:]
                        )
                        if kind in ("message", "data") and data.strip():
                            try:
                                parsed = json.loads(data)
                            except json.JSONDecodeError:
                                continue
                            if isinstance(parsed, dict) and parsed.get("id") == 1:
                                return parsed.get("result", parsed)
                buf = ""
    finally:
        try:
            sse_resp.close()
        except Exception:
            pass
    return {"error": "timed out waiting for MCP response"}


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

    if "fix" in desc_lower or "bug" in desc_lower or "error" in desc_lower:
        return "bugfix"
    elif "decided" in desc_lower or "chose" in desc_lower or "architecture" in desc_lower:
        return "decision"
    elif "breakthrough" in desc_lower or "novel" in desc_lower or "first time" in desc_lower:
        return "breakthrough"
    elif "learned" in desc_lower or "pattern" in desc_lower or "discovered" in desc_lower:
        return "learn"
    elif "incident" in desc_lower or "production" in desc_lower or "outage" in desc_lower:
        return "incident"
    elif outcome == "success" and len(files_changed) > 0:
        return "standup"
    else:
        return "standup"


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

    Args:
        chain_name: Name of the skill chain that executed
        task_description: What the user asked for
        outcome: "success" or "failed"
        files_changed: List of files modified
        key_decisions: Key decisions made during execution
        metrics: Execution metrics (tokens, iterations, etc.)
        memory_type: Override auto-classification

    Returns:
        MCP response dict
    """
    files_changed = files_changed or []
    key_decisions = key_decisions or []
    metrics = metrics or {}

    # Auto-classify if not provided
    if not memory_type:
        memory_type = classify_memory(
            task_description, outcome, files_changed, key_decisions
        )

    # Build summary
    summary = build_memory_summary(
        chain_name, task_description, outcome,
        files_changed, key_decisions, metrics,
    )

    # Build description (short)
    description = f"[{memory_type.upper()}] {task_description} — {outcome}"

    # Persist via MCP
    result = call_mcp_tool("create_pieces_memory", {
        "summary": summary,
        "summary_description": description,
        "project": str(PROJECT_ROOT),
        "files": [str(PROJECT_ROOT / f) for f in files_changed],
        "connected_client": "opencode",
    })

    # Log the write
    _log_write(memory_type, task_description, outcome, len(files_changed))

    return {
        "memory_type": memory_type,
        "description": description,
        "mcp_result": result,
    }


def search_ltm(
    query: str,
    time_window: str | None = None,
    topics: list[str] | None = None,
    memory_type: str | None = None,
) -> dict:
    """
    Search Pieces LTM with improved patterns.

    Args:
        query: Search query
        time_window: Optional time window (e.g., "yesterday", "this week")
        topics: Optional topic filters
        memory_type: Optional memory type filter

    Returns:
        Search results dict
    """
    arguments = {"question": query}

    if time_window:
        arguments["time_window"] = time_window

    if topics:
        arguments["topics"] = topics

    result = call_mcp_tool("ask_pieces_ltm", arguments)
    return result


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

def _log_write(
    memory_type: str,
    task_description: str,
    outcome: str,
    files_count: int,
) -> None:
    """Log the write to metrics file."""
    METRICS_PATH.parent.mkdir(parents=True, exist_ok=True)

    entry = {
        "timestamp": datetime.now(UTC).isoformat(),
        "memory_type": memory_type,
        "task_description": task_description[:200],
        "outcome": outcome,
        "files_count": files_count,
    }

    with open(METRICS_PATH, "a") as f:
        f.write(json.dumps(entry) + "\n")


def get_write_stats() -> dict:
    """Get persistence statistics."""
    if not METRICS_PATH.exists():
        return {"total_writes": 0, "by_type": {}}

    writes = []
    with open(METRICS_PATH) as f:
        for line in f:
            if line.strip():
                writes.append(json.loads(line))

    by_type = {}
    for w in writes:
        t = w.get("memory_type", "unknown")
        by_type[t] = by_type.get(t, 0) + 1

    return {"total_writes": len(writes), "by_type": by_type}


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Pieces LTM Persistence")
    sub = parser.add_subparsers(dest="command")

    # persist command
    persist_cmd = sub.add_parser("persist", help="Persist a chain result")
    persist_cmd.add_argument("--chain", required=True, help="Chain name")
    persist_cmd.add_argument("--task", required=True, help="Task description")
    persist_cmd.add_argument("--outcome", default="success", help="Outcome")
    persist_cmd.add_argument("--files", nargs="*", default=[], help="Files changed")
    persist_cmd.add_argument("--decisions", nargs="*", default=[], help="Key decisions")
    persist_cmd.add_argument("--type", help="Memory type override")

    # search command
    search_cmd = sub.add_parser("search", help="Search LTM")
    search_cmd.add_argument("--query", required=True, help="Search query")
    search_cmd.add_argument("--time", help="Time window")
    search_cmd.add_argument("--topics", nargs="*", default=[], help="Topics")

    # stats command
    sub.add_parser("stats", help="Show persistence stats")

    args = parser.parse_args()

    if args.command == "persist":
        result = persist_chain_result(
            chain_name=args.chain,
            task_description=args.task,
            outcome=args.outcome,
            files_changed=args.files,
            key_decisions=args.decisions,
            memory_type=args.type,
        )
        print(json.dumps(result, indent=2))

    elif args.command == "search":
        result = search_ltm(
            query=args.query,
            time_window=args.time,
            topics=args.topics,
        )
        print(json.dumps(result, indent=2))

    elif args.command == "stats":
        stats = get_write_stats()
        print(json.dumps(stats, indent=2))

    else:
        parser.print_help()

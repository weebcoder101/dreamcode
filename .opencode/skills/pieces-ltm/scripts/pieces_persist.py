#!/usr/bin/env python3
"""
Pieces LTM Persistence Wrapper

Auto-persists skill chain results to Pieces LTM via MCP.
Provides structured memory creation with metadata.
"""

from __future__ import annotations
import json
import os
import re
import socket
import urllib.parse
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

def _establish_session():
    """Open the SSE stream and extract the sessioned messages endpoint.

    Pieces' MCP server requires a session: GET /sse returns an endpoint
    URL carrying sessionId + auth token; every JSON-RPC POST must go to
    that URL and responses arrive back on the SSE stream.
    """
    parts = urllib.parse.urlsplit(PIECES_MCP_URL)
    scheme = parts.scheme or "http"
    host = parts.hostname or "localhost"
    port = parts.port or (443 if scheme == "https" else 80)
    sock = socket.create_connection((host, port), timeout=15)
    path = parts.path.rstrip("/") + "/sse"
    sock.sendall(
        (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: {host}:{port}\r\n"
            "Accept: text/event-stream\r\n"
            "Connection: keep-alive\r\n\r\n"
        ).encode()
    )
    buf = b""
    while b"\r\n\r\n" not in buf:
        buf += sock.recv(4096)
    head, _, body = buf.partition(b"\r\n\r\n")
    status_line = head.split(b"\r\n", 1)[0].decode(errors="replace")
    if " 200 " not in status_line:
        sock.close()
        raise ConnectionError(f"SSE handshake failed: {status_line}")
    text = body.decode(errors="replace")
    m = re.search(r"^data: (\S+)", text, re.M)
    while not m:
        chunk = sock.recv(4096)
        if not chunk:
            break
        text += chunk.decode(errors="replace")
        m = re.search(r"^data: (\S+)", text, re.M)
    if not m:
        sock.close()
        raise ConnectionError("no endpoint event from Pieces SSE stream")
    return sock, urllib.parse.urljoin(PIECES_MCP_URL, m.group(1))


def _http_post(messages_url: str, method: str, params: dict) -> str:
    """Send a JSON-RPC message to the sessioned messages endpoint."""
    payload = json.dumps(
        {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
    ).encode()
    req = urllib.request.Request(
        messages_url,
        data=payload,
        headers={"Content-Type": "application/json", "Accept": "text/event-stream"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode()


def _read_message(sock: socket.socket, timeout: float = 30.0) -> dict:
    """Read the next JSON-RPC result/error event from the SSE stream."""
    sock.settimeout(timeout)
    buf = b""
    while True:
        try:
            chunk = sock.recv(4096)
        except OSError:
            raise ConnectionError("timed out waiting for MCP response")
        if not chunk:
            raise ConnectionError("Pieces MCP stream closed")
        buf += chunk
        text = buf.decode(errors="replace")
        for line in text.splitlines():
            if not line.startswith("data: "):
                continue
            try:
                obj = json.loads(line[6:])
            except ValueError:
                continue  # partial line across chunk boundary — keep reading
            if "result" in obj or "error" in obj:
                return obj


def call_mcp_tool(tool_name: str, arguments: dict) -> dict:
    """Call a Pieces MCP tool via its SSE session handshake."""
    try:
        sock, messages_url = _establish_session()
        try:
            _http_post(
                messages_url,
                "initialize",
                {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "pieces-persist", "version": "1.0.0"},
                },
            )
            _read_message(sock)
            _http_post(
                messages_url,
                "tools/call",
                {"name": tool_name, "arguments": arguments},
            )
            resp = _read_message(sock)
            if "error" in resp:
                return {"error": json.dumps(resp["error"])}
            return resp.get("result", resp)
        finally:
            sock.close()
    except Exception as e:
        return {"error": str(e)}


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

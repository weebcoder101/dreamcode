#!/usr/bin/env python3
"""deep_research.py — Automated Deep Research Harness (MCP-powered)

Decomposes queries into sub-questions, searches via Pieces MCP web_search,
synthesizes cited reports, and saves results for NEURO consumption.

Uses MCP protocol directly — no opencode run needed.

Usage:
    python3 deep_research.py --query "Flask vs FastAPI for production ML"
    python3 deep_research.py --query "OWASP top 10 2026" --mode exhaustive
    python3 deep_research.py --query "quantum error mitigation" --output evolution/research/quantum.md
"""

from __future__ import annotations

import argparse
import json
import os
import queue
import sys
import threading
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
UTC = timezone.utc  # Python 3.2+ compat (not 3.11+ only)
from pathlib import Path

import httpx

PROJECT_ROOT = Path(os.environ.get("PROJECT_ROOT", Path.cwd()))
EVOLUTION_DIR = PROJECT_ROOT / "evolution"
RESEARCH_DIR = EVOLUTION_DIR / "research"

sys.path.insert(0, str(PROJECT_ROOT / ".opencode" / "automations"))
from timezone import format_duration, now_ist_iso, now_ist_time

# ---------------------------------------------------------------------------
# MCP Client
# ---------------------------------------------------------------------------

MCP_BASE = "http://localhost:39302"
MCP_SSE = f"{MCP_BASE}/model_context_protocol/2024-11-05/sse"


class MCPClient:
    """Direct MCP protocol client for Pieces server."""

    def __init__(self):
        self.msg_url: str = ""
        self.q: queue.Queue = queue.Queue()
        self._thread: threading.Thread | None = None
        self._req_id = 0

    def _next_id(self) -> int:
        self._req_id += 1
        return self._req_id

    def _sse_reader(self, url: str) -> None:
        try:
            with httpx.stream("GET", url, timeout=300) as r:
                event_type = None
                data_lines = []
                for line in r.iter_lines():
                    if line.startswith("event:"):
                        event_type = line.split(":", 1)[1].strip()
                    elif line.startswith("data:"):
                        data_lines.append(line.split(":", 1)[1].strip())
                    elif line == "" and event_type:
                        self.q.put((event_type, "\n".join(data_lines)))
                        event_type = None
                        data_lines = []
        except Exception as e:
            self.q.put(("error", str(e)))

    def connect(self) -> bool:
        """Connect to MCP server via SSE and get message endpoint."""
        self._thread = threading.Thread(target=self._sse_reader, args=(MCP_SSE,), daemon=True)
        self._thread.start()

        try:
            evt, data = self.q.get(timeout=10)
            if evt == "endpoint":
                self.msg_url = MCP_BASE + data
                return True
        except queue.Empty:
            pass
        return False

    def initialize(self) -> bool:
        """Initialize MCP session."""
        req = {
            "jsonrpc": "2.0",
            "id": self._next_id(),
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "deep-research", "version": "2.0"},
            },
        }
        r = httpx.post(self.msg_url, json=req, timeout=10)
        if r.status_code != 200:
            return False

        # Read init response
        try:
            evt, dat = self.q.get(timeout=5)
            return True
        except queue.Empty:
            return False

    def call_tool(self, tool_name: str, arguments: dict, timeout: int = 120) -> dict | None:
        """Call an MCP tool and return the result."""
        req_id = self._next_id()
        req = {
            "jsonrpc": "2.0",
            "id": req_id,
            "method": "tools/call",
            "params": {"name": tool_name, "arguments": arguments},
        }

        try:
            r = httpx.post(self.msg_url, json=req, timeout=timeout)
            if r.status_code != 200:
                return None
        except Exception:
            return None

        # Read response from SSE
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                evt, dat = self.q.get(timeout=min(30, deadline - time.time()))
                if evt == "error":
                    continue
                parsed = json.loads(dat)
                if parsed.get("id") == req_id:
                    content = parsed.get("result", {}).get("content", [])
                    texts = [c.get("text", "") for c in content if c.get("type") == "text"]
                    return {"text": "\n".join(texts), "is_error": parsed.get("result", {}).get("isError", False)}
            except queue.Empty:
                continue
            except (json.JSONDecodeError, KeyError):
                continue
        return None

    def web_search(self, query: str, mode: str = "web", recency: str = "month") -> dict:
        """Search the web via Pieces MCP."""
        args = {
            "query": query,
            "search_mode": mode,
            "return_citations": True,
            "return_related_questions": False,
        }
        if recency:
            args["search_recency"] = recency

        result = self.call_tool("web_search", args, timeout=60)
        if result and not result.get("is_error"):
            try:
                data = json.loads(result["text"])
                return {
                    "query": query,
                    "answer": data.get("answer", ""),
                    "citations": data.get("citations", []),
                    "related": data.get("related_questions", []),
                }
            except (json.JSONDecodeError, KeyError):
                return {"query": query, "answer": result["text"], "citations": [], "related": []}
        return {"query": query, "answer": "", "citations": [], "related": []}


# ---------------------------------------------------------------------------
# Data Structures
# ---------------------------------------------------------------------------

@dataclass
class SubQuestionResult:
    question: str
    answer: str
    citations: list[str]
    related_questions: list[str]
    elapsed: float = 0.0


@dataclass
class ResearchReport:
    query: str
    mode: str
    started: str = field(default_factory=now_ist_iso)
    finished: str | None = None
    sub_questions: list[dict] = field(default_factory=list)
    synthesis: str = ""
    sources_cited: list[str] = field(default_factory=list)
    output_file: str | None = None


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

def log(msg: str) -> None:
    ts = now_ist_time()
    print(f"[{ts}] {msg}", flush=True)


# ---------------------------------------------------------------------------
# Sub-Question Decomposition
# ---------------------------------------------------------------------------

def decompose_query(query: str, mode: str = "deep") -> list[str]:
    """Decompose a research query into sub-questions."""
    max_questions = {"quick": 3, "deep": 6, "exhaustive": 12}.get(mode, 6)

    sub_questions = [query]
    q = query.lower()

    if " vs " in q or " versus " in q:
        parts = query.split(" vs ") if " vs " in q else query.split(" versus ")
        if len(parts) == 2:
            a, b = parts[0].strip(), parts[1].strip()
            sub_questions.extend([
                f"What are the advantages of {a} over {b}?",
                f"What are the disadvantages of {a} compared to {b}?",
                f"Production use cases of {a} vs {b}",
                f"Performance benchmarks: {a} vs {b}",
                f"Community adoption and ecosystem: {a} vs {b}",
                f"Which is better for production ML in 2026: {a} or {b}?",
            ])
    elif any(w in q for w in ["security", "vulnerability", "exploit"]):
        sub_questions.extend([
            f"Latest security vulnerabilities in {query}",
            f"Best practices for {query}",
            f"Real-world incidents related to {query}",
            f"OWASP guidelines for {query}",
            f"Tools and frameworks for {query}",
            f"How to audit and harden against {query}",
        ])
    elif any(w in q for w in ["performance", "optimization", "speed"]):
        sub_questions.extend([
            f"Benchmark results for {query}",
            f"Optimization techniques for {query}",
            f"Common bottlenecks in {query}",
            f"Production performance data for {query}",
            f"Tools for measuring {query}",
        ])
    elif any(w in q for w in ["architecture", "design pattern", "framework"]):
        sub_questions.extend([
            f"Architecture patterns for {query}",
            f"Case studies of {query}",
            f"Scalability considerations for {query}",
            f"Trade-offs in {query}",
            f"Production examples of {query}",
        ])
    else:
        sub_questions.extend([
            f"Latest developments in {query} 2026",
            f"Best practices for {query}",
            f"Common pitfalls in {query}",
            f"Production examples of {query}",
            f"Tools and frameworks for {query}",
            f"How to implement {query} in production",
        ])

    return sub_questions[:max_questions]


# ---------------------------------------------------------------------------
# Synthesis
# ---------------------------------------------------------------------------

def synthesize_report(query: str, results: list[SubQuestionResult]) -> str:
    """Synthesize research results into a comprehensive cited report."""
    lines = [
        f"# Deep Research Report: {query}",
        "",
        f"**Generated:** {now_ist_iso()}",
        "**Mode:** Exhaustive",
        f"**Sub-questions researched:** {len(results)}",
        f"**Total sources cited:** {sum(len(r.citations) for r in results)}",
        "",
        "---",
        "",
    ]

    for i, r in enumerate(results, 1):
        lines.append(f"## {i}. {r.question}")
        lines.append("")
        if r.answer:
            lines.append(r.answer)
            lines.append("")
        if r.citations:
            lines.append("**Sources:**")
            for c in r.citations:
                lines.append(f"- {c}")
            lines.append("")
        if r.related_questions:
            lines.append("**Related questions:**")
            for rq in r.related_questions:
                lines.append(f"- {rq}")
            lines.append("")
        lines.append("---")
        lines.append("")

    # Source list
    all_citations = []
    for r in results:
        all_citations.extend(r.citations)
    unique = list(dict.fromkeys(all_citations))  # dedupe, preserve order

    if unique:
        lines.append("## All Sources")
        lines.append("")
        for c in unique:
            lines.append(f"- {c}")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Main Pipeline
# ---------------------------------------------------------------------------

def run_research(query: str, mode: str = "deep",
                 output_file: str | None = None) -> ResearchReport:
    """Run the full deep research pipeline."""
    report = ResearchReport(query=query, mode=mode)

    log(f"{'='*60}")
    log(f"DEEP RESEARCH (MCP-powered) — Mode: {mode}")
    log(f"{'='*60}")
    log(f"Query: {query}")

    total_start = time.time()

    # Phase 1: Connect to MCP
    log(f"\n{'─'*40}")
    log("PHASE 1: Connecting to Pieces MCP...")
    client = MCPClient()
    if not client.connect():
        log("  ERROR: Could not connect to MCP server")
        return report
    if not client.initialize():
        log("  ERROR: Could not initialize MCP session")
        return report
    log("  ✓ Connected to Pieces MCP")

    # Phase 2: Decompose
    log(f"\n{'─'*40}")
    log("PHASE 2: Decomposing query...")
    sub_questions = decompose_query(query, mode)
    for i, sq in enumerate(sub_questions, 1):
        log(f"  {i}. {sq}")

    # Phase 3: Search each sub-question
    log(f"\n{'─'*40}")
    log(f"PHASE 3: Searching {len(sub_questions)} sub-questions...")
    results = []
    for i, sq in enumerate(sub_questions, 1):
        log(f"  [{i}/{len(sub_questions)}] {sq[:60]}...")
        start = time.time()
        search_result = client.web_search(sq, recency="month")
        elapsed = time.time() - start

        r = SubQuestionResult(
            question=sq,
            answer=search_result.get("answer", ""),
            citations=search_result.get("citations", []),
            related_questions=search_result.get("related", []),
            elapsed=elapsed,
        )
        results.append(r)
        log(f"    → {len(r.citations)} citations, {len(r.answer)} chars ({format_duration(elapsed)})")

    # Phase 4: Synthesize
    log(f"\n{'─'*40}")
    log("PHASE 4: Synthesizing report...")
    synthesis = synthesize_report(query, results)
    report.sub_questions = [asdict(r) for r in results]
    report.synthesis = synthesis
    report.sources_cited = list(dict.fromkeys(
        c for r in results for c in r.citations
    ))

    # Save
    RESEARCH_DIR.mkdir(parents=True, exist_ok=True)
    if output_file:
        out_path = Path(output_file)
    else:
        ts = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
        out_path = RESEARCH_DIR / f"research_{ts}.md"

    out_path.write_text(synthesis, encoding="utf-8")
    report.output_file = str(out_path)
    report.finished = now_ist_iso()

    total_elapsed = time.time() - total_start

    log(f"\n{'='*60}")
    log(f"RESEARCH COMPLETE — {format_duration(total_elapsed)}")
    log(f"{'='*60}")
    log(f"  Sub-questions: {len(results)}")
    log(f"  Total citations: {len(report.sources_cited)}")
    log(f"  Report: {out_path}")

    return report


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Deep Research — MCP-powered Web Research Harness"
    )
    parser.add_argument("--query", "-q", required=True, help="Research query")
    parser.add_argument("--mode", "-m", default="deep",
                        choices=["quick", "deep", "exhaustive"])
    parser.add_argument("--output", "-o", help="Output file path")
    args = parser.parse_args()

    report = run_research(args.query, args.mode, args.output)

    print(json.dumps({
        "query": report.query,
        "mode": report.mode,
        "sub_questions": len(report.sub_questions),
        "sources": len(report.sources_cited),
        "output": report.output_file,
    }, indent=2))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""memory_reconcile.py — Memory Reconciliation System (inspired by MiMo-Code)

Indexes memory files for full-text search. Based on MiMo-Code's
memory/service.ts and memory/reconcile.ts architecture.

Usage:
    python3 memory_reconcile.py --reconcile    # Index all memory files
    python3 memory_reconcile.py --search "query"  # Search memory
    python3 memory_reconcile.py --health       # Check memory health
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(os.environ.get("PROJECT_ROOT", Path.cwd()))
EVOLUTION_DIR = PROJECT_ROOT / "evolution"
MEMORY_DIR = EVOLUTION_DIR / "memory"
MEMORY_INDEX = EVOLUTION_DIR / "memory_index.json"

sys.path.insert(0, str(PROJECT_ROOT / ".opencode" / "automations"))
from timezone import now_ist_iso, now_ist_time


def log(msg: str) -> None:
    ts = now_ist_time()
    print(f"[{ts}] {msg}", flush=True)


def walk_memory_dir(root: Path) -> list[Path]:
    """Walk memory directory and collect all .md files."""
    files = []
    if not root.exists():
        return files
    for f in root.rglob("*.md"):
        files.append(f)
    return files


def extract_tokens(text: str) -> dict[str, int]:
    """Extract word frequencies from text for FTS indexing."""
    # Simple tokenization — split on whitespace and punctuation
    words = re.findall(r'\b\w+\b', text.lower())
    freq = {}
    for w in words:
        if len(w) > 2:  # Skip tiny words
            freq[w] = freq.get(w, 0) + 1
    return freq


def reconcile_memory() -> dict:
    """Reconcile memory files into search index."""
    log(f"{'='*60}")
    log(f"MEMORY RECONCILIATION")
    log(f"{'='*60}")

    MEMORY_DIR.mkdir(parents=True, exist_ok=True)
    
    # Walk memory files
    files = walk_memory_dir(MEMORY_DIR)
    log(f"  Found {len(files)} memory files")
    
    # Also walk evolution directory for run logs
    evo_files = list(EVOLUTION_DIR.glob("*.jsonl"))
    log(f"  Found {len(evo_files)} evolution logs")
    
    # Build index
    index = {
        "indexed_at": now_ist_iso(),
        "files": [],
        "total_tokens": 0,
    }
    
    for f in files:
        try:
            content = f.read_text(encoding="utf-8")
            tokens = extract_tokens(content)
            entry = {
                "path": str(f.relative_to(PROJECT_ROOT)),
                "type": "memory",
                "size": len(content),
                "tokens": len(tokens),
                "top_tokens": sorted(tokens.items(), key=lambda x: -x[1])[:20],
            }
            index["files"].append(entry)
            index["total_tokens"] += len(tokens)
        except Exception as e:
            log(f"  ⚠ Error reading {f}: {e}")
    
    # Save index
    MEMORY_INDEX.write_text(json.dumps(index, indent=2))
    log(f"  Indexed {len(index['files'])} files, {index['total_tokens']} tokens")
    log(f"  Saved to {MEMORY_INDEX}")
    
    return index


def search_memory(query: str, limit: int = 10) -> list[dict]:
    """Search memory using token matching."""
    if not MEMORY_INDEX.exists():
        reconcile_memory()
    
    index = json.loads(MEMORY_INDEX.read_text())
    query_tokens = set(extract_tokens(query).keys())
    
    results = []
    for entry in index["files"]:
        file_tokens = set(t[0] for t in entry["top_tokens"])
        overlap = len(query_tokens & file_tokens)
        if overlap > 0:
            results.append({
                "path": entry["path"],
                "score": overlap,
                "size": entry["size"],
            })
    
    results.sort(key=lambda x: -x["score"])
    return results[:limit]


def memory_health() -> dict:
    """Check memory health metrics."""
    files = walk_memory_dir(MEMORY_DIR)
    
    total_size = sum(f.stat().st_size for f in files if f.exists())
    total_files = len(files)
    
    # Check for large files (>10KB)
    large_files = [f for f in files if f.exists() and f.stat().st_size > 10240]
    
    # Check for empty files
    empty_files = [f for f in files if f.exists() and f.stat().st_size == 0]
    
    return {
        "total_files": total_files,
        "total_size_kb": round(total_size / 1024, 1),
        "large_files": len(large_files),
        "empty_files": len(empty_files),
        "healthy": len(large_files) == 0 and len(empty_files) == 0,
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Memory Reconciliation")
    parser.add_argument("--reconcile", action="store_true", help="Reconcile memory")
    parser.add_argument("--search", type=str, help="Search memory")
    parser.add_argument("--health", action="store_true", help="Check health")
    args = parser.parse_args()
    
    if args.reconcile:
        reconcile_memory()
    elif args.search:
        results = search_memory(args.search)
        for r in results:
            print(f"  {r['score']} {r['path']} ({r['size']} bytes)")
    elif args.health:
        h = memory_health()
        print(f"  Files: {h['total_files']}")
        print(f"  Size: {h['total_size_kb']} KB")
        print(f"  Large: {h['large_files']}")
        print(f"  Empty: {h['empty_files']}")
        print(f"  Healthy: {h['healthy']}")
    else:
        reconcile_memory()


if __name__ == "__main__":
    main()

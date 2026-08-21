#!/usr/bin/env python3
"""Performance analysis harness — analyzes prompts for performance concerns and optimization strategies."""

import json
import re
import sys
from pathlib import Path

PERF_PATTERNS = {
    "load_time": ["load time", "slow", "latency", "response time", "ttfb", "startup", "boot"],
    "throughput": ["throughput", "rps", "requests per second", "concurrent", "parallel", "qps"],
    "memory": ["memory", "leak", "heap", "gc", "garbage", "allocation", "oom", "out of memory"],
    "cpu": ["cpu", "processor", "computation", "heavy", "intensive", "optimize"],
    "database": ["query", "index", "n+1", "slow query", "connection pool", "read replica"],
    "caching": ["cache", "redis", "memcached", "ttl", "cache miss", "invalidation"],
    "network": ["network", "bandwidth", "round trip", "serialize", "payload", "compression"],
    "rendering": ["render", "fps", "frame", "repaint", "reflow", "virtual dom"],
    "bundle_size": ["bundle", "size", "tree shake", "code split", "lazy load", "chunk"],
    "profiling": ["profile", "benchmark", "bottleneck", "hotspot", "trace", "flamegraph"],
}


PERF_STRATEGIES = {
    "load_time": "Profile startup. Use lazy initialization. Consider warm-up strategies. Optimize critical path.",
    "throughput": "Use connection pooling. Batch operations. Implement backpressure. Consider async/event-driven.",
    "memory": "Profile with heap snapshots. Fix reference cycles. Use object pooling. Monitor GC pressure.",
    "cpu": "Profile hotspots. Optimize algorithms. Use caching. Consider memoization for pure functions.",
    "database": "Add missing indexes. Use query analysis tools. Implement N+1 detection. Consider denormalization.",
    "caching": "Add multi-level caching. Use write-through/write-behind. Monitor hit rates. Set appropriate TTLs.",
    "network": "Enable compression. Batch requests. Use keep-alive. Consider HTTP/2 multiplexing.",
    "rendering": "Use virtual scrolling. Batch DOM updates. Debounce/resize handlers. Use CSS containment.",
    "bundle_size": "Analyze with bundle analyzer. Tree-shake unused exports. Code-split by route. Lazy load heavy deps.",
    "profiling": "Profile before optimizing. Measure with realistic workloads. Focus on p95/p99 latency.",
}


def read_prompt(file_path: str) -> str:
    try:
        return Path(file_path).read_text()
    except Exception:
        return ""


def analyze_prompt(prompt: str) -> dict:
    prompt_lower = prompt.lower()
    findings = []
    strategies = []

    for category, keywords in PERF_PATTERNS.items():
        matches = [kw for kw in keywords if kw in prompt_lower]
        if matches:
            findings.append({"category": category, "matched_keywords": matches})

    if not findings:
        findings.append({"category": "general", "matched_keywords": ["performance review"]})

    for finding in findings:
        cat = finding["category"]
        if cat in PERF_STRATEGIES:
            strategies.append({"category": cat, "strategy": PERF_STRATEGIES[cat]})

    return {
        "analysis_type": "performance",
        "findings_count": len(findings),
        "findings": findings,
        "strategies": strategies,
        "prompt_length": len(prompt),
    }


def main():
    prompt_file = None
    for i, arg in enumerate(sys.argv):
        if arg == "--prompt-file" and i + 1 < len(sys.argv):
            prompt_file = sys.argv[i + 1]
            break

    prompt = read_prompt(prompt_file) if prompt_file else ""
    if not prompt:
        print(json.dumps({"status": "skipped", "reason": "No prompt provided"}))
        sys.exit(0)

    result = analyze_prompt(prompt)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()

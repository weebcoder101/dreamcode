#!/usr/bin/env python3
"""Python analysis harness — analyzes prompts for Python-specific best practices and patterns."""

import json
import re
import sys
from pathlib import Path

PYTHON_PATTERNS = {
    "typing": ["type hint", "typing", "type annotation", "mypy", "pyright", "typeguard", "TypeVar"],
    "async": ["async", "await", "asyncio", "coroutine", "event loop", "aiohttp"],
    "testing_py": ["pytest", "unittest", "mock", "fixture", "coverage", "parametrize"],
    "packaging": ["setup.py", "pyproject.toml", "setup.cfg", "pip", "poetry", "hatch", "pdm"],
    "linting": ["ruff", "flake8", "pylint", "black", "isort", "pre-commit"],
    "performance_py": ["performance", "slow", "optimize", "profiling", "cProfile", "numba", "cython"],
    "error_handling_py": ["exception", "try", "except", "finally", "context manager", "with"],
    "data_classes": ["dataclass", "namedtuple", "pydantic", "attrs", "msgspec"],
    "patterns_py": ["singleton", "factory", "decorator", "metaclass", "descriptor", "mixin"],
    "compatibility": ["python 2", "python 3", "deprecated", "migration", "compat", "__future__"],
}

PYTHON_BEST_PRACTICES = {
    "typing": "Use type hints for all public APIs. Enable strict mypy. Use Protocols for duck typing.",
    "async": "Use asyncio for I/O-bound tasks. Prefer anyio for library code. Avoid mixing sync/async.",
    "testing_py": "Use pytest. Use fixtures for setup. Parametrize tests. Mock external services.",
    "packaging": "Use pyproject.toml. Set python_requires. Exclude tests from distribution.",
    "linting": "Use Ruff for linting and formatting. Run in CI. Use pre-commit hooks.",
    "performance_py": "Profile before optimizing. Use __slots__ for hot classes. Leverage built-in functions.",
    "error_handling_py": "Use context managers for resource cleanup. Raise specific exceptions. Never bare except.",
    "data_classes": "Use dataclasses or pydantic for data containers. Use frozen=True for immutability.",
    "patterns_py": "Prefer composition over inheritance. Use ABCs for interfaces. Avoid metaclasses if possible.",
    "compatibility": "Target Python 3.10+. Use `from __future__ import annotations` for PEP 604 syntax.",
}


def read_prompt(file_path: str) -> str:
    try:
        return Path(file_path).read_text()
    except Exception:
        return ""


def analyze_prompt(prompt: str) -> dict:
    prompt_lower = prompt.lower()
    findings = []
    practices = []

    for category, keywords in PYTHON_PATTERNS.items():
        matches = [kw for kw in keywords if kw in prompt_lower]
        if matches:
            findings.append({"category": category, "matched_keywords": matches})

    if not findings:
        findings.append({"category": "general", "matched_keywords": ["python review"]})

    for finding in findings:
        cat = finding["category"]
        if cat in PYTHON_BEST_PRACTICES:
            practices.append({"category": cat, "practice": PYTHON_BEST_PRACTICES[cat]})

    return {
        "analysis_type": "python",
        "findings_count": len(findings),
        "findings": findings,
        "best_practices": practices,
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

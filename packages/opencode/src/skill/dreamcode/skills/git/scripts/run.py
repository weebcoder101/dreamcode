#!/usr/bin/env python3
"""Git analysis harness — analyzes prompts for Git workflow concerns and VCS best practices."""

import json
import re
import sys
from pathlib import Path

GIT_PATTERNS = {
    "branching": ["branch", "main", "master", "develop", "feature", "release", "hotfix", "git flow"],
    "merging": ["merge", "rebase", "conflict", "squash", "fast-forward", "cherry-pick"],
    "commits": ["commit", "message", "conventional commit", "semantic commit", "atomic"],
    "history": ["history", "log", "blame", "revert", "reset", "reflog", "amend"],
    "collaboration": ["pull request", "pr", "code review", "approve", "review", "feedback"],
    "remotes": ["remote", "origin", "upstream", "push", "pull", "fetch", "clone", "fork"],
    "stashing": ["stash", "wip", "work in progress", "shelve"],
    "ci_git": ["ci", "pipeline", "hook", "pre-commit", "commit-msg", "githook"],
    "tags": ["tag", "semver", "version", "release", "changelog"],
    "bisect": ["bisect", "regression", "introduced", "first bad", "break"],
}

GIT_BEST_PRACTICES = {
    "branching": "Use trunk-based development with short-lived feature branches. Avoid long-running branches.",
    "merging": "Rebase feature branches onto main. Squash merge to main. Resolve conflicts promptly.",
    "commits": "Atomic commits: one logical change per commit. Use conventional commits (feat:, fix:, chore:).",
    "history": "Keep history clean. Use interactive rebase before PR. Never rebase shared branches.",
    "collaboration": "Small, focused PRs (<400 lines). Request reviews early. Address feedback quickly.",
    "remotes": "Fork and PR for external contributors. Use protected branches for main.",
    "stashing": "Stash frequently for context switching. Write descriptive stash messages.",
    "ci_git": "Run CI on every push. Use pre-commit hooks for formatting and linting.",
    "tags": "Use semantic versioning. Tag releases. Auto-generate changelog from conventional commits.",
    "bisect": "Use git bisect to find regressions. Write good commits so bisect is effective.",
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

    for category, keywords in GIT_PATTERNS.items():
        matches = [kw for kw in keywords if kw in prompt_lower]
        if matches:
            findings.append({"category": category, "matched_keywords": matches})

    if not findings:
        findings.append({"category": "general", "matched_keywords": ["git workflow review"]})

    for finding in findings:
        cat = finding["category"]
        if cat in GIT_BEST_PRACTICES:
            practices.append({"category": cat, "practice": GIT_BEST_PRACTICES[cat]})

    return {
        "analysis_type": "git",
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

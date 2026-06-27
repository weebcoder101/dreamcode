#!/usr/bin/env python3
"""
Prompt Classifier — Auto-detects which chains to run for a given prompt.

Analyzes the user's prompt and returns the exact chain execution order.
"""

import json
import re
from pathlib import Path

# ---------------------------------------------------------------------------
# Task Detection Rules
# ---------------------------------------------------------------------------

PATTERN_RULES = [
    # Code patterns
    (r'\b(fix|bug|error|issue|crash|broken)\b', "debugging", "high"),
    (r'\b(refactor|restructure|reorganize|cleanup|clean up)\b', "refactoring", "medium"),
    (r'\b(test|tests|testing|coverage|assert|expect)\b', "testing", "medium"),
    (r'\b(security|auth|token|secret|vulnerability|hack)\b', "security", "high"),
    (r'\b(performance|slow|optimize|speed|fast|latency)\b', "performance", "medium"),
    (r'\b(deploy|docker|ci|cd|pipeline|build|release)\b', "devops", "medium"),
    (r'\b(git|commit|branch|merge|pr|pull request)\b', "git", "low"),
    (r'\b(api|endpoint|route|rest|graphql)\b', "api", "medium"),
    (r'\b(python|django|flask|fastapi)\b', "python", "low"),
    (r'\b(react|jsx|tsx|component|hooks?)\b', "react", "low"),
    (r'\b(frontend|ui|css|tailwind|style)\b', "frontend", "low"),
    (r'\b(quantum|qaoa|qae|qubit)\b', "quantum", "medium"),
    (r'\b(data|pandas|numpy|analysis|visualization)\b', "data", "medium"),

    # Planning patterns
    (r'\b(plan|planning|roadmap|sprint|backlog)\b', "planning", "medium"),
    (r'\b(architect|architecture|design|pattern)\b', "architecture", "high"),
    (r'\b(product|feature|user|requirement)\b', "product", "medium"),

    # Documentation patterns
    (r'\b(document|documentation|readme|doc|docs)\b', "documentation", "low"),
    (r'\b(explain|describe|how does|what is)\b', "communication", "low"),

    # Research patterns
    (r'\b(research|investigate|explore|analyze|study)\b', "research", "medium"),
    (r'\b(onboard|setup|getting started|orient)\b', "onboarding", "low"),

    # Automation patterns
    (r'\b(automate|automation|pipeline|workflow)\b', "automation", "medium"),

    # Innovation patterns
    (r'\b(innovate|innovation|breakthrough|novel|creative)\b', "breakthrough-overdrive-innovation", "high"),

    # NEURO patterns (complex analysis)
    (r'\b(review|audit|analyze|examine|inspect)\b', "neuro", "high"),
    (r'\b(improve|enhance|optimize|better)\b', "neuro", "medium"),
]


def classify_prompt(prompt: str) -> dict:
    """Classify a prompt and determine which chains to run."""
    prompt_lower = prompt.lower()

    detected_tasks = []
    for pattern, task_type, priority in PATTERN_RULES:
        if re.search(pattern, prompt_lower):
            detected_tasks.append({
                "task_type": task_type,
                "priority": priority,
                "pattern": pattern,
            })

    # Deduplicate by task_type (keep highest priority)
    seen = {}
    for task in detected_tasks:
        tt = task["task_type"]
        if tt not in seen or _priority_rank(task["priority"]) > _priority_rank(seen[tt]["priority"]):
            seen[tt] = task

    tasks = list(seen.values())

    # Determine complexity
    complexity = "low"
    if len(tasks) > 3:
        complexity = "high"
    elif len(tasks) > 1:
        complexity = "medium"

    # Build chain
    chain = build_chain(tasks, complexity)

    return {
        "prompt": prompt[:100],
        "detected_tasks": [t["task_type"] for t in tasks],
        "complexity": complexity,
        "chain": chain,
        "primary_task": tasks[0]["task_type"] if tasks else "general",
    }


def _priority_rank(priority: str) -> int:
    return {"high": 3, "medium": 2, "low": 1}.get(priority, 0)


def build_chain(tasks: list[dict], complexity: str) -> list[str]:
    """Build the execution chain based on detected tasks."""
    # Core chain (always runs)
    chain = [
        "context-compactor",
        "exhaustive-crosscheck",
    ]

    # Task-specific additions
    task_chain_map = {
        "debugging": ["neuro", "debugging", "code-hardener", "testing"],
        "refactoring": ["neuro", "refactoring", "code-hardener", "lint-fixer"],
        "testing": ["neuro", "testing", "quality"],
        "security": ["neuro", "security", "code-hardener"],
        "performance": ["neuro", "performance", "code-hardener"],
        "devops": ["neuro", "devops", "security"],
        "git": ["git", "quality"],
        "api": ["neuro", "api", "security"],
        "python": ["neuro", "python", "quality"],
        "react": ["neuro", "react", "quality"],
        "frontend": ["neuro", "frontend", "quality"],
        "quantum": ["neuro", "quantum", "performance"],
        "data": ["neuro", "data", "quality"],
        "planning": ["neuro", "planning", "architecture"],
        "architecture": ["neuro", "architecture", "code-hardener"],
        "product": ["neuro", "product", "planning"],
        "documentation": ["neuro", "documentation", "communication"],
        "communication": ["neuro", "communication"],
        "research": ["neuro", "research", "documentation"],
        "onboarding": ["neuro", "onboarding", "documentation"],
        "automation": ["neuro", "automation", "quality"],
        "breakthrough-overdrive-innovation": ["neuro", "breakthrough-overdrive-innovation", "code-hardener"],
        "neuro": ["neuro", "model-router", "code-hardener"],
    }

    # Add task-specific chains
    for task in tasks:
        tt = task["task_type"]
        if tt in task_chain_map:
            for skill in task_chain_map[tt]:
                if skill not in chain:
                    chain.append(skill)

    # Add model-router if neuro is in chain
    if "neuro" in chain and "model-router" not in chain:
        chain.append("model-router")

    # Always end with these
    for skill in ["lint-fixer", "pieces-ltm", "automated-learning"]:
        if skill not in chain:
            chain.append(skill)

    return chain


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Prompt Classifier")
    parser.add_argument("--prompt", default=None, help="User prompt to classify")
    parser.add_argument("--prompt-file", default=None, help="Read prompt from file")
    parser.add_argument("--json", action="store_true", help="JSON output")
    args = parser.parse_args()

    if args.prompt_file:
        prompt = Path(args.prompt_file).read_text().strip()
    elif args.prompt:
        prompt = args.prompt
    else:
        parser.error("Either --prompt or --prompt-file is required")

    result = classify_prompt(prompt)

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(f"Detected tasks: {', '.join(result['detected_tasks'])}")
        print(f"Complexity: {result['complexity']}")
        print(f"Primary: {result['primary_task']}")
        print(f"Chain ({len(result['chain'])} skills):")
        for i, skill in enumerate(result["chain"]):
            prefix = "→" if i < len(result["chain"]) - 1 else "✓"
            print(f"  {prefix} {skill}")

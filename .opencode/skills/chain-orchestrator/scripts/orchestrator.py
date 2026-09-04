#!/usr/bin/env python3
"""
Chain Orchestrator — Manages skill chain execution order.

Reads all SKILL.md files, builds the chain DAG, validates dependencies,
and outputs the correct execution order for any prompt.
"""

import json
import re
from pathlib import Path

SKILLS_DIR = Path.cwd() / ".opencode" / "skills"


# ---------------------------------------------------------------------------
# Chain DAG Builder
# ---------------------------------------------------------------------------

def parse_skill_chains() -> dict[str, list[str]]:
    """Parse all SKILL.md files and extract chains_with declarations."""
    chains = {}

    for skill_dir in sorted(SKILLS_DIR.iterdir()):
        if not skill_dir.is_dir():
            continue
        skill_md = skill_dir / "SKILL.md"
        if not skill_md.exists():
            continue

        content = skill_md.read_text()

        # Try inline array format: chains_with: [a, b, c]
        match = re.search(r'chains_with:\s*\[(.*?)\]', content, re.DOTALL)
        if match:
            raw = match.group(1).strip()
            if raw:
                chain_list = [c.strip().strip('"').strip("'") for c in raw.split(",")]
                chains[skill_dir.name] = chain_list
            else:
                chains[skill_dir.name] = []
            continue

        # Try YAML list format:
        # chains_with:
        #   - item1
        #   - item2
        match = re.search(r'chains_with:\s*\n((?:\s*-\s*.+\n?)+)', content)
        if match:
            raw_lines = match.group(1).strip().split("\n")
            chain_list = []
            for line in raw_lines:
                # Stop at YAML separator
                stripped = line.strip()
                if stripped == "---":
                    break
                item_match = re.match(r'\s*-\s*(.+)', line)
                if item_match:
                    item = item_match.group(1).strip().strip('"').strip("'")
                    if item and item != "---":
                        chain_list.append(item)
            chains[skill_dir.name] = chain_list
            continue

        # No chains_with found
        chains[skill_dir.name] = []

    return chains


def build_dag(chains: dict[str, list[str]]) -> dict[str, dict]:
    """Build a DAG from chain declarations."""
    dag = {}

    for skill_id, chain_to in chains.items():
        if skill_id not in dag:
            dag[skill_id] = {"chains_to": [], "chained_by": [], "depth": 0}
        dag[skill_id]["chains_to"] = chain_to

        for target in chain_to:
            if target not in dag:
                dag[target] = {"chains_to": [], "chained_by": [], "depth": 0}
            dag[target]["chained_by"].append(skill_id)

    # Calculate depths (longest path to terminal)
    def calc_depth(skill_id, visited=None):
        if visited is None:
            visited = set()
        if skill_id in visited:
            return 0
        visited.add(skill_id)

        if skill_id not in dag:
            return 0

        chain_to = dag[skill_id]["chains_to"]
        if not chain_to:
            return 0

        return 1 + max(calc_depth(s, visited.copy()) for s in chain_to if s in dag)

    for skill_id in dag:
        dag[skill_id]["depth"] = calc_depth(skill_id)

    return dag


def get_execution_order(dag: dict[str, dict]) -> list[list[str]]:
    """Get topological execution order (levels)."""
    # Find roots (not chained by anyone)
    roots = [s for s, d in dag.items() if not d["chained_by"]]

    # BFS level ordering
    levels = []
    visited = set()

    current_level = roots
    while current_level:
        levels.append(sorted(current_level))
        visited.update(current_level)

        next_level = []
        for skill in current_level:
            for target in dag.get(skill, {}).get("chains_to", []):
                if target not in visited:
                    # Check if all dependents are visited
                    dep = dag.get(target, {})
                    all_deps_visited = all(
                        d in visited for d in dep["chained_by"]
                    )
                    if all_deps_visited:
                        next_level.append(target)

        current_level = list(set(next_level))

    return levels


def get_chain_for_task(task_type: str) -> list[str]:
    """Get the chain execution order for a specific task type."""
    chains = parse_skill_chains()
    dag = build_dag(chains)

    # Core chain that ALWAYS runs
    core_chain = [
        "context-compactor",
        "exhaustive-crosscheck",
        "neuro",
        "model-router",
        "code-hardener",
        "lint-fixer",
        "pieces-ltm",
        "automated-learning",
    ]

    # Task-specific additions
    task_additions = {
        "code_review": ["security", "quality", "testing"],
        "security_review": ["security", "quality"],
        "architecture": ["architecture", "planning"],
        "debugging": ["debugging", "testing"],
        "performance": ["performance", "testing"],
        "documentation": ["documentation", "communication"],
        "planning": ["planning", "product"],
        "refactoring": ["refactoring", "quality"],
        "testing": ["testing", "quality"],
        "devops": ["devops", "security", "quality"],
        "frontend": ["frontend", "react", "quality"],
        "python": ["python", "quality"],
        "api": ["api", "security", "testing"],
        "git": ["git", "quality"],
        "data": ["data", "quality"],
        "quantum": ["quantum", "performance"],
        "product": ["product", "planning"],
        "communication": ["communication", "documentation"],
        "onboarding": ["onboarding", "documentation"],
        "automation": ["automation", "quality"],
        "research": ["deep-research", "research", "documentation"],
    }

    additions = task_additions.get(task_type, [])

    # Build full chain
    full_chain = []
    seen = set()

    for skill in core_chain:
        if skill not in seen and skill in chains:
            full_chain.append(skill)
            seen.add(skill)

    for skill in additions:
        if skill not in seen and skill in chains:
            full_chain.append(skill)
            seen.add(skill)

    return full_chain


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def validate_chains() -> dict:
    """Validate all chain declarations."""
    chains = parse_skill_chains()
    dag = build_dag(chains)

    issues = []

    # Check for missing chain declarations
    for skill_id in chains:
        if not chains[skill_id] and skill_id != "automated-learning":
            issues.append(f"WARN: {skill_id} has no chains_with")

    # Check for invalid targets
    for skill_id, chain_to in chains.items():
        for target in chain_to:
            if target not in chains:
                issues.append(f"ERROR: {skill_id} chains to non-existent skill: {target}")

    # Check for cycles
    visited = set()
    path = set()

    def has_cycle(skill_id):
        if skill_id in path:
            return True
        if skill_id in visited:
            return False
        visited.add(skill_id)
        path.add(skill_id)
        for target in chains.get(skill_id, []):
            if has_cycle(target):
                return True
        path.remove(skill_id)
        return False

    for skill_id in chains:
        if has_cycle(skill_id):
            issues.append(f"ERROR: Cycle detected involving {skill_id}")

    return {
        "total_skills": len(chains),
        "skills_with_chains": sum(1 for c in chains.values() if c),
        "skills_without_chains": sum(1 for c in chains.values() if not c),
        "total_edges": sum(len(c) for c in chains.values()),
        "issues": issues,
        "dag": {k: {"chains_to": v, "chained_by": dag[k]["chained_by"], "depth": dag[k]["depth"]}
                for k, v in chains.items()},
    }


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------

def print_dashboard():
    """Print ecosystem health dashboard."""
    validation = validate_chains()
    chains = parse_skill_chains()
    dag = build_dag(chains)
    levels = get_execution_order(dag)

    print("=" * 60)
    print("ECOSYSTEM HEALTH DASHBOARD")
    print("=" * 60)
    print()
    print(f"Total skills: {validation['total_skills']}")
    print(f"Skills with chains: {validation['skills_with_chains']}")
    print(f"Skills without chains: {validation['skills_without_chains']}")
    print(f"Total chain edges: {validation['total_edges']}")
    print()

    if validation["issues"]:
        print("ISSUES:")
        for issue in validation["issues"]:
            print(f"  {issue}")
    else:
        print("No issues found.")
    print()

    print("EXECUTION LEVELS (topological order):")
    for i, level in enumerate(levels):
        print(f"  Level {i}: {', '.join(level)}")
    print()

    print("CORE CHAIN (always runs):")
    core = get_chain_for_task("code_review")
    for i, skill in enumerate(core):
        prefix = "→" if i < len(core) - 1 else "✓"
        print(f"  {prefix} {skill}")
    print()

    print("CHAIN DEPTHS:")
    for skill_id, data in sorted(dag.items(), key=lambda x: x[1]["depth"], reverse=True)[:10]:
        print(f"  {skill_id}: depth {data['depth']}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Chain Orchestrator")
    parser.add_argument("--dashboard", action="store_true", help="Print dashboard")
    parser.add_argument("--validate", action="store_true", help="Validate chains")
    parser.add_argument("--order", help="Get execution order for task type")
    parser.add_argument("--json", action="store_true", help="JSON output")
    args = parser.parse_args()

    if args.dashboard:
        print_dashboard()
    elif args.validate:
        result = validate_chains()
        if args.json:
            print(json.dumps(result, indent=2))
        else:
            print(f"Skills: {result['total_skills']}")
            print(f"With chains: {result['skills_with_chains']}")
            print(f"Without chains: {result['skills_without_chains']}")
            print(f"Edges: {result['total_edges']}")
            if result["issues"]:
                print("Issues:")
                for issue in result["issues"]:
                    print(f"  {issue}")
    elif args.order:
        chain = get_chain_for_task(args.order)
        if args.json:
            print(json.dumps(chain, indent=2))
        else:
            print(f"Chain for {args.order}:")
            for i, skill in enumerate(chain):
                prefix = "→" if i < len(chain) - 1 else "✓"
                print(f"  {prefix} {skill}")
    else:
        parser.print_help()

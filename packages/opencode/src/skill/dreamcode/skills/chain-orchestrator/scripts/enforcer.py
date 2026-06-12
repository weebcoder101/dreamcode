#!/usr/bin/env python3
"""
Chain Enforcement — Validates that required chains were executed.

Tracks which skills ran and validates that dependent chains
were properly executed. Logs violations.
"""

import json
from datetime import UTC, datetime
from pathlib import Path

PROJECT_ROOT = Path("/home/ronya/Pilot-Project")
LOG_PATH = PROJECT_ROOT / "evolution" / "chain_execution.jsonl"


# ---------------------------------------------------------------------------
# Chain Dependencies (from orchestrator)
# ---------------------------------------------------------------------------

CHAIN_DEPENDENCIES = {
    "context-compactor": [],
    "exhaustive-crosscheck": ["context-compactor"],
    "neuro": ["exhaustive-crosscheck"],
    "model-router": ["neuro"],
    "code-hardener": ["neuro"],
    "lint-fixer": ["code-hardener"],
    "pieces-ltm": ["lint-fixer"],
    "automated-learning": ["pieces-ltm", "lint-fixer"],
    "quality": ["lint-fixer"],
    "security": ["code-hardener"],
    "testing": ["lint-fixer"],
    "debugging": ["code-hardener"],
    "performance": ["code-hardener"],
    "architecture": ["neuro"],
    "planning": ["architecture"],
    "python": ["quality"],
    "frontend": ["quality"],
    "react": ["quality"],
    "api": ["security"],
    "git": ["quality"],
    "devops": ["security"],
    "data": ["quality"],
    "quantum": ["performance"],
    "product": ["planning"],
    "research": ["documentation"],
    "documentation": ["communication"],
    "communication": [],
    "refactoring": ["code-hardener"],
    "onboarding": ["documentation"],
    "automation": ["quality"],
    "breakthrough-overdrive-innovation": ["neuro"],
}


# ---------------------------------------------------------------------------
# Execution Tracker
# ---------------------------------------------------------------------------

class ChainTracker:
    """Tracks which skills were executed and validates chains."""

    def __init__(self):
        self.executed: list[str] = []
        self.violations: list[dict] = []

    def record_execution(self, skill_id: str) -> None:
        """Record that a skill was executed."""
        if skill_id not in self.executed:
            self.executed.append(skill_id)

    def validate_chain(self, skill_id: str) -> dict:
        """Validate that a skill's dependencies were met."""
        deps = CHAIN_DEPENDENCIES.get(skill_id, [])
        missing = [d for d in deps if d not in self.executed]

        result = {
            "skill": skill_id,
            "required": deps,
            "missing": missing,
            "valid": len(missing) == 0,
        }

        if missing:
            self.violations.append({
                "timestamp": datetime.now(UTC).isoformat(),
                "skill": skill_id,
                "missing_dependencies": missing,
            })

        return result

    def validate_all(self) -> list[dict]:
        """Validate all skills' dependencies."""
        results = []
        for skill_id in CHAIN_DEPENDENCIES:
            result = self.validate_chain(skill_id)
            if not result["valid"]:
                results.append(result)
        return results

    def get_execution_order(self) -> list[str]:
        """Get the correct execution order for executed skills."""
        # Topological sort of executed skills
        in_degree = {s: 0 for s in self.executed}
        for skill in self.executed:
            for dep in CHAIN_DEPENDENCIES.get(skill, []):
                if dep in in_degree:
                    in_degree[skill] += 1

        queue = [s for s, d in in_degree.items() if d == 0]
        order = []

        while queue:
            queue.sort()
            skill = queue.pop(0)
            order.append(skill)
            for s in self.executed:
                if skill in CHAIN_DEPENDENCIES.get(s, []):
                    in_degree[s] -= 1
                    if in_degree[s] == 0:
                        queue.append(s)

        return order

    def log_execution(self) -> None:
        """Log execution to file."""
        LOG_PATH.parent.mkdir(parents=True, exist_ok=True)

        entry = {
            "timestamp": datetime.now(UTC).isoformat(),
            "executed_skills": self.executed,
            "execution_order": self.get_execution_order(),
            "violations": self.violations,
            "total_executed": len(self.executed),
            "total_violations": len(self.violations),
        }

        with open(LOG_PATH, "a") as f:
            f.write(json.dumps(entry) + "\n")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Chain Enforcement")
    parser.add_argument("--record", help="Record skill execution")
    parser.add_argument("--validate", action="store_true", help="Validate all chains")
    parser.add_argument("--order", action="store_true", help="Show execution order")
    parser.add_argument("--log", action="store_true", help="Log execution")
    parser.add_argument("--status", action="store_true", help="Show status")
    args = parser.parse_args()

    tracker = ChainTracker()

    if args.record:
        tracker.record_execution(args.record)
        print(f"Recorded: {args.record}")

    if args.validate:
        results = tracker.validate_all()
        if results:
            print("VIOLATIONS:")
            for r in results:
                print(f"  {r['skill']}: missing {r['missing_dependencies']}")
        else:
            print("All chains valid.")

    if args.order:
        order = tracker.get_execution_order()
        print("Execution order:")
        for i, skill in enumerate(order):
            print(f"  {i+1}. {skill}")

    if args.log:
        tracker.log_execution()
        print("Logged execution.")

    if args.status:
        print(f"Executed skills: {len(tracker.executed)}")
        print(f"Violations: {len(tracker.violations)}")

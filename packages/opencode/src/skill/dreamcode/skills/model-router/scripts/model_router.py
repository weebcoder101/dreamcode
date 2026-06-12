#!/usr/bin/env python3
"""
NEURO Model Router — Intelligent model selection with chaining.

Analyzes task context and selects optimal model combinations,
including chaining, parallel execution, and task decomposition.
"""

import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

# Add parent to path for imports
_script_dir = Path(__file__).resolve().parent
sys.path.insert(0, str(_script_dir))

from model_registry import (
    MODELS,
    ExecutionMode,
    ModelCategory,
    ModelInfo,
    get_chainable_models,
    get_decomposition,
    get_model,
    get_predefined_chain,
)


@dataclass
class TaskContext:
    """Context about the current task."""
    task_type: str
    skills: list[str]
    domain: str
    complexity: str
    language: str | None = None
    files: list[str] = field(default_factory=list)
    keywords: list[str] = field(default_factory=list)


@dataclass
class ChainStep:
    """A single step in a model chain."""
    model: ModelInfo
    execution_mode: ExecutionMode
    purpose: str
    depends_on: list[str] = field(default_factory=list)  # Model IDs this depends on


@dataclass
class ModelChain:
    """A chain of models to execute."""
    steps: list[ChainStep]
    reasoning: str
    estimated_total_tokens: int = 0
    parallel_groups: list[list[str]] = field(default_factory=list)  # Groups of model IDs that can run in parallel


@dataclass
class ModelSelection:
    """Selected models for a task (simple selection)."""
    primary: ModelInfo
    secondary: list[ModelInfo]
    reasoning: str
    estimated_tokens: int = 0


# ---------------------------------------------------------------------------
# ROUTING RULES
# ---------------------------------------------------------------------------

TASK_TYPE_TO_CATEGORIES: dict[str, list[ModelCategory]] = {
    "code_review": [ModelCategory.CODE, ModelCategory.SECURITY],
    "refactoring": [ModelCategory.CODE],
    "debugging": [ModelCategory.CODE],
    "code_generation": [ModelCategory.CODE],
    "test_writing": [ModelCategory.CODE],
    "lint_fixing": [ModelCategory.CODE],
    "security_review": [ModelCategory.SECURITY],
    "auth_review": [ModelCategory.SECURITY],
    "compliance": [ModelCategory.SECURITY, ModelCategory.LEGAL],
    "architecture": [ModelCategory.GENERAL, ModelCategory.CODE],
    "design_doc": [ModelCategory.DOCUMENT, ModelCategory.CODE],
    "adr_writing": [ModelCategory.CODE, ModelCategory.DOCUMENT],
    "sprint_planning": [ModelCategory.OPERATIONS, ModelCategory.HR],
    "task_breakdown": [ModelCategory.OPERATIONS],
    "roadmap": [ModelCategory.OPERATIONS, ModelCategory.PRODUCT],
    "documentation": [ModelCategory.DOCUMENT],
    "readme": [ModelCategory.DOCUMENT],
    "api_docs": [ModelCategory.DOCUMENT, ModelCategory.CODE],
    "data_analysis": [ModelCategory.DATA],
    "visualization": [ModelCategory.DATA],
    "reporting": [ModelCategory.DATA, ModelCategory.DOCUMENT],
    "financial_analysis": [ModelCategory.FINANCE],
    "risk_assessment": [ModelCategory.FINANCE, ModelCategory.SECURITY],
    "legal_review": [ModelCategory.LEGAL],
    "hr_task": [ModelCategory.HR],
    "marketing": [ModelCategory.MARKETING],
    "sales": [ModelCategory.SALES],
    "support": [ModelCategory.SUPPORT],
    "performance": [ModelCategory.CODE, ModelCategory.DATA],
    "optimization": [ModelCategory.CODE],
    "profiling": [ModelCategory.DATA, ModelCategory.CODE],
    "unit_testing": [ModelCategory.CODE],
    "integration_testing": [ModelCategory.CODE],
    "property_testing": [ModelCategory.CODE, ModelCategory.DATA],
    "pr_review": [ModelCategory.CODE, ModelCategory.SECURITY],
    "commit_review": [ModelCategory.CODE],
    "changelog": [ModelCategory.DOCUMENT, ModelCategory.CODE],
}

SKILL_TO_TASK_TYPE: dict[str, str] = {
    "neuro": "architecture",
    "code-hardener": "code_review",
    "lint-fixer": "lint_fixing",
    "planning": "sprint_planning",
    "architecture": "architecture",
    "quality": "code_review",
    "security": "security_review",
    "testing": "test_writing",
    "debugging": "debugging",
    "performance": "performance",
    "python": "code_generation",
    "frontend": "code_generation",
    "react": "code_generation",
    "api": "code_generation",
    "git": "pr_review",
    "devops": "code_review",
    "quantum": "data_analysis",
    "data": "data_analysis",
    "research": "documentation",
    "documentation": "documentation",
    "refactoring": "refactoring",
    "communication": "documentation",
    "product": "roadmap",
    "onboarding": "documentation",
    "exhaustive-crosscheck": "architecture",
    "automated-learning": "data_analysis",
}

DOMAIN_TO_CATEGORY: dict[str, ModelCategory] = {
    "finance": ModelCategory.FINANCE,
    "fintech": ModelCategory.FINANCE,
    "legal": ModelCategory.LEGAL,
    "compliance": ModelCategory.LEGAL,
    "hr": ModelCategory.HR,
    "hiring": ModelCategory.HR,
    "marketing": ModelCategory.MARKETING,
    "seo": ModelCategory.MARKETING,
    "sales": ModelCategory.SALES,
    "support": ModelCategory.SUPPORT,
    "customer": ModelCategory.SUPPORT,
    "data": ModelCategory.DATA,
    "analytics": ModelCategory.DATA,
    "quantum": ModelCategory.FINANCE,
    "risk": ModelCategory.FINANCE,
    "security": ModelCategory.SECURITY,
    "auth": ModelCategory.SECURITY,
}


# ---------------------------------------------------------------------------
# ROUTING ENGINE
# ---------------------------------------------------------------------------

class ModelRouter:
    """Intelligent model selection with chaining support."""

    def __init__(self):
        self.selection_history: list[ModelSelection] = []
        self.chain_history: list[ModelChain] = []

    def analyze_task(self, task_description: str, skills: list[str]) -> TaskContext:
        """Analyze task description to extract context."""
        task_lower = task_description.lower()

        # Determine task type
        task_type = "code_review"
        for skill in skills:
            if skill in SKILL_TO_TASK_TYPE:
                task_type = SKILL_TO_TASK_TYPE[skill]
                break

        # Detect domain
        domain = "general"
        for keyword, category in DOMAIN_TO_CATEGORY.items():
            if keyword in task_lower:
                domain = keyword
                break

        # Detect complexity
        complexity = "medium"
        if any(w in task_lower for w in ["simple", "quick", "fix", "typo"]):
            complexity = "low"
        elif any(w in task_lower for w in ["complex", "architecture", "refactor", "major", "critical", "full", "comprehensive"]):
            complexity = "high"

        # Detect programming language
        language = None
        lang_keywords = {
            "python": ["python", ".py", "django", "flask", "fastapi"],
            "javascript": ["javascript", ".js", "node", "express"],
            "typescript": ["typescript", ".ts", "tsx", "jsx"],
            "rust": ["rust", ".rs", "cargo"],
            "go": ["go", ".go", "golang"],
        }
        for lang, keywords in lang_keywords.items():
            if any(kw in task_lower for kw in keywords):
                language = lang
                break

        # Extract keywords
        stop_words = {"the", "a", "an", "is", "are", "was", "were", "be", "been",
                      "being", "have", "has", "had", "do", "does", "did", "will",
                      "would", "could", "should", "may", "might", "shall", "can",
                      "to", "of", "in", "for", "on", "with", "at", "by", "from",
                      "as", "into", "through", "during", "before", "after", "above",
                      "below", "between", "out", "off", "over", "under", "again",
                      "further", "then", "once", "and", "but", "or", "nor", "not"}
        words = task_lower.split()
        keywords = [w for w in words if w not in stop_words and len(w) > 2][:10]

        return TaskContext(
            task_type=task_type,
            skills=skills,
            domain=domain,
            complexity=complexity,
            language=language,
            keywords=keywords,
        )

    def select_models(self, context: TaskContext) -> ModelSelection:
        """Select optimal models (simple selection, no chaining)."""
        candidates: list[tuple[ModelInfo, float]] = []

        categories = TASK_TYPE_TO_CATEGORIES.get(context.task_type, [ModelCategory.GENERAL])

        for model_id, model in MODELS.items():
            score = 0.0

            if model.category in categories:
                score += 3.0

            for skill in context.skills:
                if skill in model.skill_affinity:
                    score += 2.0

            if context.domain != "general":
                domain_category = DOMAIN_TO_CATEGORY.get(context.domain)
                if model.category == domain_category:
                    score += 2.5

            if context.complexity == "high" and model.tier == 3:
                score += 1.5
            elif (context.complexity == "medium" and model.tier == 2) or (context.complexity == "low" and model.tier == 1):
                score += 1.0

            if context.language and context.task_type.startswith("code"):
                if context.language in model.skill_affinity:
                    score += 1.0

            for keyword in context.keywords:
                if keyword in model.name.lower() or keyword in model.description.lower():
                    score += 0.5

            if score > 0:
                candidates.append((model, score))

        candidates.sort(key=lambda x: x[1], reverse=True)

        if not candidates:
            primary = get_model("neurometric/clawpack")
            return ModelSelection(
                primary=primary,
                secondary=[],
                reasoning="No specific match found, using general-purpose ClawPack",
            )

        primary = candidates[0][0]

        secondary = []
        seen_categories = {primary.category}
        for model, score in candidates[1:10]:
            if len(secondary) >= 3:
                break
            if model.category not in seen_categories or len(secondary) < 2:
                secondary.append(model)
                seen_categories.add(model.category)

        reasoning = self._generate_reasoning(context, primary, secondary)

        selection = ModelSelection(
            primary=primary,
            secondary=secondary,
            reasoning=reasoning,
        )

        self.selection_history.append(selection)
        return selection

    def select_chain(self, context: TaskContext) -> ModelChain:
        """Select an optimal model chain with chaining and parallel execution."""
        # First, check if there's a predefined chain for this task type
        predefined_chains = self._get_relevant_chains(context)

        if predefined_chains and context.complexity == "high":
            # Use predefined chain for complex tasks
            chain = self._build_from_predefined(predefined_chains[0], context)
        else:
            # Build chain dynamically
            chain = self._build_dynamic_chain(context)

        self.chain_history.append(chain)
        return chain

    def _get_relevant_chains(self, context: TaskContext) -> list[str]:
        """Get predefined chains relevant to the task."""
        task_to_chains = {
            "code_review": ["full_code_review"],
            "security_review": ["security_audit"],
            "feature_development": ["feature_development"],
            "financial_analysis": ["financial_analysis"],
            "hr_task": ["hr_workflow"],
            "documentation": ["documentation_pipeline"],
            "data_analysis": ["data_pipeline"],
            "marketing": ["marketing_campaign"],
            "support": ["support_escalation"],
        }
        return task_to_chains.get(context.task_type, [])

    def _build_from_predefined(self, chain_name: str, context: TaskContext) -> ModelChain:
        """Build a chain from a predefined template."""
        predefined = get_predefined_chain(chain_name)
        if not predefined:
            return self._build_dynamic_chain(context)

        steps = []
        parallel_groups = []
        current_parallel_group = []

        for step_def in predefined["steps"]:
            model = get_model(step_def["model"])
            if not model:
                continue

            mode = ExecutionMode(step_def["mode"])
            step = ChainStep(
                model=model,
                execution_mode=mode,
                purpose=step_def["purpose"],
            )
            steps.append(step)

            if mode == ExecutionMode.PARALLEL:
                current_parallel_group.append(model.id)
            else:
                if current_parallel_group:
                    parallel_groups.append(current_parallel_group)
                    current_parallel_group = []

        if current_parallel_group:
            parallel_groups.append(current_parallel_group)

        reasoning = f"Predefined chain: {chain_name} — {predefined['description']}"

        return ModelChain(
            steps=steps,
            reasoning=reasoning,
            parallel_groups=parallel_groups,
        )

    def _build_dynamic_chain(self, context: TaskContext) -> ModelChain:
        """Build a chain dynamically based on task context."""
        # Select primary model
        selection = self.select_models(context)

        steps = []
        parallel_groups = []

        # Step 1: Primary model (sequential)
        primary_step = ChainStep(
            model=selection.primary,
            execution_mode=ExecutionMode.SEQUENTIAL,
            purpose=f"Primary analysis: {context.task_type}",
        )
        steps.append(primary_step)

        # Step 2: Chain from primary model
        chainable = get_chainable_models(selection.primary.id)
        if chainable:
            # Pick top 2 chainable models
            parallel_group = []
            for chain_model in chainable[:2]:
                step = ChainStep(
                    model=chain_model,
                    execution_mode=ExecutionMode.PARALLEL,
                    purpose=f"Chain from {selection.primary.name}",
                    depends_on=[selection.primary.id],
                )
                steps.append(step)
                parallel_group.append(chain_model.id)
            if parallel_group:
                parallel_groups.append(parallel_group)

        # Step 3: Secondary models (parallel)
        if selection.secondary:
            sec_parallel = []
            for sec_model in selection.secondary[:2]:
                step = ChainStep(
                    model=sec_model,
                    execution_mode=ExecutionMode.PARALLEL,
                    purpose=f"Secondary analysis: {sec_model.category.value}",
                )
                steps.append(step)
                sec_parallel.append(sec_model.id)
            if sec_parallel:
                parallel_groups.append(sec_parallel)

        # Step 4: Decomposition if high complexity
        if context.complexity == "high" and selection.primary.decomposes_to:
            decomposed = get_decomposition(selection.primary.id)
            for dec_model in decomposed:
                step = ChainStep(
                    model=dec_model,
                    execution_mode=ExecutionMode.SEQUENTIAL,
                    purpose=f"Decomposed from {selection.primary.name}",
                    depends_on=[selection.primary.id],
                )
                steps.append(step)

        reasoning = self._generate_chain_reasoning(context, steps)

        return ModelChain(
            steps=steps,
            reasoning=reasoning,
            parallel_groups=parallel_groups,
        )

    def _generate_reasoning(self, context: TaskContext, primary: ModelInfo, secondary: list[ModelInfo]) -> str:
        """Generate reasoning for simple selection."""
        parts = [
            f"Task: {context.task_type}",
            f"Complexity: {context.complexity}",
            f"Domain: {context.domain}",
        ]
        if context.language:
            parts.append(f"Language: {context.language}")
        parts.append(f"Primary: {primary.name}")
        if secondary:
            parts.append(f"Secondary: {', '.join(m.name for m in secondary)}")
        return " | ".join(parts)

    def _generate_chain_reasoning(self, context: TaskContext, steps: list[ChainStep]) -> str:
        """Generate reasoning for chain selection."""
        parts = [f"Task: {context.task_type}", f"Complexity: {context.complexity}"]

        seq_steps = [s for s in steps if s.execution_mode == ExecutionMode.SEQUENTIAL]
        par_steps = [s for s in steps if s.execution_mode == ExecutionMode.PARALLEL]

        parts.append(f"Chain: {len(seq_steps)} sequential + {len(par_steps)} parallel")
        parts.append(f"Steps: {' → '.join(s.model.name for s in seq_steps)}")

        if par_steps:
            parts.append(f"Parallel: {', '.join(s.model.name for s in par_steps)}")

        return " | ".join(parts)

    def get_execution_plan(self, chain: ModelChain) -> dict:
        """Get a structured execution plan for the chain."""
        plan = {
            "sequential": [],
            "parallel_groups": [],
        }

        for step in chain.steps:
            if step.execution_mode == ExecutionMode.SEQUENTIAL:
                plan["sequential"].append({
                    "model": step.model.id,
                    "name": step.model.name,
                    "purpose": step.purpose,
                })
            elif step.execution_mode == ExecutionMode.PARALLEL:
                # Find or create parallel group
                found_group = False
                for group in plan["parallel_groups"]:
                    if any(dep in [s["model"] for s in group.get("depends_on", [])] for dep in step.depends_on):
                        group["models"].append({
                            "model": step.model.id,
                            "name": step.model.name,
                            "purpose": step.purpose,
                        })
                        found_group = True
                        break
                if not found_group:
                    plan["parallel_groups"].append({
                        "models": [{
                            "model": step.model.id,
                            "name": step.model.name,
                            "purpose": step.purpose,
                        }],
                        "depends_on": step.depends_on,
                    })

        return plan

    def to_dict(self, chain: ModelChain) -> dict:
        """Convert chain to dictionary for serialization."""
        return {
            "steps": [
                {
                    "model": step.model.id,
                    "name": step.model.name,
                    "category": step.model.category.value,
                    "execution_mode": step.execution_mode.value,
                    "purpose": step.purpose,
                    "depends_on": step.depends_on,
                }
                for step in chain.steps
            ],
            "reasoning": chain.reasoning,
            "parallel_groups": chain.parallel_groups,
            "execution_plan": self.get_execution_plan(chain),
        }


# ---------------------------------------------------------------------------
# CLI INTERFACE
# ---------------------------------------------------------------------------

def main():
    """CLI entry point."""
    import argparse

    parser = argparse.ArgumentParser(description="NEURO Model Router")
    parser.add_argument("--task", required=True, help="Task description")
    parser.add_argument("--skills", nargs="*", default=[], help="Skills being used")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    parser.add_argument("--chain", action="store_true", help="Output chain (not simple selection)")
    args = parser.parse_args()

    router = ModelRouter()
    context = router.analyze_task(args.task, args.skills)

    if args.chain:
        chain = router.select_chain(context)
        if args.json:
            output = router.to_dict(chain)
            print(json.dumps(output, indent=2))
        else:
            print("=== Model Chain ===")
            print(f"Task: {args.task}")
            print(f"Context: {context.task_type} | {context.complexity} | {context.domain}")
            print()
            print("Steps:")
            for i, step in enumerate(chain.steps, 1):
                mode_icon = "→" if step.execution_mode == ExecutionMode.SEQUENTIAL else "∥"
                deps = f" (depends on: {', '.join(step.depends_on)})" if step.depends_on else ""
                print(f"  {i}. {mode_icon} {step.model.name} ({step.model.category.value}){deps}")
                print(f"     Purpose: {step.purpose}")
            if chain.parallel_groups:
                print()
                print("Parallel groups:")
                for i, group in enumerate(chain.parallel_groups, 1):
                    print(f"  Group {i}: {', '.join(group)}")
            print()
            print(f"Reasoning: {chain.reasoning}")
    else:
        selection = router.select_models(context)
        if args.json:
            output = {
                "primary": {
                    "id": selection.primary.id,
                    "name": selection.primary.name,
                    "category": selection.primary.category.value,
                    "tier": selection.primary.tier,
                },
                "secondary": [
                    {"id": m.id, "name": m.name, "category": m.category.value, "tier": m.tier}
                    for m in selection.secondary
                ],
                "reasoning": selection.reasoning,
            }
            print(json.dumps(output, indent=2))
        else:
            print("=== Model Selection ===")
            print(f"Task: {args.task}")
            print(f"Context: {context.task_type} | {context.complexity} | {context.domain}")
            if context.language:
                print(f"Language: {context.language}")
            print()
            print(f"Primary: {selection.primary.name}")
            print(f"  ID: {selection.primary.id}")
            print(f"  Category: {selection.primary.category.value}")
            print(f"  Tier: {selection.primary.tier}")
            if selection.secondary:
                print()
                print("Secondary:")
                for m in selection.secondary:
                    print(f"  - {m.name} ({m.category.value}, tier {m.tier})")
            print()
            print(f"Reasoning: {selection.reasoning}")


if __name__ == "__main__":
    main()

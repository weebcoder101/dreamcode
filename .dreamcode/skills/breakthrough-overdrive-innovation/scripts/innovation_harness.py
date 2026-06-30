#!/usr/bin/env python3
"""
Breakthrough-Overdrive-Innovation — 6-Phase Dream Cycle Engine.

A structured thinking harness that simulates a full innovation cycle:
1. CONTEXT_ABSORPTION — Understand and restate the problem
2. ASSUMPTION_SURFACING — Identify hidden assumptions and constraints
3. CROSS_DOMAIN_ANALOGY — Draw analogies from other fields
4. FIRST_PRINCIPLES — Derive from fundamental truths
5. SYNTHESIS — Combine insights into coherent direction
6. SELF_CRITIQUE — Challenge and refine the result

Each phase produces structured output. The full cycle is run
end-to-end to generate breakthrough innovation analysis.
"""

import json
import math
import re
import sys
from datetime import UTC, datetime
from pathlib import Path

# ---------------------------------------------------------------------------
# Phase implementations
# ---------------------------------------------------------------------------

INNOVATION_SIGNALS = {
    "paradigm_shift": [
        r"\b(unified|universal|fundamental|first.principles|axiom)\b",
        r"\b(derive|prove|derive|theorem)\b",
    ],
    "novel_approach": [
        r"\b(novel|new|unprecedented|breakthrough|revolutionary)\b",
        r"\b(non.obvious|counter.intuitive|unexpected)\b",
    ],
    "cross_domain": [
        r"\b(physics|biology|chemistry|mathematics|info\w*\s*theory)\b",
        r"\b(economics|psychology|neuroscience)\b",
    ],
    "high_impact": [
        r"\b(scale|universal|impact|transform|disrupt)\b",
        r"\b(fundamental|essential|critical)\b",
    ],
    "deep_analysis": [
        r"\b(derive|calculate|simulate|model|formalize)\b",
        r"\b(equation|formula|theorem|proof)\b",
    ],
}


def read_prompt(file_path: str) -> str:
    try:
        return Path(file_path).read_text()
    except Exception:
        return ""


def phase_1_context_absorption(prompt: str) -> dict:
    """Understand and restate the problem, identify core tension."""
    prompt_lower = prompt.lower()
    sentence_count = len(re.findall(r"[.!?]+", prompt))
    word_count = len(prompt.split())
    code_indicators = len(re.findall(r"```", prompt)) // 2

    # What kind of problem is this?
    problem_types = []
    if re.search(r"\b(why|how|what if)\b", prompt_lower):
        problem_types.append("open_exploratory")
    if re.search(r"\b(fix|bug|error|crash|fail)\b", prompt_lower):
        problem_types.append("corrective")
    if re.search(r"\b(design|architect|plan|structure)\b", prompt_lower):
        problem_types.append("design")
    if re.search(r"\b(implement|build|create|write|add)\b", prompt_lower):
        problem_types.append("constructive")
    if re.search(r"\b(optimize|speed|fast|slow|perf)\b", prompt_lower):
        problem_types.append("optimization")
    if not problem_types:
        problem_types.append("general")

    return {
        "phase": "context_absorption",
        "word_count": word_count,
        "sentence_count": sentence_count,
        "code_blocks": code_indicators,
        "problem_types": problem_types,
        "needs_decomposition": word_count > 50,
        "complexity_heuristic": "high" if len(problem_types) >= 2 else "medium" if len(problem_types) == 1 else "low",
    }


def phase_2_assumption_surfacing(prompt: str) -> dict:
    """Identify hidden assumptions and constraints."""
    prompt_lower = prompt.lower()

    # Detect explicit assumptions the user stated
    user_assumptions = re.findall(
        r"(assuming|given that|let's say|suppose|presume|take it as given)[^.]*\.",
        prompt_lower,
    )

    # Detect implicit constraints
    implicit_constraints = []
    if re.search(r"\b(rewrite|refactor|migrate)\b", prompt_lower):
        implicit_constraints.append("must_preserve_behavior")
    if re.search(r"\b(test|coverage)\b", prompt_lower):
        implicit_constraints.append("must_verify_with_tests")
    if re.search(r"\b(compat|legacy|backward)\b", prompt_lower):
        implicit_constraints.append("must_maintain_backward_compatibility")
    if re.search(r"\b(performance|speed|fast|latency)\b", prompt_lower):
        implicit_constraints.append("performance_constraint")
    if re.search(r"\b(secure|vulnerab|attack|threat)\b", prompt_lower):
        implicit_constraints.append("security_constraint")
    if re.search(r"\b(schema|contract|interface|api)\b", prompt_lower):
        implicit_constraints.append("contract_constraint")

    return {
        "phase": "assumption_surfacing",
        "explicit_assumptions": user_assumptions,
        "implicit_constraints": implicit_constraints,
        "assumption_count": len(user_assumptions) + len(implicit_constraints),
        "needs_boundary_check": len(implicit_constraints) > 0,
    }


def phase_3_cross_domain_analogy(prompt: str) -> dict:
    """Draw analogies from other domains based on detected patterns."""
    prompt_lower = prompt.lower()

    domain_signals = {
        "physics": ["physics", "force", "energy", "momentum", "field", "wave", "particle"],
        "biology": ["biology", "evolve", "organism", "population", "gene", "selection"],
        "mathematics": ["math", "equation", "theorem", "proof", "set", "function", "relation"],
        "information_theory": ["entropy", "information", "signal", "noise", "code", "channel"],
        "economics": ["market", "incentive", "trade.off", "utility", "optimize", "resource"],
        "psychology": ["cognitive", "bias", "behavior", "perception", "mental", "learn"],
        "engineering": ["system", "module", "coupling", "cohesion", "redundancy", "feedback"],
    }

    matched_domains = {}
    for domain, keywords in domain_signals.items():
        matches = [kw for kw in keywords if re.search(kw, prompt_lower)]
        if matches:
            matched_domains[domain] = matches

    # Generate analogy suggestions from matched domains
    analogies = []
    if "physics" in matched_domains:
        analogies.append({
            "domain": "physics",
            "analogy": "Treat the system as a dynamical system — what are the forces and counter-forces?",
        })
    if "biology" in matched_domains:
        analogies.append({
            "domain": "biology",
            "analogy": "Consider evolutionary pressure — which approaches would survive a selection process?",
        })
    if "mathematics" in matched_domains:
        analogies.append({
            "domain": "mathematics",
            "analogy": "Can the problem be expressed as a formal system? What are the invariants?",
        })
    if "information_theory" in matched_domains:
        analogies.append({
            "domain": "information_theory",
            "analogy": "What is being communicated? Where is the noise? What would a perfect channel look like?",
        })
    if "economics" in matched_domains:
        analogies.append({
            "domain": "economics",
            "analogy": "Model incentives and trade-offs — what utility function are you optimizing?",
        })
    if "psychology" in matched_domains:
        analogies.append({
            "domain": "psychology",
            "analogy": "Account for cognitive biases — are you anchoring on an initial assumption?",
        })
    if "engineering" in matched_domains:
        analogies.append({
            "domain": "engineering",
            "analogy": "Apply feedback control — sense, compare, adjust in a continuous loop.",
        })

    if not analogies:
        analogies.append({
            "domain": "general",
            "analogy": "Consider: how would a beginner approach this? How would an expert simplify it?",
        })

    return {
        "phase": "cross_domain_analogy",
        "matched_domains": list(matched_domains.keys()),
        "analogy_suggestions": analogies,
        "analogy_count": len(analogies),
    }


def phase_4_first_principles(prompt: str) -> dict:
    """Derive analysis from fundamental truths, stripping away assumptions."""
    prompt_lower = prompt.lower()

    # What fundamentals are being discussed?
    fundamentals = []
    if re.search(r"\b(application|app|system|service|program)\b", prompt_lower):
        fundamentals.append("every_system_has_inputs_outputs_and_state")
    if re.search(r"\b(code|program|function|algorithm)\b", prompt_lower):
        fundamentals.append("code_must_be_parsed_executed_and_produce_correct_output")
    if re.search(r"\b(data|database|storage|file)\b", prompt_lower):
        fundamentals.append("data_must_be_consistent_available_and_partition_tolerant")
    if re.search(r"\b(user|client|customer|human)\b", prompt_lower):
        fundamentals.append("the_user_has_a_goal_the_system_facilitates_or_blocks_it")
    if re.search(r"\b(change|update|modify|edit)\b", prompt_lower):
        fundamentals.append("every_change_has_a_before_and_after_verify_both")

    # What axioms ground the solution?
    axioms = [
        "a_computer_can_only_do_what_it_is_instructed_to_do",
        "correctness_is_relative_to_specification",
        "complexity_is_traded_for_generality",
        "every_abstraction_leaks",
    ]

    return {
        "phase": "first_principles",
        "identified_fundamentals": fundamentals,
        "applicable_axioms": axioms[:3],
        "fundamental_count": len(fundamentals),
        "approach": "work_from_first_principles_up" if len(fundamentals) >= 2 else "apply_existing_patterns",
    }


def phase_5_synthesis(prompt: str, previous_phases: list[dict]) -> dict:
    """Combine insights from all phases into coherent direction."""
    # Collect phase outputs
    phase_map = {p.get("phase"): p for p in previous_phases if isinstance(p, dict)}

    complexity = phase_map.get("context_absorption", {}).get("complexity_heuristic", "medium")
    assumption_count = phase_map.get("assumption_surfacing", {}).get("assumption_count", 0)
    analogy_count = phase_map.get("cross_domain_analogy", {}).get("analogy_count", 0)
    fundamentals = phase_map.get("first_principles", {}).get("identified_fundamentals", [])

    # Compute innovation score from raw signals
    prompt_lower = prompt.lower()
    scores = {}
    for category, patterns in INNOVATION_SIGNALS.items():
        matches = []
        for pattern in patterns:
            matches.extend(re.findall(pattern, prompt_lower))
        scores[category] = len(matches)
    total_signals = sum(scores.values())
    innovation_score = min(100, total_signals * 10)

    # Generate recommendations
    recommendations = []
    if complexity == "high":
        recommendations.append("Decompose into independent subproblems before proceeding")
    if assumption_count > 3:
        recommendations.append("Challenge the implicit constraints — not all may apply")
    if analogy_count > 1:
        recommendations.append("Cross-domain insights available — evaluate the most promising analogy")
    if innovation_score > 50:
        recommendations.append("High innovation potential — consider exploring multiple solution paths")
    if not recommendations:
        recommendations.append("Standard approach should suffice — focus on clean execution")

    return {
        "phase": "synthesis",
        "innovation_score": innovation_score,
        "signal_scores": scores,
        "total_signals": total_signals,
        "complexity": "breakthrough" if innovation_score > 70 else "advanced" if innovation_score > 40 else "standard",
        "synthesis_direction": "first_principles" if fundamentals else "pattern_based",
        "recommendations": recommendations,
    }


def phase_6_self_critique(synthesis: dict, prompt: str) -> dict:
    """Challenge the synthesis — find weaknesses, gaps, and blind spots."""
    weaknesses = []

    # Check for common innovation blind spots
    innovation_score = synthesis.get("innovation_score", 0)
    prompt_lower = prompt.lower()

    # Feasibility check
    if re.search(r"\b(impossible|unrealistic|too.complex|impractical)\b", prompt_lower):
        weaknesses.append("Task may be infeasible in current form — consider scoping down")

    # Missing verification check
    if not re.search(r"\b(test|verify|validate|check|confirm)\b", prompt_lower):
        weaknesses.append("No verification strategy identified — how will you know it works?")

    # Over-innovation warning
    if innovation_score > 80:
        weaknesses.append("High innovation score risks over-engineering — check if pragmatic solution exists")

    # Under-innovation warning
    if innovation_score < 20:
        weaknesses.append("Low innovation score but task may benefit from creative thinking")

    return {
        "phase": "self_critique",
        "weaknesses": weaknesses,
        "innovation_score": innovation_score,
        "confidence": "high" if len(weaknesses) == 0 else "medium" if len(weaknesses) <= 2 else "low",
        "refinement_suggestions": weaknesses if weaknesses else ["No critical weaknesses identified — proceed with confidence"],
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

    # Run all 6 phases
    p1 = phase_1_context_absorption(prompt)
    p2 = phase_2_assumption_surfacing(prompt)
    p3 = phase_3_cross_domain_analogy(prompt)
    p4 = phase_4_first_principles(prompt)
    p5 = phase_5_synthesis(prompt, [p1, p2, p3, p4])
    p6 = phase_6_self_critique(p5, prompt)

    result = {
        "analysis_type": "breakthrough-innovation",
        "phases": [p1, p2, p3, p4, p5, p6],
        "summary": {
            "composite_score": p5["innovation_score"],
            "complexity": p5["complexity"],
            "confidence": p6["confidence"],
            "recommendations": p5["recommendations"],
            "weaknesses": p6["weaknesses"],
        },
    }

    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()

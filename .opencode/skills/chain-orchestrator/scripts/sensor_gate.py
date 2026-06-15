#!/usr/bin/env python3
"""
SENSOR Gate — Codex-Compatible Unified Runtime.

Single entry point that runs ALL stages automatically:
0. Chain Classification (pattern matching)
1. Intent Classification
2. Skill Resolution
2.5. AGENTS.md Hierarchical Load
3. Guardian AI Safety Review (via NEURO) — MANDATORY
3.5. Sandbox Mode Check
3.6. Approval Policy Check
3.7. Rules Engine Check
4. Execution Plan + Enforcement Block

Usage:
    python sensor_gate.py --prompt "user prompt here"
    python sensor_gate.py --prompt "user prompt here" --json
"""

import json
import re
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

def _find_project_root() -> Path:
    """Find project root by looking for .opencode directory."""
    current = Path.cwd()
    for parent in [current] + list(current.parents):
        if (parent / ".opencode").is_dir():
            return parent
    return current

PROJECT_ROOT = _find_project_root()
SKILLS_DIR = PROJECT_ROOT / ".opencode" / "skills"
EVOLUTION_DIR = PROJECT_ROOT / "evolution"
CONFIG_PATH = PROJECT_ROOT / ".opencode" / "config" / "opencode.yaml"
SCRIPTS_DIR = PROJECT_ROOT / ".opencode" / "scripts"

# Add guardian-ai scripts to path
_guardian_scripts = SKILLS_DIR / "guardian-ai" / "scripts"
if str(_guardian_scripts) not in sys.path:
    sys.path.insert(0, str(_guardian_scripts))

# Add scripts dir to path for sandbox_manager and agents_md_loader
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))


# ---------------------------------------------------------------------------
# Config Loader
# ---------------------------------------------------------------------------

def load_config() -> dict:
    """Load opencode.yaml config."""
    try:
        import yaml
        if CONFIG_PATH.exists():
            with open(CONFIG_PATH) as f:
                return yaml.safe_load(f) or {}
    except ImportError:
        pass
    return {}


# ---------------------------------------------------------------------------
# Pattern Rules
# ---------------------------------------------------------------------------

PATTERN_RULES = [
    (r'\b(fix|bug|error|issue|crash|broken)\b', "debugging", "high"),
    (r'\b(refactor|restructure|reorganize|cleanup)\b', "refactoring", "medium"),
    (r'\b(test|tests|testing|coverage|assert)\b', "testing", "medium"),
    (r'\b(security|auth|token|secret|vulnerability)\b', "security", "high"),
    (r'\b(performance|slow|optimize|speed|latency)\b', "performance", "medium"),
    (r'\b(deploy|docker|ci|cd|pipeline|build)\b', "devops", "medium"),
    (r'\b(git|commit|branch|merge|pr|pull request)\b', "git", "low"),
    (r'\b(api|endpoint|route|rest|graphql)\b', "api", "medium"),
    (r'\b(python|django|flask|fastapi)\b', "python", "low"),
    (r'\b(react|jsx|tsx|component|hooks?)\b', "react", "low"),
    (r'\b(frontend|ui|css|tailwind|style)\b', "frontend", "low"),
    (r'\b(quantum|qaoa|qae|qubit)\b', "quantum", "medium"),
    (r'\b(data|pandas|numpy|analysis)\b', "data", "medium"),
    (r'\b(plan|planning|roadmap|sprint)\b', "planning", "medium"),
    (r'\b(architect|architecture|design|pattern)\b', "architecture", "high"),
    (r'\b(product|feature|user|requirement)\b', "product", "medium"),
    (r'\b(document|documentation|readme|doc)\b', "documentation", "low"),
    (r'\b(explain|describe|how does|what is)\b', "communication", "low"),
    (r'\b(research|investigate|explore|analyze)\b', "research", "medium"),
    (r'\b(automate|automation|pipeline|workflow)\b', "automation", "medium"),
    (r'\b(innovate|innovation|breakthrough|novel)\b', "breakthrough-overdrive-innovation", "high"),
    (r'\b(review|audit|examine|inspect)\b', "neuro", "high"),
    (r'\b(improve|enhance|better)\b', "neuro", "medium"),
]

# ═══════════════════════════════════════════════════════════════════════════
# DYNAMIC GRAPH — ALL 37 skills as nodes, dependencies as edges
# ═══════════════════════════════════════════════════════════════════════════

SKILL_GRAPH = {
    # ── META SKILLS ──
    "breakthrough-overdrive-innovation": {"needs": [], "triggers": ["neuro", "research", "deep-research"], "always": True},
    "context-compactor": {"needs": [], "triggers": [], "always": False},
    "exhaustive-crosscheck": {"needs": [], "triggers": ["neuro"], "always": False},
    "neuro": {"needs": [], "triggers": ["model-router", "code-hardener"], "always": False},
    "model-router": {"needs": ["neuro"], "triggers": [], "always": False},
    "code-hardener": {"needs": ["neuro"], "triggers": ["lint-fixer"], "always": False},
    "lint-fixer": {"needs": [], "triggers": [], "always": False},
    "pieces-ltm": {"needs": [], "triggers": ["automated-learning"], "always": False},
    "automated-learning": {"needs": [], "triggers": [], "always": False},
    "chain-orchestrator": {"needs": [], "triggers": [], "always": False},
    "guardian-ai": {"needs": [], "triggers": [], "always": False},
    "automation": {"needs": [], "triggers": [], "always": False},
    "scheduled-automations": {"needs": ["automation"], "triggers": [], "always": False},

    # ── CORE SKILLS ──
    "planning": {"needs": [], "triggers": ["architecture"], "always": False},
    "architecture": {"needs": [], "triggers": ["code-hardener"], "always": False},
    "quality": {"needs": [], "triggers": [], "always": False},
    "security": {"needs": [], "triggers": ["code-hardener"], "always": False},
    "testing": {"needs": [], "triggers": [], "always": False},
    "debugging": {"needs": [], "triggers": ["testing"], "always": False},
    "performance": {"needs": [], "triggers": ["code-hardener"], "always": False},

    # ── LANGUAGE SKILLS ──
    "python": {"needs": [], "triggers": ["quality"], "always": False},
    "frontend": {"needs": [], "triggers": ["quality"], "always": False},
    "react": {"needs": ["frontend"], "triggers": ["quality"], "always": False},
    "api": {"needs": [], "triggers": ["security"], "always": False},

    # ── TOOL SKILLS ──
    "git": {"needs": [], "triggers": ["quality"], "always": False},
    "git-feature-workflow": {"needs": ["git"], "triggers": [], "always": False},
    "devops": {"needs": [], "triggers": ["security"], "always": False},

    # ── SPECIALIZED SKILLS ──
    "quantum": {"needs": [], "triggers": ["performance"], "always": False},
    "data": {"needs": [], "triggers": ["quality"], "always": False},
    "research": {"needs": [], "triggers": [], "always": False},
    "deep-research": {"needs": [], "triggers": ["research"], "always": False},
    "documentation": {"needs": [], "triggers": [], "always": False},

    # ── SOFT SKILLS ──
    "communication": {"needs": [], "triggers": [], "always": False},
    "product": {"needs": [], "triggers": ["planning"], "always": False},
    "refactoring": {"needs": [], "triggers": ["code-hardener", "lint-fixer"], "always": False},
    "onboarding": {"needs": [], "triggers": ["research"], "always": False},

    # ── EXTERNAL ──
    "youtube-transcript": {"needs": [], "triggers": ["research"], "always": False},
}

# Task-to-skills mapping — which skills each task type needs
TASK_SKILLS = {
    "debugging": ["debugging", "testing"],
    "refactoring": ["refactoring", "code-hardener", "lint-fixer"],
    "testing": ["testing", "quality"],
    "security": ["security", "neuro"],
    "performance": ["performance", "neuro"],
    "devops": ["devops", "security"],
    "git": ["git"],
    "api": ["api", "security", "neuro"],
    "python": ["python", "quality"],
    "react": ["react", "frontend", "quality"],
    "frontend": ["frontend", "quality"],
    "quantum": ["quantum", "performance", "neuro"],
    "data": ["data", "quality"],
    "planning": ["planning", "architecture"],
    "architecture": ["architecture", "code-hardener"],
    "product": ["product", "planning"],
    "documentation": ["documentation"],
    "communication": ["communication"],
    "research": ["research", "deep-research"],
    "automation": ["automation", "neuro"],
    "breakthrough-overdrive-innovation": ["neuro"],
    "neuro": ["neuro"],
}


def build_dynamic_graph(prompt: str) -> dict:
    """Build a dynamic execution graph based on what the task ACTUALLY needs.
    
    Unlike the old static chain, this:
    1. Starts with skills the task specifically needs
    2. Adds prerequisite skills via dependency edges
    3. Adds ending skills (LTM, learning) only if work was done
    4. Skips skills that aren't relevant
    """
    prompt_lower = prompt.lower()
    
    # Detect what tasks are needed
    detected = []
    for pattern, task_type, priority in PATTERN_RULES:
        if re.search(pattern, prompt_lower):
            detected.append({"task_type": task_type, "priority": priority})
    
    # Dedupe by priority
    seen = {}
    for t in detected:
        tt = t["task_type"]
        if tt not in seen or _rank(t["priority"]) > _rank(seen[tt]["priority"]):
            seen[tt] = t
    tasks = list(seen.values())
    
    # Collect skills needed by detected tasks
    needed_skills = set()
    for task in tasks:
        for skill in TASK_SKILLS.get(task["task_type"], []):
            needed_skills.add(skill)
    
    # Always include dream
    needed_skills.add("breakthrough-overdrive-innovation")
    
    # Resolve dependencies — add prerequisites
    resolved = set()
    to_process = list(needed_skills)
    while to_process:
        skill = to_process.pop()
        if skill in resolved:
            continue
        node = SKILL_GRAPH.get(skill, {})
        prereqs = node.get("needs", [])
        added = False
        for prereq in prereqs:
            if prereq not in resolved and prereq not in to_process:
                to_process.append(prereq)
                added = True
        if not added:
            resolved.add(skill)
    
    # Add ending skills if any work was done (non-trivial)
    work_skills = resolved - {"breakthrough-overdrive-innovation", "pieces-ltm", "automated-learning"}
    if work_skills:
        resolved.add("pieces-ltm")
        resolved.add("automated-learning")
    
    # Add lint-fixer if any code-related skill ran
    code_skills = {"neuro", "code-hardener", "debugging", "security", "refactoring"}
    if resolved & code_skills:
        resolved.add("lint-fixer")
    
    # Topological sort — respect dependencies
    chain = _topological_sort(resolved)
    
    # MINIMUM SKILL FLOOR — never run with less than 3 skills
    # Ensures at least: dream + one execution skill + LTM persistence
    MINIMUM_CHAIN = ["breakthrough-overdrive-innovation", "neuro", "pieces-ltm"]
    if len(chain) < 3:
        for skill in MINIMUM_CHAIN:
            if skill not in chain:
                chain.append(skill)
        chain = _topological_sort(set(chain))
    
    # Determine complexity
    complexity = "high" if len(tasks) > 3 else "medium" if len(tasks) > 1 else "low"
    
    return {
        "detected_tasks": [t["task_type"] for t in tasks],
        "complexity": complexity,
        "chain": chain,
        "primary_task": tasks[0]["task_type"] if tasks else "general",
        "skills_needed": list(needed_skills),
        "skills_resolved": list(resolved),
    }


def _topological_sort(skills: set) -> list:
    """Sort skills respecting dependency order."""
    in_degree = {s: 0 for s in skills}
    adj = {s: [] for s in skills}
    
    for skill in skills:
        node = SKILL_GRAPH.get(skill, {})
        for prereq in node.get("needs", []):
            if prereq in skills:
                adj[prereq].append(skill)
                in_degree[skill] += 1
    
    queue = [s for s in skills if in_degree[s] == 0]
    result = []
    while queue:
        queue.sort()  # Deterministic order
        node = queue.pop(0)
        result.append(node)
        for neighbor in adj[node]:
            in_degree[neighbor] -= 1
            if in_degree[neighbor] == 0:
                queue.append(neighbor)
    
    return result


# ---------------------------------------------------------------------------
# Stage 0: Chain Classification
# ---------------------------------------------------------------------------

def classify_chain(prompt: str) -> dict:
    """Build dynamic execution graph — NOT a static chain."""
    return build_dynamic_graph(prompt)


def _rank(p):
    return {"high": 3, "medium": 2, "low": 1}.get(p, 0)


def _is_social_greeting(prompt: str) -> bool:
    social_patterns = r'^\s*(hi|hello|hey|thanks|thank you|bye|goodbye|cheers|sup|yo)\s*[!.?]*\s*$'
    return bool(re.match(social_patterns, prompt.strip(), re.IGNORECASE))


# ---------------------------------------------------------------------------
# Stage 1: Intent Classification
# ---------------------------------------------------------------------------

def classify_intent(prompt: str, chain_result: dict) -> str:
    is_social = _is_social_greeting(prompt)
    lines = [
        "[SENSOR] Intent Classification",
        f"- intent: {prompt[:80]}",
        f"- domain_tags: {', '.join(chain_result['detected_tasks'][:8])}",
        f"- risk_level: {'high' if chain_result['complexity'] == 'high' else 'medium'}",
        "- time_sensitivity: medium",
        "- requires_tools: files",
        "- deliverable_type: multi",
        f"- is_social_greeting: {'true' if is_social else 'false'}",
    ]
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Stage 2: Skill Resolution
# ---------------------------------------------------------------------------

def resolve_skills(chain_result: dict) -> str:
    primary = chain_result["primary_task"]
    chain = chain_result["chain"]

    # Dream is always the thinking mode — override primary if not trivial
    if primary not in ("communication",):
        primary = "breakthrough-overdrive-innovation"
        mode = "DREAM_INNOVATION"
    else:
        mode = "TRIVIAL"

    supports = [s for s in chain if s != primary][:2]
    lines = [
        "[SENSOR] Skill Resolution",
        f"- primary: {primary}",
        f"- supports: {', '.join(supports)}",
        "- automation: none",
        f"- mode: {mode}",
        f"- why: Detected {', '.join(chain_result['detected_tasks'][:3])} tasks — dream thinking is default",
        f"- chain: {' → '.join(chain)}",
    ]
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Stage 2.5: AGENTS.md Hierarchical Load
# ---------------------------------------------------------------------------

def load_agents_md() -> str:
    """Load AGENTS.md via hierarchical loader. Returns merged content or empty."""
    try:
        result = subprocess.run(
            [sys.executable, str(SCRIPTS_DIR / "agents_md_loader.py"),
             "--project-root", str(PROJECT_ROOT), "--json"],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode == 0:
            info = json.loads(result.stdout)
            files_found = info.get("files", [])
            if files_found:
                sources = [f["scope"] for f in files_found]
                return f"[AGENTS.md] Loaded {len(files_found)} file(s): {', '.join(sources)}"
            return "[AGENTS.md] No override files found — using base .opencode/AGENTS.md"
    except Exception as e:
        return f"[AGENTS.md] Loader error: {e}"
    return "[AGENTS.md] Loader not available"


# ---------------------------------------------------------------------------
# Stage 3: Guardian AI
# ---------------------------------------------------------------------------

def run_guardian_stage(prompt: str, chain_result: dict) -> tuple[str, dict | None, bool]:
    """Run Guardian AI. Returns (block_text, result_dict, is_blocked)."""
    try:
        from guardian_ai import run_guardian
        result = run_guardian(prompt, {"chain": chain_result["chain"]})
        decision = result.get("decision", "UNKNOWN")
        risk = result.get("risk_level", "unknown")
        reason = result.get("reason", "No reason")
        source = result.get("_source", "unknown")

        block = (
            f"[GUARDIAN] Safety Review\n"
            f"- decision: {decision}\n"
            f"- risk_level: {risk}\n"
            f"- source: {source}\n"
            f"- reason: {reason}"
        )

        if decision == "REJECTED":
            block += f"\n\n**BLOCKED by Guardian AI:** {reason}"
            return block, result, True

        if decision == "HUMAN_REQUIRED":
            block += "\n**Guardian AI requires human approval before proceeding.**"

        return block, result, False

    except ImportError:
        return "[GUARDIAN] WARNING: guardian_ai module not available", None, False
    except Exception as e:
        return f"[GUARDIAN] WARNING: Error: {e}", None, False


# ---------------------------------------------------------------------------
# Stage 3.5-3.7: Sandbox + Approval + Rules
# ---------------------------------------------------------------------------

def run_enforcement_checks(config: dict) -> str:
    """Run sandbox, approval, and rules checks. Returns enforcement block."""
    sandbox_mode = config.get("sandbox_mode", "workspace-write")
    approval_policy = config.get("approval_policy", "on-request")
    rules = config.get("rules", [])

    # Load sandbox manager for command checking
    blocked_commands = []
    require_approval = []
    auto_allowed = []

    try:
        from sandbox_manager import check_command, classify_command
        # Test common commands against rules
        test_commands = [
            "git push origin main",
            "git push --force main",
            "rm -rf /tmp/test",
            "pytest",
            "ruff check .",
            "mypy src/",
            "npm install",
            "pip install flask",
            "git status",
            "git diff",
        ]
        for cmd in test_commands:
            result = check_command(cmd, sandbox_mode, approval_policy, rules)
            if not result.get("allowed"):
                blocked_commands.append(cmd)
            elif result.get("requires_approval"):
                require_approval.append(cmd)
            else:
                auto_allowed.append(cmd)
    except ImportError:
        # Fallback: use config directly
        for rule in rules:
            pattern = " ".join(rule.get("pattern", []))
            decision = rule.get("decision", "allow")
            if decision == "deny":
                blocked_commands.append(pattern)
            elif decision == "require-approval":
                require_approval.append(pattern)
            else:
                auto_allowed.append(pattern)

    lines = [
        "[ENFORCEMENT] Codex-Compatible Runtime",
        f"- sandbox_mode: {sandbox_mode}",
        f"- approval_policy: {approval_policy}",
        f"- rules_loaded: {len(rules)}",
        "",
        "  BLOCKED (never allowed):",
    ]
    for cmd in blocked_commands[:5]:
        lines.append(f"    ✗ {cmd}")
    if not blocked_commands:
        lines.append("    (none)")

    lines.append("  REQUIRES APPROVAL:")
    for cmd in require_approval[:5]:
        lines.append(f"    ⚠ {cmd}")
    if not require_approval:
        lines.append("    (none)")

    lines.append("  AUTO-ALLOWED:")
    for cmd in auto_allowed[:5]:
        lines.append(f"    ✓ {cmd}")
    if not auto_allowed:
        lines.append("    (none)")

    lines.append("")
    lines.append("  RULE: Before executing ANY command, check it against these lists.")
    lines.append("  RULE: If NOT in any list, apply sandbox_mode default.")
    lines.append(f"  RULE: sandbox_mode={sandbox_mode} means workspace edits auto, outside asks.")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Stage 4: Execution Plan
# ---------------------------------------------------------------------------

def emit_plan(chain_result: dict) -> str:
    primary = "breakthrough-overdrive-innovation"
    chain = chain_result["chain"]
    supports = [s for s in chain if s != primary][:2]
    lines = [
        "Skill Plan:",
        f"- primary: {primary}",
        f"- supports: {', '.join(supports)}",
        "- automation: none",
        "- mode: DREAM_INNOVATION",
        f"- chain: {' → '.join(chain)}",
    ]
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Stage 5: Agent Instructions (MANDATORY — agent MUST follow these)
# ---------------------------------------------------------------------------

def emit_agent_instructions(prompt: str, chain_result: dict) -> str:
    """Generate explicit, executable instructions the agent MUST follow."""
    chain = chain_result["chain"]
    tasks = chain_result["detected_tasks"]

    lines = [
        "",
        "=" * 60,
        "AGENT INSTRUCTIONS — YOU MUST EXECUTE THESE IN ORDER",
        "=" * 60,
        "",
        "The sensor gate has classified your task and selected skills.",
        "You MUST execute each step below. Do NOT skip any step.",
        "Do NOT just analyze — you MUST build something.",
        "",
    ]

    step_num = 1
    for skill in chain:
        if skill == "context-compactor":
            continue  # Skip — not needed for most tasks
        if skill == "breakthrough-overdrive-innovation":
            lines.extend([
                f"STEP {step_num}: {skill}",
                f"  You ARE the Dreamer. This is your default thinking mode.",
                f"  Execute the full dream cycle:",
                f"    Phase 0: Search LTM and web for context on: {prompt[:80]}",
                f"    Phase 1: List constraints (what you must NOT break)",
                f"    Phase 2: Find 5 latent insights, 3 connections, 3 TRIZ contradictions",
                f"    Phase 3: Analyze from 5 perspectives (security/performance/UX/cost/architecture)",
                f"    Phase 4: Propose 3 innovations with hypotheses",
                f"    Phase 5: Choose ONE and BUILD IT",
                f"  You MUST produce output for each phase. Do NOT skip.",
                "",
            ])
        elif skill == "neuro":
            lines.extend([
                f"STEP {step_num}: {skill}",
                f"  Run: python3 .opencode/skills/neuro/scripts/neuro_harness.py --task \"{prompt[:60]}\" --phase pre_patch",
                f"  For each file, run NEURO review.",
                f"  Parse the output and apply the top 3 recommendations.",
                "",
            ])
        elif skill == "code-hardener":
            lines.extend([
                f"STEP {step_num}: {skill}",
                f"  Run: python3 .opencode/skills/neuro/scripts/neuro_harness.py --task \"HARDEN: {prompt[:60]}\" --phase post_patch",
                f"  Apply hardening: type annotations, error handling, input validation.",
                "",
            ])
        elif skill == "lint-fixer":
            lines.extend([
                f"STEP {step_num}: {skill}",
                f"  Run: python3 -m ruff check src/ --fix",
                f"  Run: python3 -m ruff format src/",
                f"  Run: python3 -m ruff check src/ and verify 0 errors.",
                "",
            ])
        elif skill == "testing":
            lines.extend([
                f"STEP {step_num}: {skill}",
                f"  Run: python3 -m pytest tests/ --tb=short -q",
                f"  If tests fail, analyze and fix them.",
                "",
            ])
        elif skill == "security":
            lines.extend([
                f"STEP {step_num}: {skill}",
                f"  Review the code for OWASP Top 10 vulnerabilities.",
                f"  Check for: hardcoded secrets, SQL injection, XSS, insecure deps.",
                f"  If found, fix them.",
                "",
            ])
        elif skill == "debugging":
            lines.extend([
                f"STEP {step_num}: {skill}",
                f"  Use the reproduce-isolate-fix-verify cycle.",
                f"  Find the root cause, not the symptom.",
                "",
            ])
        elif skill == "research":
            lines.extend([
                f"STEP {step_num}: {skill}",
                f"  Search the web and LTM for context on: {prompt[:80]}",
                f"  Compile findings into a brief report.",
                "",
            ])
        else:
            lines.extend([
                f"STEP {step_num}: {skill}",
                f"  Execute the {skill} skill on the current task.",
                "",
            ])
        step_num += 1

    lines.extend([
        "FINAL STEP: Persist results to Pieces LTM.",
        "  Primary: Use the PiecesLTM Service (inside opencode runtime):",
        "    PiecesLTM.Service.persist({ chainName: '...', taskDescription: '...', outcome: 'success' })",
        "  Fallback: Run: python3 .opencode/skills/pieces-ltm/scripts/pieces_persist.py persist \\",
        f"    --chain \"{', '.join(chain)}\" --task \"{prompt[:80]}\" --outcome success",
        "",
        "After ALL steps complete, respond to the user with:",
        "1. What you found (research + analysis)",
        "2. What you proposed (innovations)",
        "3. What you built (implementation)",
        "",
        "=" * 60,
    ])

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Loggers
# ---------------------------------------------------------------------------

def log_violation(prompt: str, missing_stages: list[str]) -> None:
    EVOLUTION_DIR.mkdir(parents=True, exist_ok=True)
    path = EVOLUTION_DIR / "automation_violations.jsonl"
    entry = {
        "timestamp": datetime.now(UTC).isoformat(),
        "violation_type": "near_miss",
        "prompt_excerpt": prompt[:200],
        "missing_stages": missing_stages,
    }
    with open(path, "a") as f:
        f.write(json.dumps(entry) + "\n")


def log_chain(prompt: str, chain: list[str]) -> None:
    EVOLUTION_DIR.mkdir(parents=True, exist_ok=True)
    path = EVOLUTION_DIR / "chain_execution.jsonl"
    entry = {
        "timestamp": datetime.now(UTC).isoformat(),
        "prompt_excerpt": prompt[:200],
        "chain": chain,
        "chain_length": len(chain),
        "sensor_gate_ran": True,
    }
    with open(path, "a") as f:
        f.write(json.dumps(entry) + "\n")


def record_sensor_gate_run() -> None:
    """Record that sensor gate was run — this is MANDATORY."""
    try:
        sys.path.insert(0, str(PROJECT_ROOT / ".opencode" / "automations"))
        from agent_score import record_event
        record_event("sensor_gate_run", "Sensor gate executed")
    except ImportError:
        pass


# ---------------------------------------------------------------------------
# Main Gate
# ---------------------------------------------------------------------------

def run_gate(prompt: str) -> dict:
    """Run the full SENSOR gate — Codex-compatible unified runtime."""
    config = load_config()

    # RECORD: Sensor gate ran (this is MANDATORY)
    record_sensor_gate_run()

    # Stage 0
    chain_result = classify_chain(prompt)

    # Stage 1
    intent_block = classify_intent(prompt, chain_result)

    # Stage 2
    skill_block = resolve_skills(chain_result)

    # Log chain
    log_chain(prompt, chain_result["chain"])

    # Social greeting bypass
    if _is_social_greeting(prompt):
        return {"is_social_greeting": True, "response": "Hey! What can I help you with?"}

    # Stage 2.5: AGENTS.md load
    agents_md_block = load_agents_md()

    # Stage 3: Guardian AI (MANDATORY)
    guardian_block, guardian_result, is_blocked = run_guardian_stage(prompt, chain_result)

    if is_blocked:
        output = f"{intent_block}\n\n{skill_block}\n\n{agents_md_block}\n\n{guardian_block}"
        print(output)
        return {
            "is_social_greeting": False,
            "blocked": True,
            "guardian_decision": "REJECTED",
            "chain": chain_result["chain"],
            "primary": chain_result["primary_task"],
            "complexity": chain_result["complexity"],
            "output": output,
        }

    # Stage 3.5-3.7: Enforcement checks
    enforcement_block = run_enforcement_checks(config)

    # Stage 4: Plan
    plan_block = emit_plan(chain_result)

    # Stage 5: Agent Instructions (MANDATORY)
    instructions_block = emit_agent_instructions(prompt, chain_result)

    # Output all blocks
    output = f"{intent_block}\n\n{skill_block}\n\n{agents_md_block}\n\n{guardian_block}\n\n{enforcement_block}\n\n{plan_block}\n\n{instructions_block}"
    print(output)

    return {
        "is_social_greeting": False,
        "blocked": False,
        "guardian_decision": guardian_result.get("decision") if guardian_result else "UNKNOWN",
        "chain": chain_result["chain"],
        "primary": chain_result["primary_task"],
        "complexity": chain_result["complexity"],
        "output": output,
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="SENSOR Gate — Codex-Compatible Runtime")
    parser.add_argument("--prompt", required=True, help="User prompt")
    parser.add_argument("--json", action="store_true", help="JSON output")
    args = parser.parse_args()
    result = run_gate(args.prompt)
    if args.json:
        print(json.dumps(result, indent=2))

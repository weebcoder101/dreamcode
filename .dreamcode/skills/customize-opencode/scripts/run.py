#!/usr/bin/env python3
"""Customize OpenCode harness — analyzes prompts for customization needs and config changes."""

import json
import re
import sys
from pathlib import Path

CUSTOMIZATION_CATEGORIES = {
    "agent_config": ["agent", "persona", "role", "assistant", "specialist", "subagent"],
    "model_settings": ["model", "provider", "temperature", "max tokens", "top p", "frequency"],
    "skill_config": ["skill", "chain", "orchestrator", "sensor gate", "pipeline"],
    "theme_ui": ["theme", "color", "appearance", "font", "ui", "display", "style"],
    "tools_permissions": ["permission", "tool", "allow", "deny", "access", "policy"],
    "keybindings": ["keybind", "shortcut", "hotkey", "keymap", "binding"],
    "ltm_memory": ["pieces", "ltm", "memory", "persist", "recall", "remember", "learn"],
    "build_compile": ["build", "compile", "binary", "release", "package", "deploy"],
    "storage_paths": ["path", "directory", "data dir", "config dir", "logs", "backup"],
    "validation_testing": ["validate", "test", "lint", "check", "verify", "ensure"],
}

CATEGORY_GUIDANCE = {
    "agent_config": "Review existing agent config before modifying. Each agent has name, model, temperature, system prompt. Test with a dry run after changes.",
    "model_settings": "Provider config needs api key env vars. Model IDs must match provider catalog. Start with conservative temp (0.3-0.5) for deterministic tasks.",
    "skill_config": "Skills are in dreamcode/skills/<name>/SKILL.md with frontmatter. Python scripts in scripts/ subdirectory. Rebuild after adding new skills.",
    "theme_ui": "Theme is CSS/JSON in config. Preview changes before applying. Terminal color support depends on terminal emulator capabilities.",
    "tools_permissions": "Permission rules are glob patterns. Order matters — first match wins. Default-deny for unknown tools is safest.",
    "keybindings": "Keybinding format depends on terminal mode (raw vs cooked). Avoid conflicts with existing terminal/IDE shortcuts.",
    "ltm_memory": "Pieces LTM runs on localhost:39302 (MCP). Persist signals via selfEvolve.capture(). Query with topics + time ranges for context.",
    "build_compile": "Build uses bun run build. Output binary in dist/. --compile flag for standalone binaries. Smoke test after build.",
    "storage_paths": "Config files are JSON. Backup before modifying. Use ~/.config/dreamcode/ for global, .dreamcode/ for project-local.",
    "validation_testing": "Test incrementally. Check config parse before applying. Verify no regressions in existing agents/skills.",
}


def read_prompt(file_path: str) -> str:
    try:
        return Path(file_path).read_text()
    except Exception:
        return ""


def detect_config_locations(prompt: str) -> list[str]:
    locations = []
    prompt_lower = prompt.lower()
    if "project" in prompt_lower or ".dreamcode" in prompt_lower:
        locations.append(".dreamcode/dreamcode.json")
    if "global" in prompt_lower or "~/.config" in prompt_lower or "user" in prompt_lower:
        locations.append("~/.config/dreamcode/config.json")
    if "agent" in prompt_lower:
        locations.append(".dreamcode/agents/*.json")
    if "skill" in prompt_lower or "chain" in prompt_lower:
        locations.append(".dreamcode/skills/*/SKILL.md")
    if not locations:
        locations.append(".dreamcode/dreamcode.json")
    return locations


def analyze_prompt(prompt: str) -> dict:
    prompt_lower = prompt.lower()
    findings = []
    suggestions = []
    config_locations = detect_config_locations(prompt)

    for category, keywords in CUSTOMIZATION_CATEGORIES.items():
        matches = [kw for kw in keywords if kw in prompt_lower]
        if matches:
            findings.append({"category": category, "matched_keywords": matches})

    if not findings:
        findings.append({"category": "general", "matched_keywords": ["configuration"]})

    for finding in findings:
        cat = finding["category"]
        if cat in CATEGORY_GUIDANCE:
            suggestions.append({"category": cat, "guidance": CATEGORY_GUIDANCE[cat]})

    # Estimate safety level
    destructive_keywords = ["delete", "remove", "reset", "clear", "overwrite", "replace"]
    safety = "high"
    if any(w in prompt_lower for w in destructive_keywords):
        safety = "danger"

    return {
        "analysis_type": "customize-opencode",
        "findings_count": len(findings),
        "findings": findings,
        "suggestions": suggestions,
        "config_locations": config_locations,
        "safety_level": safety,
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

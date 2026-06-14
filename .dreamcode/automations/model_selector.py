#!/usr/bin/env python3
"""model_selector.py — Dynamic Model Selection with Free-First Strategy

Model priority:
1. Free models from opencode (zen): deepseek-v4-flash-free, mimo-v2.5-free
2. Free models from opencode-go: (if any available)
3. Paid fallback: opencode-go/deepseek-v4-flash or opencode-go/mimo-v2.5

Never use: pro models, expensive models, anything beyond deepseek-v4-flash or mimo-v2.5

Usage:
    from model_selector import select_model
    model = select_model()  # Returns best available model
"""

from __future__ import annotations

import subprocess
import sys

# ---------------------------------------------------------------------------
# Model Tiers (in priority order)
# ---------------------------------------------------------------------------

# Tier 1: Free models from opencode (zen) — try these first
FREE_ZEN_MODELS = [
    "opencode/deepseek-v4-flash-free",
    "opencode/mimo-v2.5-free",
]

# Tier 2: Free models from opencode-go (if any)
FREE_GO_MODELS = [
    # No explicit free tier on opencode-go currently
]

# Tier 3: Paid fallback — only these two models, ever
PAID_FALLBACK_MODELS = [
    "opencode-go/deepseek-v4-flash",    # DeepSeek V4 Flash (paid)
    "opencode-go/mimo-v2.5",            # Mimo v2.5 (paid)
]

# Completely blocked — never use these
BLOCKED_MODELS = [
    "opencode-go/deepseek-v4-pro",
    "opencode-go/mimo-v2.5-pro",
    "opencode/deepseek-v4-pro",
    "opencode/claude-opus-4",
    "opencode/claude-sonnet-4",
    "opencode/gpt-5",
    "opencode/gpt-5-pro",
]


# ---------------------------------------------------------------------------
# Model Health Cache
# ---------------------------------------------------------------------------

_model_health: dict[str, dict] = {}


def check_model_available(model: str, timeout: int = 30) -> bool:
    """Check if a model is available by doing a minimal run."""
    health = _model_health.get(model, {})
    
    # If model has failed recently, skip it
    if health.get("failures", 0) >= 3:
        return False
    
    if health.get("available", False):
        return True

    try:
        result = subprocess.run(
            ["opencode", "run", "say ok", "-m", model,
             "--dangerously-skip-permissions", "--format", "json"],
            capture_output=True, text=True, timeout=timeout,
            cwd=os.environ.get("PROJECT_ROOT", str(Path.cwd())),
        )
        available = result.returncode == 0
        _model_health[model] = {"available": available, "failures": 0}
        return available
    except (subprocess.TimeoutExpired, Exception):
        _model_health[model] = {"available": False, "failures": 0}
        return False


def record_task_failure(model: str) -> None:
    """Record that a model failed during actual task execution."""
    health = _model_health.get(model, {})
    failures = health.get("failures", 0) + 1
    _model_health[model] = {"available": True, "failures": failures}
    print(f"  [MODEL] Task failure recorded for {model} ({failures}/3)", file=sys.stderr)
    if failures >= 3:
        print(f"  [MODEL] {model} marked unavailable after {failures} failures", file=sys.stderr)


def select_model(preferred: str | None = None) -> str:
    """Select the best available model using free-first strategy.

    If preferred is given and it's an allowed model, use it.
    Otherwise, cycle through free models, then paid fallback.
    """
    # If preferred model is specified and allowed
    if preferred:
        if preferred in BLOCKED_MODELS:
            print(f"  [MODEL] BLOCKED: {preferred} — using fallback", file=sys.stderr)
        elif any(preferred.startswith(tier.split("/")[0]) for tier in
                 FREE_ZEN_MODELS + FREE_GO_MODELS + PAID_FALLBACK_MODELS):
            return preferred

    # Try free zen models first
    for model in FREE_ZEN_MODELS:
        if check_model_available(model, timeout=15):
            print(f"  [MODEL] Selected (free zen): {model}", file=sys.stderr)
            return model

    # Try free go models
    for model in FREE_GO_MODELS:
        if check_model_available(model, timeout=15):
            print(f"  [MODEL] Selected (free go): {model}", file=sys.stderr)
            return model

    # Fall back to paid (only allowed models)
    for model in PAID_FALLBACK_MODELS:
        if check_model_available(model, timeout=15):
            print(f"  [MODEL] Selected (paid fallback): {model}", file=sys.stderr)
            return model

    # Last resort — default to free zen
    print(f"  [MODEL] No health check passed, defaulting to {FREE_ZEN_MODELS[0]}",
          file=sys.stderr)
    return FREE_ZEN_MODELS[0]


def get_model_tier(model: str) -> str:
    """Return the tier of a model."""
    if model in FREE_ZEN_MODELS:
        return "free-zen"
    if model in FREE_GO_MODELS:
        return "free-go"
    if model in PAID_FALLBACK_MODELS:
        return "paid-fallback"
    if model in BLOCKED_MODELS:
        return "blocked"
    return "unknown"


if __name__ == "__main__":
    model = select_model()
    print(f"Selected: {model}")
    print(f"Tier: {get_model_tier(model)}")

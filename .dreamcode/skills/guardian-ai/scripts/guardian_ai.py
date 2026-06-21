#!/usr/bin/env python3
"""
Guardian AI — NEURO-powered safety supervisor.

Runs on EVERY prompt before any work begins.
Uses NEURO API as its brain to review proposed actions for safety.

Risk levels:
  low      → auto-approve, log only
  medium   → auto-approve, log with details
  high     → block, require human approval
  critical → block, require human approval, alert

Usage:
    python guardian_ai.py --prompt "user prompt here"
    python guardian_ai.py --prompt "user prompt here" --context '{"files": ["foo.py"]}'
    python guardian_ai.py --prompt "user prompt here" --json
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

def _find_project_root() -> Path:
    """Find project root by looking for .opencode directory."""
    current = Path.cwd()
    for parent in [current] + list(current.parents):
        if (parent / ".opencode").is_dir():
            return parent
    return current

PROJECT_ROOT = _find_project_root()
EVOLUTION_DIR = PROJECT_ROOT / "evolution"
GUARDIAN_LOG = EVOLUTION_DIR / "guardian_ai.jsonl"

# Load NEURO API config
def _load_env():
    """Load .env files for NEURO_API_KEY."""
    if os.environ.get("NEURO_API_KEY"):
        return
    for env_file in [".env.secret", ".env.neuro", ".env"]:
        path = PROJECT_ROOT / env_file
        if path.exists():
            for line in path.read_text().splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, _, value = line.partition("=")
                    key = key.strip()
                    value = value.strip().strip('"').strip("'")
                    if key and key not in os.environ:
                        os.environ[key] = value

_load_env()

# DANGEROUS patterns (hard-blocked, no NEURO needed)
HARD_BLOCK_PATTERNS = [
    (["rm", "-rf", "/"], "Recursive delete of root filesystem"),
    (["rm", "-rf", "~"], "Recursive delete of home directory"),
    (["git", "push", "--force", "main"], "Force push to main branch"),
    (["git", "push", "--force", "master"], "Force push to master branch"),
    (["DROP", "TABLE"], "Drop database table"),
    (["DROP", "DATABASE"], "Drop entire database"),
    (["sudo", "rm"], "Superuser delete"),
    (["chmod", "-R", "777"], "Overly permissive recursive chmod"),
    (["curl", "|", "bash"], "Pipe remote script to shell"),
    (["wget", "|", "bash"], "Pipe remote script to shell"),
]

# SAFE patterns (auto-approved, no NEURO needed)
SAFE_PATTERNS = [
    (["pytest"], "Run tests"),
    (["ruff", "check"], "Lint check"),
    (["ruff", "format"], "Format code"),
    (["mypy"], "Type check"),
    (["npm", "test"], "Run npm tests"),
    (["npm", "run", "lint"], "Run npm lint"),
    (["git", "status"], "Check git status"),
    (["git", "diff"], "View git diff"),
    (["git", "log"], "View git log"),
]


# ---------------------------------------------------------------------------
# Hard-block check (instant, no API call)
# ---------------------------------------------------------------------------

def _word_match(pattern_parts: list[str], text: str) -> bool:
    """Check if all pattern parts appear as whole words in text."""
    import re as _re
    for part in pattern_parts:
        if not _re.search(r'(?:^|\s)' + _re.escape(part) + r'(?:\s|$)', text, _re.IGNORECASE):
            return False
    return True


def check_hard_blocks(prompt: str) -> dict | None:
    """Check for instantly blockable patterns. Returns None if safe."""
    prompt_lower = prompt.lower()
    for pattern, reason in HARD_BLOCK_PATTERNS:
        if all(p.lower() in prompt_lower for p in pattern):
            return {"decision": "REJECTED", "risk_level": "critical", "reason": reason}
    return None


def check_safe_patterns(prompt: str) -> dict | None:
    """Check for instantly safe patterns. Returns None if needs review."""
    for pattern, reason in SAFE_PATTERNS:
        if _word_match(pattern, prompt):
            return {"decision": "APPROVED", "risk_level": "low", "reason": reason}
    return None


# ---------------------------------------------------------------------------
# NEURO API call for safety review
# ---------------------------------------------------------------------------

GUARDIAN_SYSTEM_PROMPT = """YOU ARE GUARDIAN AI. YOUR ONLY JOB IS SAFETY REVIEW.

You MUST respond with ONLY a JSON object. No other text. No explanation. No code. Just JSON.

RESPOND WITH EXACTLY THIS FORMAT:
{"decision":"APPROVED","risk_level":"low","reason":"safe","checks":{"destructive_ops":false,"security_risk":false,"data_loss_risk":false,"auth_changes":false,"secret_exposure":false,"follows_conventions":true}}

DECISION RULES:
- If the prompt asks to delete files, drop tables, force push, or destroy data → {"decision":"REJECTED","risk_level":"critical","reason":"destructive operation","checks":{"destructive_ops":true,"security_risk":false,"data_loss_risk":true,"auth_changes":false,"secret_exposure":false,"follows_conventions":false}}
- If the prompt involves auth, tokens, secrets, permissions → {"decision":"HUMAN_REQUIRED","risk_level":"high","reason":"security-sensitive change","checks":{"destructive_ops":false,"security_risk":true,"data_loss_risk":false,"auth_changes":true,"secret_exposure":false,"follows_conventions":true}}
- If the prompt is a normal coding task (fix bug, add feature, refactor, write tests) → {"decision":"APPROVED","risk_level":"medium","reason":"standard coding task","checks":{"destructive_ops":false,"security_risk":false,"data_loss_risk":false,"auth_changes":false,"secret_exposure":false,"follows_conventions":true}}
- If the prompt is read-only (explain, show, list, describe) → {"decision":"APPROVED","risk_level":"low","reason":"read-only query","checks":{"destructive_ops":false,"security_risk":false,"data_loss_risk":false,"auth_changes":false,"secret_exposure":false,"follows_conventions":true}}

DO NOT write anything except the JSON object. Do not explain. Do not describe. Just the JSON."""


def call_neuro_guardian(prompt: str, context: dict = None) -> dict:
    """Call NEURO API for safety review."""
    api_key = os.environ.get("NEURO_API_KEY")
    api_url = os.environ.get("NEURO_API_BASE_URL", "https://api.neurometric.ai/v1")
    model = os.environ.get("NEURO_MODEL", "neurometric/clawpack")

    if not api_key:
        # Fallback: rule-based review if NEURO unavailable
        import sys
        print("WARNING: NEURO_API_KEY not set. Using rule-based safety review. Sign up at https://neurometric.ai to get your free API key for enhanced analysis.", file=sys.stderr)
        return _rule_based_review(prompt)

    user_content = f"User prompt: {prompt}"
    if context:
        user_content += f"\nContext: {json.dumps(context)}"

    chat_payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": GUARDIAN_SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        "response_format": {"type": "json_object"},
        "max_tokens": 512,
    }

    target_url = api_url.rstrip("/")
    if not target_url.endswith("/chat/completions"):
        target_url += "/chat/completions"

    req = urllib.request.Request(
        target_url,
        data=json.dumps(chat_payload).encode(),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
    )

    try:
        t0 = time.time()
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = json.loads(resp.read().decode())
            content = body.get("choices", [{}])[0].get("message", {}).get("content", "")
            result = json.loads(content) if isinstance(content, str) else content
            elapsed = round(time.time() - t0, 2)

            # Validate NEURO returned expected format
            if isinstance(result, dict) and "decision" in result:
                result["_source"] = "neuro"
                result["_latency_s"] = elapsed
                return result
            else:
                # NEURO didn't follow format — fallback to rule-based
                fallback = _rule_based_review(prompt)
                fallback["_source"] = "rule_based_neuro_format_error"
                fallback["_neuro_raw"] = str(content)[:200]
                fallback["_latency_s"] = elapsed
                return fallback
    except Exception as e:
        # Fallback to rule-based on API failure
        result = _rule_based_review(prompt)
        result["_source"] = "rule_based_fallback"
        result["_api_error"] = str(e)
        return result


def _rule_based_review(prompt: str) -> dict:
    """Rule-based safety review when NEURO is unavailable."""
    prompt_lower = prompt.lower()

    checks = {
        "destructive_ops": False,
        "security_risk": False,
        "data_loss_risk": False,
        "auth_changes": False,
        "secret_exposure": False,
        "follows_conventions": True,
    }

    # Check for dangerous patterns
    dangerous_keywords = ["rm -rf", "drop table", "drop database", "force push", "sudo rm"]
    for kw in dangerous_keywords:
        if kw in prompt_lower:
            checks["destructive_ops"] = True
            checks["data_loss_risk"] = True

    # Check for security-sensitive patterns
    security_keywords = ["api key", "secret", "password", "token", "credential", "auth"]
    for kw in security_keywords:
        if kw in prompt_lower:
            checks["security_risk"] = True
            checks["secret_exposure"] = True

    # Check for auth changes
    auth_keywords = ["permission", "access control", "rbac", "role", "authorize"]
    for kw in auth_keywords:
        if kw in prompt_lower:
            checks["auth_changes"] = True

    # Determine risk level
    if checks["destructive_ops"] or checks["data_loss_risk"]:
        return {"decision": "REJECTED", "risk_level": "critical",
                "reason": "Destructive operation detected", "checks": checks}
    if checks["security_risk"] or checks["auth_changes"]:
        return {"decision": "HUMAN_REQUIRED", "risk_level": "high",
                "reason": "Security-sensitive operation detected", "checks": checks}
    if checks["secret_exposure"]:
        return {"decision": "HUMAN_REQUIRED", "risk_level": "high",
                "reason": "Potential secret/credential exposure", "checks": checks}

    return {"decision": "APPROVED", "risk_level": "low",
            "reason": "No risks detected by rule engine", "checks": checks}


# ---------------------------------------------------------------------------
# Logger
# ---------------------------------------------------------------------------

def log_guardian_result(prompt: str, result: dict) -> None:
    """Log guardian result to JSONL."""
    EVOLUTION_DIR.mkdir(parents=True, exist_ok=True)
    entry = {
        "timestamp": datetime.now(UTC).isoformat(),
        "prompt_excerpt": prompt[:200],
        "decision": result.get("decision"),
        "risk_level": result.get("risk_level"),
        "reason": result.get("reason"),
        "source": result.get("_source", "unknown"),
    }
    with open(GUARDIAN_LOG, "a") as f:
        f.write(json.dumps(entry) + "\n")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def run_guardian(prompt: str, context: dict = None) -> dict:
    """Run full Guardian AI review. Returns decision dict."""
    # 1. Hard-block check (instant)
    hard_block = check_hard_blocks(prompt)
    if hard_block:
        hard_block["_source"] = "hard_block"
        log_guardian_result(prompt, hard_block)
        return hard_block

    # 2. Safe pattern check (instant)
    safe = check_safe_patterns(prompt)
    if safe:
        safe["_source"] = "safe_pattern"
        log_guardian_result(prompt, safe)
        return safe

    # 3. NEURO API review
    result = call_neuro_guardian(prompt, context)
    log_guardian_result(prompt, result)
    return result


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Guardian AI — NEURO-powered safety supervisor")
    parser.add_argument("--prompt", required=True, help="User prompt to review")
    parser.add_argument("--context", default="{}", help="JSON context (files, etc.)")
    parser.add_argument("--json", action="store_true", help="JSON output")
    args = parser.parse_args()

    context = json.loads(args.context) if args.context else {}
    result = run_guardian(args.prompt, context)

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        decision = result.get("decision", "UNKNOWN")
        risk = result.get("risk_level", "unknown")
        reason = result.get("reason", "No reason provided")
        source = result.get("_source", "unknown")
        print(f"[GUARDIAN] {decision} (risk: {risk}, source: {source})")
        print(f"  Reason: {reason}")

        if decision == "REJECTED":
            sys.exit(1)
        elif decision == "HUMAN_REQUIRED":
            sys.exit(2)
        else:
            sys.exit(0)

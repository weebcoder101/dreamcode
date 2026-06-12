#!/usr/bin/env python3
"""neuro_harness.py — NEURO API harness with prompt engine integration.

Features:
- Uses NeuroPromptEngine for step-by-step, context-aware prompts
- Supports scan types: security, bug_hunt, full_audit, test_gap
- Returns git diff patches in JSON response
- Batches files to respect token limits
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


# Auto-load .env.neuro if NEURO_API_KEY not set
def _load_env_neuro():
    """Load .env.neuro file if it exists and NEURO_API_KEY is not set."""
    if os.environ.get("NEURO_API_KEY"):
        return
    env_neuro_path = Path(__file__).resolve().parent.parent.parent.parent / ".env.neuro"
    if env_neuro_path.exists():
        for line in env_neuro_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key and key not in os.environ:
                    os.environ[key] = value

_load_env_neuro()

# Ensure automations module is importable
_script_dir = Path(__file__).resolve().parent
_opencode_root = _script_dir.parent.parent.parent  # .opencode/
if str(_opencode_root) not in sys.path:
    sys.path.insert(0, str(_opencode_root))


def main():
    parser = argparse.ArgumentParser(description="NEURO API harness with prompt engine")
    parser.add_argument("--task", default="", help="Task description")
    parser.add_argument("--scan-type", default="full_audit",
                        choices=["security", "bug_hunt", "full_audit", "test_gap"])
    parser.add_argument("--file", action="append", default=[], help="Files to analyze")
    parser.add_argument("--file-content", default="", help="Raw file contents as JSON string")
    parser.add_argument("--automation-context", default="{}", help="JSON automation context")
    parser.add_argument("--phase", default="pre_patch", choices=["pre_patch", "post_patch"])
    parser.add_argument("--force-live", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--max-tokens", type=int, default=8192)
    args = parser.parse_args()

    api_key = os.environ.get("NEURO_API_KEY")
    if not api_key:
        print("ERROR: NEURO_API_KEY environment variable missing.")
        sys.exit(20)

    api_url = os.environ.get("NEURO_API_BASE_URL", "https://api.neurometric.ai/v1")

    # Build files list for prompt engine
    files = []
    if args.file:
        for fp in args.file:
            try:
                with open(fp) as f:
                    content = f.read()
                ext = Path(fp).suffix.lstrip(".")
                files.append({"path": fp, "content": content, "language": ext})
            except Exception as e:
                print(f"Warning: Could not read {fp}: {e}")

    # If file-content JSON was passed, parse it
    if args.file_content:
        try:
            extra_files = json.loads(args.file_content)
            if isinstance(extra_files, list):
                files.extend(extra_files)
        except json.JSONDecodeError:
            pass

    # Parse automation context
    import contextlib
    context = {}
    with contextlib.suppress(json.JSONDecodeError):
        context = json.loads(args.automation_context)
    context["automation"] = context.get("automation", args.task or "manual")

    if not files:
        print("ERROR: No files provided. Use --file or --file-content.")
        sys.exit(1)

    # Build prompt using engine
    from automations.prompts.prompt_engine import NeuroPromptEngine
    engine = NeuroPromptEngine()
    prompt = engine.build(args.scan_type, files, context)

    if args.dry_run:
        print("=== DRY RUN ===")
        print(f"Estimated tokens: {prompt['estimated_tokens']}")
        print(f"Files: {len(files)}")
        print(f"System prompt length: {len(prompt['system_prompt'])} chars")
        print(f"User prompt length: {len(prompt['user_prompt'])} chars")
        sys.exit(0)

    # Build NEURO API payload with intelligent model selection
    try:
        # Try to use model router for intelligent selection
        _model_router_dir = _script_dir.parent.parent / "model-router" / "scripts"
        if str(_model_router_dir) not in sys.path:
            sys.path.insert(0, str(_model_router_dir))
        from model_router import ModelRouter

        router = ModelRouter()
        # Map scan_type to skill names for the model router
        scan_to_skill = {
            "full_audit": "neuro",
            "security": "security",
            "bug_hunt": "debugging",
            "test_gap": "testing",
        }
        skill_for_router = scan_to_skill.get(args.scan_type, "neuro")
        task_context = router.analyze_task(args.task, [skill_for_router])
        selection = router.select_models(task_context)
        # ModelSelection has .primary (ModelInfo with .id) and .secondary (list[ModelInfo])
        primary_model = selection.primary.id
        secondary_models = [m.id for m in selection.secondary]
        all_models = [primary_model] + secondary_models
        print(f"NEURO: Model router selected {primary_model} (+{len(secondary_models)} secondary)")
        print(f"NEURO: Reasoning: {selection.reasoning}")
    except Exception as e:
        # Fallback to default model if router fails
        primary_model = os.environ.get("NEURO_MODEL", "neurometric/clawpack")
        all_models = [primary_model]
        print(f"NEURO: Using default model {primary_model} (router unavailable: {e})")

    chat_payload = {
        "model": primary_model,
        "messages": [
            {"role": "system", "content": prompt["system_prompt"]},
            {"role": "user", "content": prompt["user_prompt"]},
        ],
        "response_format": {"type": "json_object"},
        "max_tokens": args.max_tokens,
    }

    payload_bytes = json.dumps(chat_payload).encode()
    target_url = api_url.rstrip("/")
    if not target_url.endswith("/chat/completions"):
        target_url += "/chat/completions"

    req = urllib.request.Request(target_url, data=payload_bytes, headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    })

    print(f"NEURO: {len(files)} files, ~{prompt['estimated_tokens']} tokens, scan={args.scan_type}")
    t0 = time.time()

    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            body = json.loads(resp.read().decode())
            content = body.get("choices", [{}])[0].get("message", {}).get("content", "")
            try:
                result = json.loads(content) if isinstance(content, str) else content
            except json.JSONDecodeError:
                result = {"raw": content}

            # Handle both dict and list responses
            if isinstance(result, list):
                patches = []
                for item in result:
                    if isinstance(item, dict) and "patches" in item:
                        patches.extend(item["patches"])
                    elif isinstance(item, dict) and "diff" in item:
                        patches.append(item)
                risks = []
                analysis_parts = [str(item) for item in result if isinstance(item, str)]
                result = {
                    "patches": patches,
                    "risks": risks,
                    "analysis": analysis_parts,
                }
            elif isinstance(result, dict):
                if not isinstance(result.get("patches"), list):
                    result["patches"] = []
                if not isinstance(result.get("risks"), list):
                    result["risks"] = []
                if not isinstance(result.get("analysis"), list):
                    result["analysis"] = [str(result.get("analysis", ""))]
                # Deep-extract patches from any nested field containing "patch" or "diff"
                result["patches"] = _deep_extract_patches(result)
                # Deep-extract risks from any nested field containing "severity" or "risk"
                result["risks"] = _deep_extract_risks(result)
            else:
                result = {"patches": [], "risks": [], "analysis": [str(result)]}

            patch_count = len(result.get("patches", []))
            elapsed = time.time() - t0
            print(f"NEURO: {elapsed:.1f}s, {patch_count} patches generated")

            # Write result to stdout as JSON
            output = {
                "status": "success",
                "elapsed_seconds": round(elapsed, 1),
                "files_analyzed": len(files),
                "patches_generated": patch_count,
                "response": result,
            }
            print(json.dumps(output))

    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8", errors="replace")
        print(json.dumps({"status": "failed", "error": f"HTTP {e.code}: {error_body[:500]}"}))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"status": "failed", "error": str(e)}))
        sys.exit(1)


def _deep_extract_patches(obj, max_depth=3, _depth=0) -> list:
    """Recursively extract git diff patches from any nested field."""
    if _depth > max_depth:
        return []
    patches = []
    if isinstance(obj, dict):
        diff_content = obj.get("diff") or obj.get("patch") or obj.get("hunk") or obj.get("patch_content")
        if diff_content and isinstance(diff_content, str):
            wrapped = _ensure_git_diff_format(obj.get("file", "unknown"), diff_content)
            patches.append({"file": obj.get("file", "unknown"), "diff": wrapped})
        # Also check for nested obj with file + diff
        if "file" in obj and any(k in obj for k in ("diff", "patch", "hunk")):
            pass  # already handled above
        # Recurse into all values
        for key, value in obj.items():
            key_lower = key.lower()
            if key_lower in ("patch", "patches", "diff", "hunk", "fix", "remediation", "findings", "audit_results") or isinstance(value, (dict, list)):
                extracted = _deep_extract_patches(value, max_depth, _depth + 1)
                patches.extend(extracted)
    elif isinstance(obj, list):
        for item in obj:
            extracted = _deep_extract_patches(item, max_depth, _depth + 1)
            if isinstance(item, dict) and not extracted:
                diff = item.get("diff") or item.get("patch") or item.get("hunk")
                if diff:
                    wrapped = _ensure_git_diff_format(item.get("file", "unknown"), diff)
                    patches.append({"file": item.get("file", "unknown"), "diff": wrapped})
            else:
                patches.extend(extracted)
    return patches


def _ensure_git_diff_format(file_path: str, content: str) -> str:
    """Ensure the diff content has proper git diff headers."""
    if content.startswith("diff --git"):
        return content
    if content.startswith("---"):
        return f"diff --git a/{file_path} b/{file_path}\n{content}"
    if content.startswith("@@"):
        return f"diff --git a/{file_path} b/{file_path}\n--- a/{file_path}\n+++ b/{file_path}\n{content}"
    return f"diff --git a/{file_path} b/{file_path}\n--- a/{file_path}\n+++ b/{file_path}\n@@ -1 +1 @@\n{content}"


def _deep_extract_risks(obj, max_depth=3, _depth=0) -> list:
    """Recursively extract risks/findings from any nested field."""
    if _depth > max_depth:
        return []
    risks = []
    if isinstance(obj, dict):
        has_severity = "severity" in obj and isinstance(obj.get("severity"), str)
        has_desc = any(k in obj for k in ("description", "recommendation", "issue"))
        if has_severity and has_desc:
            risks.append({
                "severity": obj.get("severity", "low"),
                "item": obj.get("item", obj.get("type", obj.get("title", "Unknown"))),
                "description": obj.get("description", obj.get("recommendation", "")),
            })
        for value in obj.values():
            if isinstance(value, (dict, list)):
                risks.extend(_deep_extract_risks(value, max_depth, _depth + 1))
    elif isinstance(obj, list):
        for item in obj:
            risks.extend(_deep_extract_risks(item, max_depth, _depth + 1))
    return risks


if __name__ == "__main__":
    main()

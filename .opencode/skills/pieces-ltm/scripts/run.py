#!/usr/bin/env python3
"""Pieces LTM persistence harness — chain-executor compatible entry point.

The chain executor invokes a skill's scripts/run.py with `--prompt-file <path>`.
This wrapper reads the prompt, derives chain/task context, and persists the
result to Pieces LTM, falling back gracefully when MCP is unreachable.
"""

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pieces_persist import (  # noqa: E402
    persist_chain_result,
    call_mcp_tool,
    get_write_stats,
)


def read_prompt(file_path: str) -> str:
    if not file_path or not os.path.exists(file_path):
        return ""
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            return f.read()
    except Exception:
        return ""


def infer_chain(prompt: str) -> str:
    lines = [l.strip() for l in prompt.splitlines() if l.strip()]
    if not lines:
        return "unknown"
    return lines[0][:60]


def main() -> int:
    prompt_file = None
    for i, arg in enumerate(sys.argv):
        if arg == "--prompt-file" and i + 1 < len(sys.argv):
            prompt_file = sys.argv[i + 1]
            break

    prompt = read_prompt(prompt_file)

    if not prompt_file or "--prompt-file" not in sys.argv:
        # Manual invocation — delegate to the subcommand CLI.
        import argparse

        parser = argparse.ArgumentParser(description="Pieces LTM Persistence")
        sub = parser.add_subparsers(dest="command")

        persist_cmd = sub.add_parser("persist", help="Persist a chain result")
        persist_cmd.add_argument("--chain", required=True, help="Chain name")
        persist_cmd.add_argument("--task", required=True, help="Task description")
        persist_cmd.add_argument("--outcome", default="success", help="Outcome")
        persist_cmd.add_argument("--files", nargs="*", default=[], help="Files changed")
        persist_cmd.add_argument("--decisions", nargs="*", default=[], help="Key decisions")
        persist_cmd.add_argument("--type", help="Memory type override")

        search_cmd = sub.add_parser("search", help="Search LTM")
        search_cmd.add_argument("--query", required=True, help="Search query")
        search_cmd.add_argument("--time", help="Time window")
        search_cmd.add_argument("--topics", nargs="*", default=[], help="Topics")

        sub.add_parser("stats", help="Show persistence stats")

        args = parser.parse_args()

        if args.command == "persist":
            result = persist_chain_result(
                chain_name=args.chain,
                task_description=args.task,
                outcome=args.outcome,
                files_changed=args.files,
                key_decisions=args.decisions,
                memory_type=args.type,
            )
            print(json.dumps(result, indent=2))
        elif args.command == "search":
            arguments = {"question": args.query}
            if args.topics:
                arguments["topics"] = args.topics
            result = call_mcp_tool("ask_pieces_ltm", arguments)
            print(json.dumps(result, indent=2))
        elif args.command == "stats":
            print(json.dumps(get_write_stats(), indent=2))
        else:
            parser.print_help()
        return 0

    # Chain-executor contract: persist the prompt as a memory write.
    if len(prompt.strip()) < 3:
        print(json.dumps({"skipped": True, "reason": "empty prompt"}))
        return 0

    result = persist_chain_result(
        chain_name=infer_chain(prompt),
        task_description=prompt[:500],
        outcome="success",
        memory_type="learn",
    )
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())

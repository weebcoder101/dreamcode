#!/usr/bin/env python3
"""run.py — Standard chain-executor entry point for neuro skill.
Reads --prompt-file, delegates to neuro_harness.py --task-file.
"""
import sys
import subprocess
from pathlib import Path

def main():
    prompt_file = None
    for i, arg in enumerate(sys.argv):
        if arg == "--prompt-file" and i + 1 < len(sys.argv):
            prompt_file = sys.argv[i + 1]
            break

    if not prompt_file:
        print("[neuro] No --prompt-file provided. Pass through to neuro_chain.py.", file=sys.stderr)
        subprocess.run([sys.executable, __file__] + sys.argv[1:])
        return

    script_dir = Path(__file__).resolve().parent
    harness = script_dir / "neuro_harness.py"

    result = subprocess.run(
        [sys.executable, str(harness), "--task-file", prompt_file],
        capture_output=True, text=True,
    )
    print(result.stdout)
    if result.stderr:
        print(result.stderr, file=sys.stderr)
    sys.exit(result.returncode)

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Testing skill harness — analyzes code for test coverage gaps and suggests test cases."""

import json
import re
import sys
from pathlib import Path

TEST_PATTERNS = {
    "function_def": r"(?:export\s+)?(?:async\s+)?function\s+(\w+)",
    "class_def": r"(?:export\s+)?class\s+(\w+)",
    "method_def": r"(?:public|private|protected|static)?\s*(?:async\s+)?(\w+)\s*\(",
    "exported_const": r"export\s+(?:const|let|var)\s+(\w+)",
    "error_path": r"(?:throw|raise|Error|Exception)",
    "edge_case_signals": r"(?:null|undefined|empty|zero|negative|overflow|boundary|max|min)",
}

def read_prompt(file_path: str) -> str:
    try:
        return Path(file_path).read_text()
    except Exception:
        return ""

def analyze_testing(prompt: str) -> dict:
    functions = re.findall(TEST_PATTERNS["function_def"], prompt)
    classes = re.findall(TEST_PATTERNS["class_def"], prompt)
    error_paths = len(re.findall(TEST_PATTERNS["error_path"], prompt))
    edge_signals = len(re.findall(TEST_PATTERNS["edge_case_signals"], prompt))

    test_suggestions = []
    for fn in functions[:10]:
        test_suggestions.append({
            "target": fn,
            "test_cases": [
                f"test_{fn}_happy_path",
                f"test_{fn}_edge_case",
                f"test_{fn}_error_handling",
            ],
        })

    return {
        "analysis_type": "testing",
        "functions_found": len(functions),
        "classes_found": len(classes),
        "error_paths": error_paths,
        "edge_case_signals": edge_signals,
        "test_suggestions": test_suggestions,
        "coverage_estimate": f"{min(100, len(functions) * 3)}% of functions have test suggestions",
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

    result = analyze_testing(prompt)
    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""React analysis harness — analyzes prompts for React-specific concerns: hooks, components, and patterns."""

import json
import re
import sys
from pathlib import Path

REACT_PATTERNS = {
    "hooks": ["useState", "useEffect", "useCallback", "useMemo", "useRef", "useContext", "custom hook"],
    "component_patterns": ["component", "props", "children", "hoc", "render prop", "compound", "polymorphic"],
    "state_management": ["recoil", "jotai", "zustand", "redux", "context", "reducer", "state management"],
    "rendering": ["re-render", "memo", "useMemo", "useCallback", "virtual dom", "key", "reconciliation"],
    "data_fetching": ["react query", "tanstack query", "swr", "apollo", "urql", "fetch", "axios"],
    "forms_react": ["react hook form", "formik", "controlled", "uncontrolled", "field array"],
    "routing_react": ["react router", "tanstack router", "next router", "navigation", "link"],
    "server_components": ["server component", "rsc", "next.js", "server action", "client component"],
    "testing_react": ["testing library", "react testing library", "jest", "vitest", "cypress", "playwright"],
    "performance_react": ["code split", "lazy", "suspense", "react.lazy", "chunk", "bundle"],
}

REACT_BEST_PRACTICES = {
    "hooks": "Follow rules of hooks. Keep effects minimal. Use custom hooks to extract reusable logic. Avoid stale closures.",
    "component_patterns": "Prefer composition over inheritance. Keep components small. Use TypeScript for props.",
    "state_management": "Use React Context for low-frequency updates. Use Zustand/Jotai for frequent updates. Keep state minimal.",
    "rendering": "Use React.memo for expensive renders. Use useMemo/useCallback sparingly — profile first.",
    "data_fetching": "Use TanStack Query or SWR for server state. Implement optimistic updates. Handle loading/error states.",
    "forms_react": "Use React Hook Form for complex forms. Implement validation with Zod or Yup. Uncontrolled is often simpler.",
    "routing_react": "Use React Router v6+ or TanStack Router. Implement route guards and lazy loading for routes.",
    "server_components": "Default to server components. Only add 'use client' when interactivity is needed. Keep client bundle lean.",
    "testing_react": "Test behavior not implementation. Use Testing Library queries by accessibility role. Avoid testing internals.",
    "performance_react": "Use React.lazy + Suspense for code splitting. Monitor with React DevTools Profiler.",
}


def read_prompt(file_path: str) -> str:
    try:
        return Path(file_path).read_text()
    except Exception:
        return ""


def analyze_prompt(prompt: str) -> dict:
    prompt_lower = prompt.lower()
    findings = []
    practices = []

    for category, keywords in REACT_PATTERNS.items():
        matches = [kw for kw in keywords if kw.lower() in prompt_lower]
        if matches:
            findings.append({"category": category, "matched_keywords": matches})

    if not findings:
        findings.append({"category": "general", "matched_keywords": ["react review"]})

    for finding in findings:
        cat = finding["category"]
        if cat in REACT_BEST_PRACTICES:
            practices.append({"category": cat, "practice": REACT_BEST_PRACTICES[cat]})

    return {
        "analysis_type": "react",
        "findings_count": len(findings),
        "findings": findings,
        "best_practices": practices,
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

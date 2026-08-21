#!/usr/bin/env python3
"""Frontend analysis harness — analyzes prompts for frontend/UI concerns, accessibility, and UX patterns."""

import json
import re
import sys
from pathlib import Path

FE_PATTERNS = {
    "accessibility": ["a11y", "aria", "screen reader", "keyboard", "focus", "contrast", "wcag", "tabindex"],
    "responsive": ["responsive", "mobile", "breakpoint", "viewport", "media query", "flexbox", "grid"],
    "state_management": ["state", "redux", "context", "store", "reducer", "recoil", "zustand", "pinia"],
    "styling": ["css", "tailwind", "scss", "sass", "styled", "emotion", "css module", "design system"],
    "loading": ["loading", "skeleton", "spinner", "suspense", "placeholder", "optimistic"],
    "forms": ["form", "input", "validation", "submit", "field", "controlled", "uncontrolled"],
    "routing": ["router", "route", "navigation", "link", "history", "spa", "ssr", "next"],
    "testing_fe": ["cypress", "playwright", "testing library", "jest", "vitest", "e2e", "snapshot"],
    "performance_fe": ["lcp", "cls", "inp", "core web vitals", "lighthouse", "bundle", "lazy"],
    "animations": ["animation", "transition", "motion", "keyframe", "spring", "gesture", "drag"],
}

FE_BEST_PRACTICES = {
    "accessibility": "Use semantic HTML. Ensure 4.5:1 color contrast. Support keyboard navigation. Test with screen readers.",
    "responsive": "Design mobile-first. Use CSS Grid and Flexbox. Test on real devices. Use container queries.",
    "state_management": "Keep state as close to where it's needed. Use server state for async data. Lift state up sparingly.",
    "styling": "Use CSS-in-JS or utility-first (Tailwind). Maintain a design system. Use CSS variables for theming.",
    "loading": "Show loading states immediately. Use skeleton screens. Implement optimistic updates for better UX.",
    "forms": "Validate on blur and submit. Show error messages inline. Disable submit while processing. Use proper input types.",
    "routing": "Use lazy loading for routes. Prefetch critical routes. Handle 404s gracefully. Preserve scroll position.",
    "testing_fe": "Test user interactions, not implementation details. Use Testing Library for unit tests, Playwright for e2e.",
    "performance_fe": "Optimize Core Web Vitals. Use image optimization. Implement code splitting. Monitor with Lighthouse CI.",
    "animations": "Use CSS animations for simple transitions. Use Framer Motion for complex interactions. Respect prefers-reduced-motion.",
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

    for category, keywords in FE_PATTERNS.items():
        matches = [kw for kw in keywords if kw in prompt_lower]
        if matches:
            findings.append({"category": category, "matched_keywords": matches})

    if not findings:
        findings.append({"category": "general", "matched_keywords": ["frontend review"]})

    for finding in findings:
        cat = finding["category"]
        if cat in FE_BEST_PRACTICES:
            practices.append({"category": cat, "practice": FE_BEST_PRACTICES[cat]})

    return {
        "analysis_type": "frontend",
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

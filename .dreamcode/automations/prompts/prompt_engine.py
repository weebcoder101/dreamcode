"""NeuroPromptEngine - Builds context-aware prompts for NEURO analysis."""

from pathlib import Path
from typing import Any


class NeuroPromptEngine:
    """Builds prompts for NEURO AI architecture review."""

    SYSTEM_PROMPTS = {
        "full_audit": """You are an expert software architect reviewing a codebase.
Analyze the provided code for:
1. Architecture issues and anti-patterns
2. Security vulnerabilities
3. Performance bottlenecks
4. Code quality and maintainability
5. Testing gaps

Provide specific, actionable recommendations with file:line references.""",

        "security": """You are a security expert reviewing code for vulnerabilities.
Focus on:
1. OWASP Top 10 vulnerabilities
2. Authentication/authorization flaws
3. Input validation issues
4. Secret/credential exposure
5. Dependency vulnerabilities

Provide specific fixes with code examples.""",

        "bug_hunt": """You are a debugging expert analyzing code for bugs.
Focus on:
1. Logic errors and edge cases
2. Race conditions
3. Memory leaks
4. Error handling gaps
5. Type safety issues

Provide specific fixes with file:line references.""",

        "test_gap": """You are a testing expert analyzing code coverage gaps.
Focus on:
1. Missing unit tests
2. Integration test gaps
3. Edge cases not covered
4. Error path testing
5. Performance testing needs

Provide specific test cases with examples.""",
    }

    def build(self, scan_type: str, files: list[dict], context: str = "") -> dict[str, Any]:
        """Build a prompt for NEURO analysis."""
        system_prompt = self.SYSTEM_PROMPTS.get(scan_type, self.SYSTEM_PROMPTS["full_audit"])

        file_contents = []
        for f in files:
            path = f.get("path", "unknown")
            content = f.get("content", "")
            file_contents.append(f"## File: {path}\n```\n{content}\n```")

        user_prompt = f"Analyze the following code:\n\n{chr(10).join(file_contents)}"
        if context:
            user_prompt += f"\n\nAdditional context: {context}"

        estimated_tokens = len(system_prompt.split()) + len(user_prompt.split())

        return {
            "system_prompt": system_prompt,
            "user_prompt": user_prompt,
            "estimated_tokens": estimated_tokens,
            "scan_type": scan_type,
            "file_count": len(files),
        }

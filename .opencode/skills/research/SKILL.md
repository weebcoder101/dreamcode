---
name: research
description: "Systematic research methodology for investigating topics, exploring codebases, and gathering information. Use when researching unknown topics, exploring new code, or gathering evidence."
chains_with:
  - documentation
  - automated-learning
---

# Research Skill — Find the Truth, Fast

## Process

### Step 1: Define the Question
- What exactly do I need to know?
- What would constitute "done" for this research?
- What's the minimum information needed to proceed?

### Step 2: Search Strategy

#### Codebase Research
```bash
# 1. Find relevant files
grep -r "keyword" --include="*.py" src/

# 2. Read imports for dependencies
head -20 src/project_q/module/file.py

# 3. Read function signatures
grep -n "^def " src/project_q/module/file.py

# 4. Read core logic
# Use Read tool with offset on the target functions

# 5. Check tests for examples
grep -n "def test_" tests/test_related.py
```

#### External Research

| Source | Tool | Use Case |
|--------|------|----------|
| Web | `pieces_web_search` | General knowledge, docs |
| Academic | `pieces_web_search` with search_mode=academic | Papers, theory |
| Documentation | `webfetch` | API docs, guides |
| GitHub | `github_search_code` | Reference implementations |
| Memory | `pieces_search_memory` | Historical context, discussions |

### Step 3: Gather Evidence

1. Collect ALL relevant pieces before forming conclusions
2. Note contradictions — don't ignore inconvenient data
3. Record sources (file paths, URLs, timestamps)
4. Rate confidence: high / medium / low for each finding

### Step 4: Synthesize

Answer the original question with:
- Direct answer (one sentence)
- Supporting evidence (2-3 key findings)
- Confidence level
- Gaps / what's still unknown

## Exploration Patterns

### Pattern 1: Trace a Data Flow
```
Input → function A → intermediate → function B → output
1. Find the entry point (API route, CLI command)
2. Read the handler
3. Follow dependencies inward
4. Map the transformations
5. Find where data is persisted
```

### Pattern 2: Understand a Module
```
1. Read the module `__init__.py` (public API)
2. Read the class/function signatures
3. Read the docstrings
4. Read the tests
5. Read the core logic
6. Read the usage sites
```

### Pattern 3: Debug Unfamiliar Code
```
1. What does this code do? (read docstring + tests)
2. What SHOULD it do? (user's intent)
3. Where's the gap?
4. Binary search through the call stack
```

## Research Ethics
- Cite your sources
- Don't fabricate evidence
- Say "I don't know" when evidence is insufficient
- Separate facts from interpretation
- Update conclusions when new evidence arrives

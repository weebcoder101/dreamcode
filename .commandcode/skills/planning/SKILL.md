---
name: planning
description: "Systematic project planning and task decomposition. Use when starting a new feature, refactoring, debugging, or any multi-step task. Provides structured thinking frameworks, spec-first analysis, and staged implementation plans."
chains_with:
  - architecture
  - automated-learning
---

# Planning Skill — Think Before You Code

## Mandate

Before writing ANY code for a non-trivial task, you MUST produce a plan. This skill provides the frameworks for doing that effectively.

## Trigger Conditions

Fire this skill when:
- User asks for a "plan" or "approach"
- Task involves 3+ files or 100+ lines of changes
- Task is ambiguous or underspecified
- User says "how should I..." or "what's the best way to..."
- Architectural decision is required

## Process

### Step 1: Requirements Clarification (2 min max)

- State your understanding in 2-3 sentences
- List 3-5 explicit requirements from the prompt
- List 2-3 assumptions you're making
- Ask 1 clarifying question if critical, otherwise proceed

### Step 2: Impact Analysis

- Files that will be read (existing code to understand)
- Files that will be created
- Files that will be modified
- Files that will be deleted
- Dependencies affected
- Tests that need updating

### Step 3: Implementation Plan

Format as a numbered step-by-step plan:

```markdown
## Plan

### Phase 1: Foundation
1. [Action] → [Expected outcome]
2. [Action] → [Expected outcome]

### Phase 2: Core
3. [Action] → [Expected outcome]

### Phase 3: Polish
4. [Action] → [Expected outcome]
5. [Action] → [Expected outcome]

### Validation
- Test command: `...`
- Lint command: `...`
- Manual check: ...
```

### Step 4: Risk Assessment

- **What could break**: Side effects of changes
- **Mitigation**: How to minimize damage
- **Rollback**: How to undo if needed

### Step 5: Present & Wait

Show the plan to the user. Wait for confirmation before executing.

## Templates

### Bug Fix Template
```
Root Cause: [one sentence]
Fix Strategy: [one sentence]
Files: [list]
Test: [command to verify]
```

### Feature Template
```
Goal: [one sentence]
Users: [who benefits]
Success: [how we know it works]
Components: [list new/modified]
Data Flow: [input → process → output]
```

## Anti-Patterns

- ❌ Planning in your head while coding
- ❌ Starting implementation without impact analysis
- ❌ Skipping test consideration
- ❌ Vague plans ("implement the feature")
- ❌ Ignoring rollback strategy for risky changes

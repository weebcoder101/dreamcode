---
name: product
description: "Product-oriented thinking for understanding user needs, prioritizing features, and designing solutions. Use when the task involves product decisions, feature prioritization, or understanding user impact."
chains_with:
  - planning
  - communication
---

# Product Thinking Skill — Build What Matters

## Framework

### 1. Define the Problem
What user problem does this solve?

```
Current behavior: [what happens now]
Pain point: [what's wrong with it]
Desired behavior: [what should happen]
Success metric: [how we measure it's fixed]
```

### 2. Prioritize

| Factor | Weight | Score (1-5) |
|--------|--------|-------------|
| User impact | 3x | |
| Business value | 2x | |
| Effort (inverse) | 2x | |
| Risk | 1x | |
| Dependencies | 1x | |

### 3. Solution Sketch

Before writing code, sketch the solution:
- User flow: what does the user see/do?
- Data flow: how does data move?
- Error states: what happens when things go wrong?
- Edge cases: what are the boundaries?

## Feature Specification Template

```markdown
## Feature: [Name]

### User Story
As a [type of user], I want to [action] so that [benefit].

### Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

### Design
[Link to mockups or describe UI]

### Data Model
[Fields, types, constraints]

### API
[Endpoint, method, params, response]

### Error States
- What happens if input is invalid?
- What happens if backend is down?
- What happens if user has no permission?

### Out of Scope
- What we're NOT doing (explicitly)
```

## Principles

1. **Start with the user**: Every feature should trace to a user need
2. **Scope ruthlessly**: The best feature is the one that ships
3. **Measure everything**: If you can't measure it, you can't improve it
4. **Fail fast**: Test assumptions with the smallest possible experiment
5. **Iterate**: v1 is better than v0.5. Ship and improve.
6. **Say no**: More features ≠ better product

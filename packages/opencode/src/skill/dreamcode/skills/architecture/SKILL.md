---
name: architecture
description: "Architectural design, system patterns, and dependency management. Use when designing new modules, refactoring existing systems, or making architectural decisions. Covers layering, coupling, cohesion, and design patterns."
chains_with:
  - neuro
  - code-hardener
---

# Architecture Skill — Design Before Build

## Mandate

Every architectural decision must be explicit, documented, and justified. Do not make implicit architectural choices.

## Trigger Conditions

- New module or subsystem
- Cross-cutting concerns
- API or data contract design
- Performance-sensitive architecture
- Security architecture
- Refactoring existing architecture
- Dependency management

## Core Principles

### 1. Separation of Concerns
- One module = one responsibility
- Business logic isolated from infrastructure
- Data access isolated from presentation
- Configuration externalized

### 2. Dependency Rule
- Dependencies point INWARD (toward business logic)
- Outer layers depend on inner layers
- Never the reverse

### 3. API Design First
- Define contracts before implementation
- API is a contract, not an implementation detail
- Version from day one
- Document all endpoints with request/response schemas

### 4. Data Flow Clarity
- Every data flow has a clear source, path, and sink
- No hidden side effects
- Transformations are explicit and testable

## Evaluation Checklist

Before approving any architecture:

- [ ] Each module has a single, named responsibility
- [ ] Dependencies form a DAG (no cycles)
- [ ] Public API is minimal and documented
- [ ] Private implementation is hidden
- [ ] Configuration is externalized
- [ ] Error handling is designed (not an afterthought)
- [ ] Testing strategy is defined
- [ ] Performance characteristics are understood
- [ ] Security boundaries are identified
- [ ] Scalability limits are documented

## Patterns Library

### When to Use Each

| Pattern | Use Case | Example |
|---------|----------|---------|
| Repository | Data access abstraction | Portfolio repository |
| Factory | Complex object creation | Model factory |
| Strategy | Interchangeable algorithms | Risk calculation |
| Observer | Event-driven updates | Market data feed |
| Adapter | Third-party integration | External API wrapper |
| Decorator | Cross-cutting behavior | Logging, caching |
| Pipeline | Sequential processing | Data transformation |
| Bridge | Platform abstraction | Quantum backend abstraction |

## Anti-Patterns to Flag

- **God Module**: A module that does everything
- **Circular Dependency**: A → B → A
- **Leaky Abstraction**: Internal details visible in the API
- **Shotgun Surgery**: One change requires edits everywhere
- **Feature Envy**: Module A uses more of B's data than its own
- **Premature Optimization**: Complex architecture before it's needed

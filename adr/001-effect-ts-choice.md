# ADR-001: Effect-TS as Core Runtime

## Status
Accepted

## Context
The codebase needs a consistent approach to async operations, error handling, dependency injection, and service composition. The project has complex requirements:
- Typed errors with exhaustive matching
- Service dependency injection for testing and composition
- Structured concurrency with fiber management
- Schema validation and transformation

## Decision
Use Effect-TS as the core runtime for all new code. This provides:
- `Effect.gen` for composable async operations
- `Context.Service` for dependency injection
- `Schema` for runtime type validation
- `Layer` for service composition and testing
- `Fiber` for structured concurrency

## Consequences
- **Positive**: Type-safe error handling, testable services via Layer.mock, consistent async patterns
- **Positive**: Strong ecosystem with Schema, Platform, and SQL packages
- **Negative**: Learning curve for contributors unfamiliar with Effect
- **Negative**: Some patterns (like the TurnTransitionError defect channel) require careful design

## References
- packages/core/src/session/runner/llm.ts:144-167 (TurnTransitionError pattern)
- packages/core/src/effect/ (Effect utilities)

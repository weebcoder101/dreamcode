# ADR-003: Location-Scoped Services

## Status
Accepted

## Context
The application needs to support multiple open projects simultaneously, each with its own:
- Configuration
- Database state
- File system access
- Provider credentials

Services need to be scoped to a specific project directory to avoid cross-project contamination.

## Decision
Use `LocationServiceMap` with `LayerMap` for location-scoped services:
- Each project directory gets its own service instance
- Services are keyed by directory path
- `InstanceState` uses `ScopedCache` for automatic cleanup
- `Effect.forkScoped` manages background fibers per instance

This ensures:
- Services are automatically cleaned up when projects are closed
- No shared state between different projects
- Test isolation via in-memory instances

## Consequences
- **Positive**: Clean project isolation
- **Positive**: Automatic cleanup on project close
- **Positive**: Testable via mock instances
- **Negative**: More complex service composition than singleton services
- **Negative**: Need to pass location context through service boundaries

## References
- packages/core/src/location-layer.ts (service composition)
- packages/core/src/effect/instance-state.ts (per-instance state)
- packages/core/src/effect/layer-node.ts (dependency graph)

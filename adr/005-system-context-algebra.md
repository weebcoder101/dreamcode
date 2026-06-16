# ADR-005: System Context Algebra (Source<A>)

## Status
Accepted

## Context
The system context needs to combine multiple sources of information:
- Agent system prompts
- Skill guidance
- Reference documentation
- Project configuration
- User preferences

These sources can be:
- Ready (content available)
- Blocked (waiting for external data)
- Replacement (new version available)

## Decision
Use `Source<A>` algebra with:
- `ReplacementReady`: New content available, replace current
- `ReplacementBlocked`: Waiting for external data, keep current
- `Unchanged`: No changes needed

This provides:
- Clean composition of multiple context sources
- Proper handling of partial updates
- Durable snapshots for crash recovery
- Chronological reconciliation of concurrent updates

## Consequences
- **Positive**: Clean separation of context concerns
- **Positive**: Proper handling of async context updates
- **Positive**: Testable via mock sources
- **Negative**: More complex than simple string concatenation
- **Negative**: Need to understand the algebra pattern

## References
- packages/core/src/system-context/ (SystemContext implementation)
- packages/core/src/session/context-epoch.ts (context management)

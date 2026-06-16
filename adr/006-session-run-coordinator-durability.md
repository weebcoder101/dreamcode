# ADR-006: Session Run Coordinator Durability Gap

## Status
Accepted (with known limitation)

## Context
The session run coordinator manages:
- Active drain state per session
- Interruption sequence numbers
- Fiber handles for background operations

This state is purely in-memory and lost on process crash.

## Decision
Accept the in-memory coordinator as a temporary solution with:
- Documented single-process assumption
- Clear acknowledgment in code comments
- Future migration path to durable ownership

The coordinator is designed for:
- Local development and single-user scenarios
- Process-local session management
- Simple restart recovery via event replay

## Consequences
- **Positive**: Simple implementation
- **Positive**: Fast in-memory operations
- **Positive**: Clean separation from durable state
- **Negative**: Process crash loses active drain state
- **Negative**: No multi-process clustering support
- **Negative**: Need to handle state recovery on restart

## Future Work
- Implement durable lease-based ownership
- Add cluster support with distributed locks
- Implement state migration on process restart

## References
- packages/core/src/session/run-coordinator.ts (coordinator implementation)
- packages/core/src/session/runner/index.ts (runner integration)
- specs/v2/session.md:44 (documented limitation)

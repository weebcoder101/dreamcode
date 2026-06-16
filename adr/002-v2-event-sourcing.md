# ADR-002: Session V2 Event Sourcing

## Status
Accepted

## Context
The session system needs to support:
- Durable session state that survives process crashes
- Event replay for UI reconstruction
- Concurrent access from multiple clients
- Compaction for long sessions

## Decision
Implement V2 event sourcing with:
1. **Durable admission**: Session inputs are written to SQLite before processing
2. **In-memory coordinator**: Process-local state machine manages active drains
3. **Provider-turn drain**: Each provider turn processes one LLM interaction
4. **Event replay**: UI reconstructs state from event stream

This is a CQRS pattern where:
- Commands (prompts, tool calls) are durably stored
- Queries (UI state) are derived from events
- The coordinator manages consistency within a single process

## Consequences
- **Positive**: Crash recovery via event replay
- **Positive**: Clean separation of read/write concerns
- **Positive**: Testable via in-memory SQLite per test suite
- **Negative**: In-memory coordinator loses state on process crash (documented limitation)
- **Negative**: No multi-process clustering support yet

## References
- packages/core/src/session/ (V2 session implementation)
- packages/core/src/session/run-coordinator.ts (in-memory coordinator)
- specs/v2/session.md (design documentation)

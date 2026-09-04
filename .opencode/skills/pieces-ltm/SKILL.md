---
name: pieces-ltm
description: >
  Pieces Long-Term Memory integration skill. Auto-persists memories after
  every skill chain, improves retrieval quality, and provides a Python
  wrapper for the Pieces MCP tools. Use after every non-trivial operation
  to ensure context is never lost.
category: META
chains_with:
  - automated-learning
triggers:
  - pieces
  - ltm
  - memory
  - remember
  - context
---

# Pieces LTM Skill

## Purpose

Ensures every skill chain result is persisted to Pieces LTM, and provides
improved retrieval patterns for future context queries.

## Health Check

Pieces LTM persistence degrades gracefully. If `PIECES_MCP_URL` is unreachable, the write is logged to `evolution/pieces_writes.jsonl` and the orchestrator continues without LTM. No health-check call is required before use; the `call_mcp_tool` helper transparently falls back to the log on connection error.

## Architecture

```
Skill Chain Output → [Health Check] → pieces-ltm → Pieces MCP → LTM Storage
                         ↓ ↓                           ↓
              Unreachable? → Warn user          Auto-classify
                         ↓                           ↓
              Continue without LTM         Write with structured metadata
                                                    ↓
                                        Future queries hit LTM with rich context
```

## Auto-Persistence Rules (MANDATORY)

**Enforcement:** Every non-trivial chain (4+ skills fired, 1+ files modified) MUST persist to Pieces LTM. Analysis of 74 chain executions shows only 6 writes — this is a critical gap.

### Primary: TypeScript Effect Service (recommended)

The opencode runtime provides `PiecesLTM.Service` (`@dreamcode/PiecesLTM`) with:
- `persist(input)` — structured memory write with retry + timeout
- `query(input)` — semantic LTM search with 60s TTL cache
- `health()` — health check probe for `localhost:39302`

This service replaces the Python subprocess approach. It uses `HttpClient` with:
- Exponential backoff retry (500ms base, 2 attempts)
- 30-second request timeout
- Graceful degradation when Pieces is unavailable

```typescript
import { PiecesLTM } from "@/pieces-ltm"

yield* PiecesLTM.Service.persist({
  chainName: "neuro → code-hardener → lint-fixer",
  taskDescription: "Fixed numpy bool_ serialization in Monte Carlo",
  outcome: "success",
  filesChanged: ["src/project_q/monte_carlo.py"],
  keyDecisions: ["Added custom JSON encoder for numpy types"],
  metrics: { tokens_used: 12000, iterations: 10 },
  memoryType: "bugfix",
})
```

### Fallback: Python Script (legacy)

When the Effect service is unavailable, the Python `pieces_persist.py` script provides equivalent functionality:

```python
from scripts.pieces_persist import persist_chain_result

persist_chain_result(
    chain_name="neuro → code-hardener → lint-fixer",
    task_description="Fixed numpy bool_ serialization in Monte Carlo",
    outcome="success",
    files_changed=["src/project_q/monte_carlo.py"],
    key_decisions=["Added custom JSON encoder for numpy types"],
    metrics={"tokens_used": 12000, "iterations": 10},
)
```

Note: The Python path uses raw `urllib.request` — no retry, no timeout, no circuit breaker. Prefer the Effect service when running inside the opencode runtime.

**Mandatory Persistence Check (in automated-learning post-step):**
The Learning Note MUST include `"pieces_written": true | false`. If false, flag it as a violation in `evolution/violations.log` and append a corrective entry to `evolution/pieces_writes.jsonl` explaining why persistence was skipped.

## Memory Types

| Type | When to Persist | Retention |
|------|----------------|-----------|
| `standup` | Daily progress | 30 days |
| `decision` | Architecture/design choice | Permanent |
| `breakthrough` | Novel solution found | Permanent |
| `bugfix` | Bug resolved after effort | 90 days |
| `learn` | Pattern discovered | Permanent |
| `incident` | Production issue | Permanent |

## Retrieval Patterns

### Pattern 0: Post-Compaction Context Recovery (CRITICAL)
After a compaction event, the agent MUST recover task context before continuing:
```python
# Check disk-first for resume plan (always available)
resume_plan = read_file(".opencode/session/resume-plan.json")
if resume_plan:
    print("RESUMING task from pre-compaction snapshot")
    
# ALSO query Pieces LTM with dreamcode-scoped query (if available)
search(query="what were we working on inside dreamcode before compaction", topics=["dreamcode", "opencode"])
```
The key difference: query is scoped to **dreamcode/opencode** project context, NOT generic personal questions.

### Pattern 1: Recent Context
```python
# "What did I work on this week?"
search(query="work summary", time_window="this week")
```

### Pattern 2: Topic Deep-Dive
```python
# "Tell me about the Monte Carlo implementation"
search(query="Monte Carlo implementation", topics=["quantum", "risk"])
```

### Pattern 3: Decision History
```python
# "Why did we choose Flask over FastAPI?"
search(query="Flask FastAPI decision", type="decision")
```

### Pattern 4: Bug History
```python
# "Have we seen this numpy error before?"
search(query="numpy bool_ serialization error", type="bugfix")
```

## Integration with Skill Chains

Every skill chain should end with:

```python
# After chain completes
persist_chain_result(
    chain_name=chain_output.chain_name,
    task_description=user_prompt,
    outcome="success" if chain_output.success else "failed",
    files_changed=chain_output.files_modified,
    key_decisions=chain_output.decisions,
    metrics={
        "tokens_used": chain_output.tokens,
        "iterations": chain_output.iterations,
        "models_used": chain_output.models,
    },
)
```

## MCP Tools Used

| Tool | Purpose |
|------|---------|
| `ask_pieces_ltm` | Query LTM for context |
| `create_pieces_memory` | Persist new memories |
| `search_memory` | Search across memories |

## Self-Evolution

After every persistence:
1. Log the write to `evolution/pieces_writes.jsonl`
2. Track what types of memories are most queried
3. Optimize persistence rules based on retrieval patterns

## References

- Pieces MCP: `http://localhost:39302/model_context_protocol/2024-11-05/sse`
- Pieces App: https://pieces.app
- MCP Protocol: https://modelcontextprotocol.io

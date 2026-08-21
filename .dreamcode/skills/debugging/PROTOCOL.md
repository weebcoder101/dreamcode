
## Protocol: LSP-First, Cheapest Validation First (MANDATORY)

Follow the tool ladder — never skip levels. Each rung is cheaper than the one below.

### Tool Ladder (cost-weighted)
1. **lsp** (~50ms): goToDefinition, findReferences, callHierarchy, typeDefinition, documentHighlight — ALWAYS first for symbol questions. grep hits are 92-99% false positives.
2. **relations** (~1-3s): whoProvides, consumersOf, dependentsOf, reverseImports, circular — for import-graph / blast-radius questions ("who imports this file?", "what breaks if I change X?").
3. **grep/glob** (~1-3s): text patterns, broad discovery.
4. **read** (~10-50ms/file): read the file you have already located.
5. **bash** (~1s+): last resort for code questions.

### Validation Ladder (before ANY expensive command)
State your hypothesis + the CHEAPEST validation that would confirm/refute it. Order:
1. Targeted unit test on the touched module (~5s)
2. Dev-mode run + session-DB assertions (bun run src/index.ts, ~30-60s)
3. Fresh tsc --noEmit / typecheck (invalidate tsbuildinfo first — cached typechecks lie)
4. Full build/compile LAST (only when the failure is suspected in bundling/type-erasure/env-inlining)

A full build after every edit is waste. A build is only justified after the cheap ladder fails to reproduce.

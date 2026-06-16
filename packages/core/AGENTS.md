# Core Package Learnings

## Security

### Dynamic npm Loading
- `plugin/provider/dynamic.ts` accepts arbitrary npm packages for AI SDK providers
- **ALLOWLIST**: Set `AI_SDK_ALLOWED_PACKAGES` env var (comma-separated) to restrict
- Default allowlist: @ai-sdk/openai, @ai-sdk/anthropic, @ai-sdk/google, @ai-sdk/mistral, @ai-sdk/deepseek, @ai-sdk/togetherai, @ai-sdk/groq
- Packages NOT in allowlist will be rejected with error

### Credential Storage
- `credential/sql.ts` stores OAuth tokens/API keys as unencrypted JSON in SQLite
- Any process with filesystem access can extract all credentials
- **TODO**: Implement AES-256-GCM encryption with OS keychain-derived key

## Architecture

### V1/V2 Dual Engine
- `v1/` contains deprecated session/permission schemas
- Still used by projector bridge (session/projector.ts) for backward compatibility
- Session creation at session.ts:212 calls V1 SessionInfo.make() for V2 sessions
- Do NOT remove V1 until projector bridge is migrated to pure V2

### Core Wildcard Exports
- `package.json` has `./*": "./src/*.ts"` exposing ALL internal files
- 45+ consumer subpaths bypass the intended `public/index.ts` boundary
- **DEPRECATED**: Will be removed in future major version
- Migrate consumers to `@opencode-ai/core/public` or `@opencode-ai/core/internal`
- Internal subpath: `@opencode-ai/core/internal` (src/internal/index.ts)

### Effect.die Anti-Pattern
- `session/runner/llm.ts` uses `Effect.die` for TurnTransitionError control flow
- This defeats Effect-TS error tracking (uncatchable by upstream handlers)
- `retryAgentMismatch` uses `Effect.catchDefect` which won't catch error-channel values
- **TODO**: Convert to `Effect.fail` with proper tagged errors when refactoring

### Session Runner Monolith
- `session/runner/llm.ts` is 404 lines handling 6+ concerns
- Context epoch, LLM requests, provider streaming, tool settlement, overflow recovery, step counting
- 55% unchecked checklist items (10 of 18)
- **TODO**: Decompose into TurnOrchestrator, ToolSettlementManager, ContinuationPolicy

### session.ts God-Module
- `session.ts` is 436 lines with 25+ imports
- Mixes listing, CRUD, compaction, search, sharing, logging
- **TODO**: Split into session-crud.ts, session-search.ts, session-compact.ts, session-share.ts

## Testing

### Co-located Tests
- No `.test.ts` files in `src/` - only `test/` directories exist
- Regressions at module level are undetectable without a test pass
- **TODO**: Add unit tests for context-epoch.ts, history.ts, message-updater.ts

### Repository Abstraction
- Drizzle queries embedded directly in service implementations
- No SessionRepository or ProjectRepository interface exists
- **TODO**: Extract repository interfaces for mock-based testing of DB failures

## Type Safety

### any Types
- Concentrated in `github-copilot/responses/` and `plugin/provider/` files
- Examples: ProviderErrorStructure<any>, z.ZodType<any>, Record<string, any>
- **FIXED**: Replaced with unknown + type guards at external API boundaries

### Error Schema
- `github-copilot/responses/openai-error.ts` uses z.any() for provider errors
- **FIXED**: Replaced with z.unknown() + type guards
- Malformed or malicious provider responses bypass all type checking

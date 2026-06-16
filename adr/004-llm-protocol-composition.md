# ADR-004: LLM Protocol Composition

## Status
Accepted

## Context
The LLM package needs to support multiple AI providers (OpenAI, Anthropic, Google, etc.) with:
- Different API protocols (chat, responses, completions)
- Different authentication methods (API keys, OAuth, service accounts)
- Different streaming formats (SSE, WebSocket)
- Shared error handling and retry logic

## Decision
Use protocol composition with:
- `Route = Protocol + Endpoint + Auth + Framing`
- Each provider reuses `OpenAIChat.protocol` as the base
- Provider-specific customization via protocol parameters
- Shared error handling via `ProviderErrorStructure`

This allows:
- DeepSeek, TogetherAI, Cerebras to reuse OpenAIChat.protocol in 5-15 lines
- Clean separation of concerns (transport, auth, serialization)
- Easy addition of new providers

## Consequences
- **Positive**: Minimal code for new OpenAI-compatible providers
- **Positive**: Consistent error handling across providers
- **Positive**: Easy to test individual protocol components
- **Negative**: Need to understand protocol composition pattern
- **Negative**: Some providers need protocol-specific workarounds

## References
- packages/llm/src/ (LLM package implementation)
- packages/core/src/plugin/provider/ (provider implementations)

# Command-specific notes

## In-process server (`run.ts`)

The `dreamcode run` command uses an in-process HTTP server via `Server.Default().app.fetch(request)`. This is DIFFERENT from the `dreamcode serve` command:

- **No real HTTP listener**: The in-process server uses `HttpRouter.toWebHandler` which creates a bare fetch handler. It does NOT expose a TCP port (unless `--port` is explicitly provided, which runs a separate `listen`).
- **No ConfigProvider layer**: Unlike `listenerLayer`, the in-process path doesn't provide `ConfigProvider.layer(ConfigProvider.fromEnv())`. `Config.string(...)` calls use the default (module-level cached) ConfigProvider.
- **No WebSocketTracker, no real HttpServer**: Services depending on these will fail silently.
- **UI catch-all disabled**: The `/*` catch-all route that proxies to `app.dreamcode.ai` is excluded via `createRoutes(undefined, { serveUI: false })`.

**Error surface**: Errors from the in-process server propagate through `causeResponse` (`HttpServerError.ts:283`). If the errorLayer middleware doesn't catch the error (route-level middleware won't catch route-not-found), the framework produces `internalServerError()` — an empty 500 body. This manifests as "Session not found" in the CLI because the SDK receives an unparseable 500 response.

**SDK fetch adapter**: The `fetchFn` at `run.ts:875` wraps `Server.Default().app.fetch(request)`. The SDK's `createOpencodeClient({ fetch: fetchFn, directory })` sends `directory` as both `x-opencode-directory` header and `?directory=` query param (GET/HEAD only). This is consumed by `workspaceRoutingLayer` → `defaultDirectory()` at `middleware/workspace-routing.ts:86`.

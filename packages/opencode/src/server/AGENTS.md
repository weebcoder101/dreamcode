# Server Initialization

## Two server paths with different initialization

The opencode server has two distinct initialization paths:

1. **`listen` (real HTTP server)** via `server.ts:72`: Uses `listenEffect` → `startListener` → `Layer.buildWithMemoMap(listenerLayer)`. The `listenerLayer` provides `ConfigProvider.layer(ConfigProvider.fromEnv())`, `WebSocketTracker.layer`, and `NodeHttpServer.layer` on top of `HttpRouter.serve(...)`.

2. **`Server.Default()` (in-process)** via `server.ts:55`: Uses `HttpApiApp.webHandler()` → `HttpRouter.toWebHandler(routes, ...)`. No `ConfigProvider` override, no HTTP server, no WebSocket tracking.

**Service initialization gap**: Services that read `ConfigProvider` (e.g., `Config.string(...)`) or depend on real HTTP server infrastructure will behave differently between the two paths. In the in-process path, `Config` uses the default (module-level cached) `ConfigProvider`, which snapshots `process.env` on first read.

**InstanceRef middleware scope**: `InstanceRef` is provided per-request by `InstanceContextMiddleware` (`middleware/instance-context.ts`), which calls `store.load({ directory })` to bootstrap the instance. The `Config.Service` depends on `InstanceState` which depends on `InstanceRef` via `ScopedCache.makeWith({ requireServicesAt: "lookup" })`. When `InstanceState` is created during layer build (before `InstanceRef` is available), the cache's `lookup` uses `FallbackContext` (`InstanceState.ts:23`) — a default context based on `process.cwd()`.

## toWebHandler layer failure caching

`HttpEffect.toWebHandlerLayerWith` (`HttpEffect.ts:285`) uses a `handlerPromise` that caches the layer build result permanently:
- If the build succeeds → `handlerCache` is set → subsequent calls use cached handler
- If the build fails → `handlerPromise` holds a rejected promise → `handlerCache` is NEVER set → every subsequent call re-throws the same error

There is NO retry mechanism. Process restart is required after a layer build failure.

## Compiled binary in-process server

In `--single` (compiled) mode, `Server.Default()` uses the in-process `HttpApiApp.webHandler()` directly.
The `effectPlugin` in build.ts patches effect dist files during build to fix bun 1.3.x rest-parameter
corruption (`Schema.Union`, `Schema.check`, etc.). These patches ensure Schema codec building works
in the compiled binary.

When adding new handler endpoints that use `handle()`, verify they work in compiled mode;
if they crash with `.encoding`, switch to `handleRaw()` + manual `Schema.decodeUnknownEffect()`.

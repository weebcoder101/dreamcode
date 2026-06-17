import "./init-projectors"

import { spawn } from "child_process"
import { existsSync } from "fs"
import path from "path"
import { NodeHttpServer } from "@effect/platform-node"
import { ConfigProvider, Context, Effect, Exit, Layer, Scope } from "effect"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import { OpenApi } from "effect/unstable/httpapi"
import { createServer } from "node:http"
import { MDNS } from "./mdns"
import { HttpApiApp } from "./routes/instance/httpapi/server"
import { disposeMiddleware } from "./routes/instance/httpapi/lifecycle"
import { WebSocketTracker } from "./routes/instance/httpapi/websocket-tracker"
import { PublicApi } from "./routes/instance/httpapi/public"
import type { CorsOptions } from "./cors"
import { lazy } from "@/util/lazy"

// @ts-ignore This global is needed to prevent ai-sdk from logging warnings to stdout https://github.com/vercel/ai/blob/2dc67e0ef538307f21368db32d5a12345d98831b/packages/ai/src/logger/log-warnings.ts#L85
globalThis.AI_SDK_LOG_WARNINGS = false

export type Listener = {
  hostname: string
  port: number
  url: URL
  stop: (close?: boolean) => Promise<void>
}

type ServerApp = {
  fetch(request: Request): Response | Promise<Response>
  request(input: string | URL | Request, init?: RequestInit): Response | Promise<Response>
}

type ListenOptions = CorsOptions & {
  port: number
  hostname: string
  mdns?: boolean
  mdnsDomain?: string
}
type ListenerState = {
  scope: Scope.Scope
  server: Context.Service.Shape<typeof HttpServer.HttpServer>
  http: ListenerServer
  websockets: WebSocketTracker.Interface
}
type EffectListener = Omit<Listener, "stop"> & {
  stop: (close?: boolean) => Effect.Effect<void>
}

interface ListenerServer {
  readonly closeAll: Effect.Effect<void>
}

class ListenerServerService extends Context.Service<ListenerServerService, ListenerServer>()(
  "@dreamcode/ListenerServer",
) {}

function findServerBundle(): string | undefined {
  const candidates = [
    // Next to the binary (release layout)
    path.join(path.dirname(process.execPath), "opencode-server.js"),
    // Working directory (dev layout)
    path.join(process.cwd(), "opencode-server.js"),
    // Dist relative to project root
    path.join(path.dirname(process.execPath), "..", "..", "opencode-server.js"),
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return
}

export const Default = lazy(() => {
  // bun --compile corrupts effect's Schema AST traversal, making the
  // in-process webHandler crash on any request.  Spawn the server as a
  // plain JS bundle (opencode-server.js) via bun subprocess instead.
  let listener: Listener | undefined

  async function ensureServer(): Promise<Listener> {
    if (listener) return listener

    // Find the server bundle relative to the current binary
    const serverPath = findServerBundle()
    if (!serverPath) {
      throw new Error(
        "Server bundle (opencode-server.js) not found. " +
        "Run with --single or place opencode-server.js next to the binary.",
      )
    }

    return new Promise((resolve, reject) => {
      // The server bundle is a JS file; must spawn via bun
      const child = spawn("bun", [serverPath, "serve", "--port", "0", "--allow-no-auth"], {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, OPENCODE_SERVER_PASSWORD: "" },
      })

      let port: number | undefined
      const onData = (data: Buffer) => {
        const text = data.toString()
        // The server prints "dreamcode server listening on http://X.X.X.X:PORT"
        const match = text.match(/listening on http:\/\/[^:]+:(\d+)/)
        if (match) {
          port = parseInt(match[1], 10)
          const url = new URL("http://localhost")
          url.port = String(port)
          url.hostname = "127.0.0.1"
          listener = {
            hostname: "127.0.0.1",
            port,
            url,
            stop: () => { child.kill(); return Promise.resolve() },
          }
          resolve(listener)
        }
      }
      child.stdout.on("data", onData)
      child.stderr.on("data", (data: Buffer) => process.stderr.write(data))
      child.on("error", reject)
      child.on("exit", (code) => {
        if (!port) reject(new Error(`Server exited with code ${code} before announcing port`))
      })
      setTimeout(() => {
        if (!port) { child.kill(); reject(new Error("Server startup timed out")) }
      }, 30_000)
    })
  }

  const app: ServerApp = {
    fetch: async (request) => {
      try {
        const srv = await ensureServer()
        const url = new URL(request.url)
        url.hostname = "127.0.0.1"
        url.port = String(srv.port)
        try { process.stderr.write("[PROXY] " + request.method + " " + request.url + "\n") } catch {}
        return await fetch(new Request(url, {
          method: request.method,
          headers: request.headers,
          body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
          signal: request.signal,
        }))
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e)
        return new Response(JSON.stringify({ error: "Server unavailable", detail }), {
          status: 503,
          headers: { "content-type": "application/json" },
        })
      }
    },
    request(input, init) {
      return app.fetch(input instanceof Request ? input : new Request(new URL(input, "http://localhost"), init))
    },
  }
  return { app }
})

export async function openapi() {
  return OpenApi.fromApi(PublicApi)
}

export let url: URL

export async function listen(opts: ListenOptions): Promise<Listener> {
  const listener = await Effect.runPromise(listenEffect(opts))
  return {
    hostname: listener.hostname,
    port: listener.port,
    url: listener.url,
    stop: (close?: boolean) => Effect.runPromiseExit(listener.stop(close)).then(() => undefined),
  }
}

const listenEffect: (opts: ListenOptions) => Effect.Effect<EffectListener, unknown> = Effect.fn("Server.listen")(
  function* (opts: ListenOptions) {
    const state = yield* startWithPortFallback(opts)
    const address = yield* tcpAddress(state)
    const listenerUrl = makeURL(opts.hostname, address.port)
    url = listenerUrl

    const unpublishMdns = yield* setupMdns(opts, address.port, state.scope)

    return {
      hostname: opts.hostname,
      port: address.port,
      url: listenerUrl,
      stop: yield* makeStop(state, unpublishMdns),
    }
  },
)

function listenerLayer(opts: ListenOptions, port: number) {
  return HttpRouter.serve(HttpApiApp.createRoutes(opts), {
    middleware: disposeMiddleware,
    disableLogger: true,
    disableListenLog: true,
  }).pipe(
    Layer.provideMerge(WebSocketTracker.layer),
    Layer.provideMerge(serverLayer({ port, hostname: opts.hostname })),
    // Install a fresh `ConfigProvider` per listener so `Config.string(...)`
    // reads reflect the current `process.env`. Effect's default
    // `ConfigProvider` snapshots `process.env` on first read and caches the
    // result on a module-singleton Reference; without overriding it here,
    // every later `Server.listen()` keeps observing that initial snapshot.
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv())),
  )
}

function startWithPortFallback(opts: ListenOptions) {
  if (opts.port !== 0) return startListener(opts, opts.port)
  // Match the legacy listener port-resolution behavior: explicit `0` prefers
  // 4096 first, then any free port.
  return startListener(opts, 4096).pipe(Effect.catch(() => startListener(opts, 0)))
}

function startListener(opts: ListenOptions, port: number) {
  const scope = Scope.makeUnsafe()
  return Layer.buildWithMemoMap(listenerLayer(opts, port), Layer.makeMemoMapUnsafe(), scope).pipe(
    Effect.provide(HttpApiApp.context),
    Effect.onError(() => Scope.close(scope, Exit.void).pipe(Effect.ignore)),
    Effect.map(
      (ctx): ListenerState => ({
        scope,
        server: Context.get(ctx, HttpServer.HttpServer),
        http: Context.get(ctx, ListenerServerService),
        websockets: Context.get(ctx, WebSocketTracker.Service),
      }),
    ),
  )
}

function tcpAddress(state: ListenerState) {
  return Effect.gen(function* () {
    if (state.server.address._tag === "TcpAddress") return state.server.address
    yield* Scope.close(state.scope, Exit.void).pipe(Effect.ignore)
    return yield* Effect.die(new Error(`Unexpected HttpServer address tag: ${state.server.address._tag}`))
  })
}

function makeURL(hostname: string, port: number) {
  const result = new URL("http://localhost")
  result.hostname = hostname
  result.port = String(port)
  return result
}

function setupMdns(opts: ListenOptions, port: number, scope: Scope.Scope) {
  return Effect.gen(function* () {
    const publish =
      opts.mdns && port && opts.hostname !== "127.0.0.1" && opts.hostname !== "localhost" && opts.hostname !== "::1"
    if (publish) {
      const unpublish = yield* Effect.cached(Effect.sync(() => MDNS.unpublish()))
      yield* Effect.sync(() => MDNS.publish(port, opts.mdnsDomain))
      yield* Scope.addFinalizer(scope, unpublish)
      return unpublish
    }
    if (opts.mdns) {
      yield* Effect.logWarning("mDNS enabled but hostname is loopback; skipping mDNS publish")
    }
    return Effect.void
  })
}

function makeStop(state: ListenerState, unpublishMdns: Effect.Effect<void>) {
  return Effect.gen(function* () {
    const forceCloseOnce = yield* Effect.cached(forceClose(state).pipe(Effect.ignore))
    const closeScopeOnce = yield* Effect.cached(Scope.close(state.scope, Exit.void).pipe(Effect.ignore))

    return (close?: boolean) =>
      Effect.gen(function* () {
        yield* unpublishMdns
        if (close) yield* forceCloseOnce
        yield* closeScopeOnce
      })
  })
}

function forceClose(state: ListenerState) {
  return Effect.all([state.http.closeAll, state.websockets.closeAll], { concurrency: "unbounded", discard: true })
}

function serverLayer(opts: { port: number; hostname: string }) {
  const server = createServer()
  const serverRef = { closeStarted: false, forceStop: false }
  const close = server.close.bind(server)
  // Keep shutdown owned by NodeHttpServer, but honor listener.stop(true) by
  // force-closing active HTTP sockets when its finalizer calls server.close().
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- Node's overloads don't preserve a monkey-patched method assignment.
  server.close = ((callback?: Parameters<typeof server.close>[0]) => {
    serverRef.closeStarted = true
    const result = close(callback)
    if (serverRef.forceStop) server.closeAllConnections()
    return result
  }) as typeof server.close

  return Layer.mergeAll(
    NodeHttpServer.layer(() => server, { port: opts.port, host: opts.hostname, gracefulShutdownTimeout: "1 second" }),
    Layer.succeed(ListenerServerService)(
      ListenerServerService.of({
        closeAll: Effect.sync(() => {
          serverRef.forceStop = true
          if (serverRef.closeStarted) server.closeAllConnections()
        }),
      }),
    ),
  )
}

export * as Server from "./server"

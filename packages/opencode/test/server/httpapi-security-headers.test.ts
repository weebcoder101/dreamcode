import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { Flag } from "@opencode-ai/core/flag/flag"
import { describe, expect } from "bun:test"
import { Config, ConfigProvider, Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http"
import * as Socket from "effect/unstable/socket/Socket"
import { InstancePaths } from "../../src/server/routes/instance/httpapi/groups/instance"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { resetDatabase } from "../fixture/db"
import { testEffect } from "../lib/effect"

const testStateLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const original = {
      OPENCODE_SERVER_PASSWORD: Flag.OPENCODE_SERVER_PASSWORD,
    }
    Flag.OPENCODE_SERVER_PASSWORD = "secret"
    yield* Effect.promise(() => resetDatabase())
    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        Flag.OPENCODE_SERVER_PASSWORD = original.OPENCODE_SERVER_PASSWORD
        await resetDatabase()
      }),
    )
  }),
)

const servedRoutes: Layer.Layer<never, Config.ConfigError, HttpServer.HttpServer> = HttpRouter.serve(
  HttpApiApp.routes,
  { disableListenLog: true, disableLogger: true },
)

const it = testEffect(
  Layer.mergeAll(
    testStateLayer,
    servedRoutes.pipe(
      Layer.provide(Socket.layerWebSocketConstructorGlobal),
      Layer.provideMerge(NodeHttpServer.layerTest),
      Layer.provideMerge(NodeServices.layer),
    ),
  ),
)

describe("HttpApi Security Headers", () => {
  it.live("adds security headers to responses", () =>
    Effect.gen(function* () {
      const response = yield* HttpClientRequest.get(InstancePaths.path).pipe(
        HttpClientRequest.setHeaders({ authorization: "Bearer secret" }),
        HttpClient.execute,
      )

      expect(response.headers["x-content-type-options"]).toBe("nosniff")
      expect(response.headers["x-frame-options"]).toBe("DENY")
      expect(response.headers["cache-control"]).toBe("no-store")
      expect(response.headers["strict-transport-security"]).toBe(
        "max-age=31536000; includeSubDomains",
      )
    }),
  )

  it.live("generates x-request-id when not provided", () =>
    Effect.gen(function* () {
      const response = yield* HttpClientRequest.get(InstancePaths.path).pipe(
        HttpClientRequest.setHeaders({ authorization: "Bearer secret" }),
        HttpClient.execute,
      )

      expect(response.headers["x-request-id"]).toBeDefined()
      expect(typeof response.headers["x-request-id"]).toBe("string")
      expect(response.headers["x-request-id"].length).toBeGreaterThan(0)
    }),
  )

  it.live("preserves client-provided x-request-id", () =>
    Effect.gen(function* () {
      const clientRequestId = "test-request-id-123"
      const response = yield* HttpClientRequest.get(InstancePaths.path).pipe(
        HttpClientRequest.setHeaders({
          authorization: "Bearer secret",
          "x-request-id": clientRequestId,
        }),
        HttpClient.execute,
      )

      expect(response.headers["x-request-id"]).toBe(clientRequestId)
    }),
  )

  it.live("security headers are applied to error responses", () =>
    Effect.gen(function* () {
      const { handler } = HttpRouter.toWebHandler(
        HttpApiApp.createRoutes().pipe(
          Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ OPENCODE_SERVER_PASSWORD: "secret" }))),
        ),
        { disableLogger: true },
      )
      const response = yield* Effect.promise(() =>
        handler(
          new Request(new URL("/global/config", "http://localhost"), {
            headers: { authorization: "Bearer wrong-password" },
          }),
          HttpApiApp.context,
        ),
      )

      expect(response.status).toBe(401)
      expect(response.headers.get("x-content-type-options")).toBe("nosniff")
      expect(response.headers.get("x-frame-options")).toBe("DENY")
      expect(response.headers.get("cache-control")).toBe("no-store")
    }),
  )
})

import { Buffer } from "node:buffer"
import { timingSafeEqual } from "node:crypto"
import { Effect, Schema } from "effect"
import * as Semaphore from "effect/Semaphore"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { Resource } from "sst/resource"
import { Ingest } from "./ingest"
import { isShuttingDown } from "./shutdown"

const MAX_CONCURRENT_INGEST_REQUESTS = 8
// SECURITY: hard caps on ingest body and event count to prevent memory exhaustion
// and AWS Firehose cost amplification from a malicious or buggy client. The values
// are sized for the current production workload; raise via SST Resource if needed.
const MAX_INGEST_BODY_BYTES = 1_048_576 // 1 MiB
const MAX_INGEST_EVENTS = 10_000

const IngestPayload = Schema.Struct({
  events: Schema.optional(Schema.Unknown),
})

export const Routes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const ingestService = yield* Ingest
    const ingestRequests = yield* Semaphore.make(MAX_CONCURRENT_INGEST_REQUESTS)

    yield* Effect.all(
      [
        router.add("GET", "/health", () => json(200, { ok: true })),
        router.add("GET", "/ready", () => json(isShuttingDown() ? 503 : 200, { ok: !isShuttingDown() })),
        router.add("POST", "/", ingestRequests.withPermit(ingest(ingestService))),
      ],
      { discard: true },
    )
  }),
)

const ingest = (ingestService: Ingest.Service) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    if (!isAuthorized(request.headers)) return yield* json(401, { ok: false, error: "Unauthorized" })

    const contentLength = Number(request.headers["content-length"] ?? request.headers["Content-Length"] ?? "0")
    if (Number.isFinite(contentLength) && contentLength > MAX_INGEST_BODY_BYTES) {
      return yield* json(413, { ok: false, error: "Payload too large" })
    }

    const payload = yield* HttpServerRequest.schemaBodyJson(IngestPayload).pipe(
      Effect.match({
        onFailure: () => undefined,
        onSuccess: (value) => value,
      }),
    )
    if (!payload) return yield* json(400, { ok: false, error: "Invalid JSON body" })

    const events = Array.isArray(payload.events) ? payload.events : []
    if (events.length === 0) return yield* json(202, { ok: true, records: 0 })
    if (events.length > MAX_INGEST_EVENTS) {
      return yield* json(413, { ok: false, error: `Too many events (max ${MAX_INGEST_EVENTS})` })
    }

    return yield* ingestService.write(events).pipe(
      Effect.flatMap((result) => json(202, { ok: true, records: result.records })),
      Effect.catchTag("IngestError", (error) =>
        json(502, { ok: false, records: countRecords(events), failed: error.failed }),
      ),
    )
  })

function isAuthorized(headers: Record<string, string | undefined>) {
  const secret = Resource.LakeIngestConfig.secret
  // SECURITY: defense-in-depth. An empty or unset secret must NEVER authorize a request.
  // The original length check below would let an empty secret become "Bearer " (7 bytes)
  // and any 7-byte "Bearer " header would match. Refuse early.
  if (typeof secret !== "string" || secret.length === 0) return false
  const actual = Buffer.from(headers.authorization ?? headers.Authorization ?? "")
  const expected = Buffer.from(`Bearer ${secret}`)
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}

function countRecords(items: unknown[]) {
  let records = 0
  for (const item of items) {
    if (Boolean(item) && typeof item === "object" && !Array.isArray(item)) records++
  }
  return records
}

function json(status: number, body: Record<string, unknown>) {
  return HttpServerResponse.json(body, { status }).pipe(Effect.orDie)
}

# Middleware Patterns

## errorLayer fail-reason guard

The errorLayer at `middleware/error.ts:10` catches handler errors that would otherwise produce empty-body 500s. There are two error paths in the Effect HTTP framework:

1. **Die reasons** (defects): Caught by `Cause.isDieReason`. Skips responses (`HttpServerResponse`), `HttpServerError`, and `Respondable` defects — these have their own encoding path in `causeResponse`.
2. **Fail reasons** (typed errors): Caught by `Cause.isFailReason`. The original code used `!HttpServerRespondable.isRespondable(failReason.error)` as a guard, assuming the framework handles Respondable errors correctly.

**The guard is wrong**: `HttpServerRespondable.isRespondable` only checks if the error TYPE implements `Respondable` (e.g., has a `[Respondable.symbol]()` method that returns a response). It does NOT check whether that error is DECLARED in the endpoint's schema. When a Respondable error (like `HttpApiError.NotFound`) is thrown but NOT declared as a possible error for that endpoint, the framework's `causeResponse` fails to encode it and produces `internalServerError()` (empty 500 body).

**Always catch all fail reasons** — remove the `isRespondable` guard:

```ts
const failReason = cause.reasons.find(Cause.isFailReason)
if (failReason) {
  // Don't check isRespondable — framework mishandles undeclared Respondable errors
  return Effect.as(
    Effect.logError("failed", { error: failReason.error }),
    HttpServerResponse.jsonUnsafe(
      new NamedError.Unknown({ message, ref }).toObject(),
      { status: 500 },
    ),
  )
}
```

The framework's `causeResponse` (`HttpServerError.ts:283`) handles errors in this order:
1. `Fail` → `Respondable.toResponseOrElse(error, internalServerError)` — uses `[Respondable.symbol]()` if present, else `internalServerError()`
2. `Die` → `Respondable.toResponseOrElseDefect(defect, internalServerError)` — same logic
3. `Interrupt` → returns 499 (client abort) or 503 (server abort)

`internalServerError()` returns `Response.empty({ status: 500 })` — an EMPTY body. The errorLayer's job is to intercept before this point.

## Non-global middleware scope

`HttpRouter.middleware` without `{ global: true }` creates route-level middleware applied per-route during `addAll`. These middleware wrap individual route handlers but NOT the outer routing logic (`asHttpEffect`). This means:
- Route-level middleware catches errors from route handlers
- Route-not-found errors (`RouteNotFound`) from `asHttpEffect` are NOT caught by route-level middleware — they go directly to `causeResponse`
- To catch ALL errors including route-not-found, use `addGlobalMiddleware` or wrap the handler at the `toWebHandler` level

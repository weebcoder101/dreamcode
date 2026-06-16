# Shared Server Utilities

## serveUIEffect upstream proxy

`serveUIEffect` (`ui.ts:78`) serves the web UI for unmatched routes. When `--skip-embed-web-ui` is used at build time (or embedded UI fails to load), it proxies ALL requests to `https://app.dreamcode.ai` via `HttpClient`.

**Failure mode**: The proxy call produces a `HttpClientError` ("Transport error") when there's no network access to `app.dreamcode.ai`. This error is NOT caught by `serveUIEffect` itself — it propagates up through the middleware chain. If the errorLayer catches it (non-global middleware), it returns a JSON 500 with body. If the errorLayer doesn't catch it (route-level middleware won't catch errors from catch-all routes in some configurations), the framework returns `internalServerError()` (empty 500 body).

**Impact**: In the in-process server (`dreamcode run`), this catch-all route intercepts ALL API routes including `/session`, making the server appear completely broken. The fix is to exclude the UI catch-all from the in-process webHandler.

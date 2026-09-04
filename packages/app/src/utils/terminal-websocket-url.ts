import { authTokenFromCredentials } from "@/utils/server"

export function terminalWebSocketURL(input: {
  url: string
  id: string
  directory: string
  cursor: number
  ticket?: string
  sameOrigin?: boolean
  username?: string
  password?: string
  authToken?: boolean
}) {
  const next = new URL(`${input.url}/pty/${input.id}/connect`)
  next.searchParams.set("directory", input.directory)
  next.searchParams.set("cursor", String(input.cursor))
  next.protocol = next.protocol === "https:" ? "wss:" : "ws:"
  if (input.ticket) {
    next.searchParams.set("ticket", input.ticket)
    return next
  }
  // SECURITY: only attach the auth_token in the URL for cross-origin
  // connections. The previous behavior also attached it whenever the
  // caller opted in via `authToken`, but that flag is set on the
  // same-origin Electron renderer path and leaks the password into
  // the WS upgrade URL, browser history, and HTTP server access logs.
  // For same-origin the browser's same-origin policy already protects
  // the connection, so the credential is unnecessary.
  if (input.password && input.sameOrigin === false)
    next.searchParams.set(
      "auth_token",
      authTokenFromCredentials({ username: input.username, password: input.password }),
    )
  return next
}

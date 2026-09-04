const fallback = () => {
  // crypto.randomUUID is unavailable in some non-secure contexts (older
  // WebView, file://, http:// without TLS). Math.random is NOT
  // cryptographically random, so we use getRandomValues (the underlying
  // CSPRNG) to build a v4-style UUID. Never use Math.random here.
  const c = globalThis.crypto
  if (c && typeof c.getRandomValues === "function") {
    const bytes = new Uint8Array(16)
    c.getRandomValues(bytes)
    // Per RFC 4122 §4.4: version 4 UUID
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }
  // Last-resort: refuse to generate a non-random ID. Callers should detect
  // and surface this rather than accept a predictable ID.
  throw new Error("crypto.getRandomValues is required for uuid()")
}

export function uuid() {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === "function") {
    try {
      return c.randomUUID()
    } catch {
      // fall through to fallback
    }
  }
  return fallback()
}

/**
 * Server credentials storage.
 *
 * Passwords (and any other secret material tied to a server connection) MUST NOT
 * live in the renderer's persistent store, in window.localStorage, or in any
 * structure that crosses the contextBridge in plaintext. They live here, in the
 * main process, encrypted with Electron safeStorage (OS-level keychain service
 * on macOS, DPAPI on Windows, libsecret on Linux). The renderer can only ask
 * the main process to set, fetch, or delete a credential by opaque server-id;
 * it never sees the encryption key or the decrypted plaintext across the
 * bridge (the returned plaintext is consumed by main and forwarded only to the
 * SDK which uses it to establish the HTTP connection).
 *
 * F-003: prior to this file, passwords were written to the renderer
 * server.v3 persist key in plaintext, which left them visible to any code
 * with access to localStorage (XSS, dev-tools, side-channel extensions).
 */

import { safeStorage } from "electron"
import { getStore } from "./store"

const STORE_NAME = "server-credentials"
const KEY_PREFIX = "credential::"

const makeKey = (serverId: string): string => `${KEY_PREFIX}${serverId}`

/**
 * Returns true if the OS keychain integration is available and we can actually
 * encrypt. When false, calls to setServerCredential will refuse to persist and
 * throw.
 */
export function isCredentialStorageAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

/**
 * Encrypts and stores the password for the given server id. Replaces any
 * existing credential. Returns the encrypted blob length (bytes) for logging.
 */
export function setServerCredential(serverId: string, password: string): number {
  if (!serverId) throw new Error("serverId is required")
  if (!password) throw new Error("password is required (use deleteServerCredential to clear)")
  if (!isCredentialStorageAvailable()) {
    throw new Error("OS keychain integration is not available; refusing to store credential in plaintext")
  }
  const encrypted = safeStorage.encryptString(password)
  getStore(STORE_NAME).set(makeKey(serverId), encrypted.toString("base64"))
  return encrypted.byteLength
}

/**
 * Fetches and decrypts the password for the given server id, or returns null
 * if no credential is stored, or if decryption fails.
 *
 * Fail-closed: a credential that can no longer be decrypted is treated as if
 * it were never set.
 */
export function getServerCredential(serverId: string): string | null {
  if (!serverId) return null
  const store = getStore(STORE_NAME)
  const raw = store.get(makeKey(serverId))
  if (!raw) return null
  if (!isCredentialStorageAvailable()) return null
  try {
    return safeStorage.decryptString(Buffer.from(raw as string, "base64"))
  } catch {
    store.delete(makeKey(serverId))
    return null
  }
}

/**
 * Removes the stored credential for the given server id. Idempotent.
 */
export function deleteServerCredential(serverId: string): boolean {
  if (!serverId) return false
  const store = getStore(STORE_NAME)
  const key = makeKey(serverId)
  const had = !!store.get(key)
  store.delete(key)
  return had
}

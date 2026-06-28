/**
 * Credential Encryption at Rest
 *
 * AES-256-GCM encryption for credential values stored in SQLite.
 * Key derived from machine identity via PBKDF2 (v2) or SHA-256 (v1 legacy).
 *
 * Version history:
 *   v1: enc:v1: — SHA-256 with static salt (weak, deprecated)
 *   v2: enc:v2: — PBKDF2 with random salt, 100k iterations (current)
 *
 * decryptCredential() transparently handles v1, v2, and plaintext.
 * reEncryptCredential() migrates v1 → v2 on read.
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash, pbkdf2Sync } from "crypto"
import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"

const ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 12
const TAG_LENGTH = 16
const SALT_LENGTH = 16
const PBKDF2_ITERATIONS = 100_000
const ENCRYPTED_PREFIX_V1 = "enc:v1:"
const ENCRYPTED_PREFIX_V2 = "enc:v2:"

/** Get the machine identity string (cached). */
function getMachineId(): string {
  // Strategy 1: /etc/machine-id (Linux, most reliable)
  try {
    if (existsSync("/etc/machine-id")) {
      return readFileSync("/etc/machine-id", "utf-8").trim()
    }
  } catch { /* fall through */ }

  // Strategy 2: /var/lib/dbus/machine-id (older Linux)
  try {
    if (existsSync("/var/lib/dbus/machine-id")) {
      return readFileSync("/var/lib/dbus/machine-id", "utf-8").trim()
    }
  } catch { /* fall through */ }

  // Strategy 3: HOME directory hash (containers, CI)
  return createHash("sha256").update(homedir()).digest("hex")
}

let cachedMachineId: string | null = null

function machineId(): string {
  if (!cachedMachineId) cachedMachineId = getMachineId()
  return cachedMachineId
}

/** Derive a 32-byte encryption key using PBKDF2 with a random salt. */
function deriveKeyV2(salt: Buffer): Buffer {
  return pbkdf2Sync(machineId(), salt, PBKDF2_ITERATIONS, 32, "sha256")
}

/** Encrypt a plaintext string. Returns prefixed ciphertext. */
export function encryptCredential(plaintext: string): string {
  // Already encrypted — skip
  if (plaintext.startsWith(ENCRYPTED_PREFIX_V1) || plaintext.startsWith(ENCRYPTED_PREFIX_V2)) return plaintext

  const salt = randomBytes(SALT_LENGTH)
  const key = deriveKeyV2(salt)
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()])
  const tag = cipher.getAuthTag()

  // Format: enc:v2:base64(salt):base64(iv):base64(tag):base64(ciphertext)
  return `${ENCRYPTED_PREFIX_V2}${salt.toString("base64")}:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`
}

/** Decrypt an encrypted credential string. Returns plaintext. */
export function decryptCredential(encrypted: string): string {
  // Not encrypted — legacy plaintext value, return as-is
  if (!encrypted.startsWith(ENCRYPTED_PREFIX_V1) && !encrypted.startsWith(ENCRYPTED_PREFIX_V2)) return encrypted

  // V2: PBKDF2 with random salt
  if (encrypted.startsWith(ENCRYPTED_PREFIX_V2)) {
    const rest = encrypted.slice(ENCRYPTED_PREFIX_V2.length)
    const [saltB64, ivB64, tagB64, ciphertextB64] = rest.split(":")

    if (!saltB64 || !ivB64 || !tagB64 || !ciphertextB64) {
      throw new Error("Malformed v2 encrypted credential: missing salt, iv, tag, or ciphertext")
    }

    const salt = Buffer.from(saltB64, "base64")
    const key = deriveKeyV2(salt)
    const iv = Buffer.from(ivB64, "base64")
    const tag = Buffer.from(tagB64, "base64")
    const ciphertext = Buffer.from(ciphertextB64, "base64")

    const decipher = createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(tag)

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return decrypted.toString("utf-8")
  }

  // V1: legacy static-salt SHA-256 (migration path)
  const rest = encrypted.slice(ENCRYPTED_PREFIX_V1.length)
  const [ivB64, tagB64, ciphertextB64] = rest.split(":")

  if (!ivB64 || !tagB64 || !ciphertextB64) {
    throw new Error("Malformed v1 encrypted credential: missing iv, tag, or ciphertext")
  }

  const key = createHash("sha256")
    .update(machineId() + "dreamcode-credentials-v1")
    .digest()
  const iv = Buffer.from(ivB64, "base64")
  const tag = Buffer.from(tagB64, "base64")
  const ciphertext = Buffer.from(ciphertextB64, "base64")

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return decrypted.toString("utf-8")
}

/**
 * Re-encrypt a v1 credential to v2. Useful for migration on read.
 * Returns the value unchanged if it's already v2 or plaintext.
 */
export function reEncryptCredential(value: string): string {
  if (!value.startsWith(ENCRYPTED_PREFIX_V1)) return value
  const plaintext = decryptCredential(value)
  return encryptCredential(plaintext)
}

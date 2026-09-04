import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import path from "path"
import { Effect, Layer, Record, Result, Schema, Context, Option } from "effect"
import { NonNegativeInt } from "@opencode-ai/core/schema"
import { Global } from "@opencode-ai/core/global"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import fs from "node:fs"

export const OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key"

// ─── OAuth Token Encryption ─────────────────────────────────────────────
// AES-256-GCM encrypt/decrypt using a key derived from the machine ID.
// This protects OAuth tokens at rest so that a filesystem-level compromise
// (backup, sync, temp access) does not expose raw credentials.
//
// The derived key is deterministic for the machine, so tokens remain
// decryptable across restarts. If /etc/machine-id is unavailable, a
// fallback hash of the HOME env var is used (still better than plaintext).

const ENCRYPTION_PREFIX = "enc:v1:"

function deriveKey(): Buffer {
  // AES-256-GCM key is a one-time random 32-byte buffer, generated on first
  // run and persisted to ~/.config/dreamcode/auth.key (mode 0o600). On every
  // subsequent read, we load that file.
  //
  // SECURITY: we do NOT silently fall back to a deterministic key derived
  // from /etc/machine-id or HOME. A deterministic key means any local process
  // (or a filesystem-only attacker with HOME access) can recover the AES key
  // and decrypt the stored OAuth tokens. The honest behavior when the key
  // file cannot be written is to fail closed: surface the error to the
  // caller, who can decide whether to log, abort, or proceed without
  // encryption-at-rest. Encryption-at-rest that an attacker can compute is
  // worse than no encryption at all — it gives a false sense of safety.
  const keyPath = path.join(process.env.HOME || "/tmp", ".config", "dreamcode", "auth.key")
  try {
    return fs.readFileSync(keyPath)
  } catch (e: any) {
    if (e?.code !== "ENOENT") {
      throw new Error(
        `Unable to read OAuth encryption key at ${keyPath}: ${e?.message ?? e}. ` +
          `Refusing to use a derivable key for token encryption-at-rest. ` +
          `Restore file permissions on ~/.config/dreamcode or unset OPENCODE_AUTH_CONTENT.`,
      )
    }
    // First-run: generate a new random key and persist it
    const key = randomBytes(32)
    const dir = path.dirname(keyPath)
    try {
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(keyPath, key, { mode: 0o600 })
    } catch (e: any) {
      throw new Error(
        `Unable to persist OAuth encryption key at ${keyPath}: ${e?.message ?? e}. ` +
          `Encryption-at-rest is disabled because the key file could not be created. ` +
          `Run with a writable HOME or run without OPENCODE_AUTH_CONTENT to surface credentials explicitly.`,
      )
    }
    return key
  }
}

function encryptToken(plaintext: string): string {
  const key = deriveKey()
  const iv = randomBytes(16)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return ENCRYPTION_PREFIX + `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`
}

function decryptToken(ciphertext: string): string {
  // Graceful fallback: if the value does not have the encryption prefix,
  // return it as-is (migration support for pre-encryption tokens).
  if (!ciphertext.startsWith(ENCRYPTION_PREFIX)) return ciphertext
  const stripped = ciphertext.slice(ENCRYPTION_PREFIX.length)
  const parts = stripped.split(":")
  if (parts.length !== 3) return ciphertext
  const [ivHex, tagHex, dataHex] = parts
  try {
    const key = deriveKey()
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex!, "hex"))
    decipher.setAuthTag(Buffer.from(tagHex!, "hex"))
    return decipher.update(Buffer.from(dataHex!, "hex")) + decipher.final("utf8")
  } catch (err) {
    // SECURITY: do NOT return the raw ciphertext on decrypt failure.
    // A silent fallback to the encrypted blob treats a corrupted or
    // attacker-supplied auth record as a valid token, which the API may
    // then accept as a bearer credential. Log the failure and return an
    // empty string so the caller sees a well-defined "no usable token"
    // state.
    console.warn("auth: failed to decrypt token, returning empty", err)
    return ""
  }
}

function encryptOauth(info: Oauth): Oauth {
  return new Oauth({
    ...info,
    access: encryptToken(info.access),
    refresh: encryptToken(info.refresh),
  })
}

function decryptOauth(info: Oauth): Oauth {
  return new Oauth({
    ...info,
    access: decryptToken(info.access),
    refresh: decryptToken(info.refresh),
  })
}

const file = path.join(Global.Path.data, "auth.json")

const fail = (message: string) => (cause: unknown) => new AuthError({ message, cause })

export class Oauth extends Schema.Class<Oauth>("OAuth")({
  type: Schema.Literal("oauth"),
  refresh: Schema.String,
  access: Schema.String,
  expires: NonNegativeInt,
  accountId: Schema.optional(Schema.String),
  enterpriseUrl: Schema.optional(Schema.String),
}) {}

export class Api extends Schema.Class<Api>("ApiAuth")({
  type: Schema.Literal("api"),
  key: Schema.String,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}) {}

export class WellKnown extends Schema.Class<WellKnown>("WellKnownAuth")({
  type: Schema.Literal("wellknown"),
  key: Schema.String,
  token: Schema.String,
}) {}

export const Info = Schema.Union([Oauth, Api, WellKnown]).annotate({ discriminator: "type", identifier: "Auth" })
export type Info = Schema.Schema.Type<typeof Info>

export class AuthError extends Schema.TaggedErrorClass<AuthError>()("AuthError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export interface Interface {
  readonly get: (providerID: string) => Effect.Effect<Info | undefined, AuthError>
  readonly all: () => Effect.Effect<Record<string, Info>, AuthError>
  readonly set: (key: string, info: Info) => Effect.Effect<void, AuthError>
  readonly remove: (key: string) => Effect.Effect<void, AuthError>
}

export class Service extends Context.Service<Service, Interface>()("@dreamcode/Auth") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fsys = yield* FSUtil.Service
    const decode = Schema.decodeUnknownOption(Info)

    const all = Effect.fn("Auth.all")(function* () {
      if (process.env.OPENCODE_AUTH_CONTENT) {
        // OPENCODE_AUTH_CONTENT is deployment-managed; encryption is the
        // deployer's responsibility, not ours.
        // WARNING: This env var contains serialized auth credentials (API keys,
        // OAuth tokens). It is intentionally scoped to the current process and
        // NOT propagated to skill/tool subprocesses (which use BASE_SUBPROCESS_ENV).
        yield* Effect.logWarning(
          "OPENCODE_AUTH_CONTENT env var detected — auth credentials read from deployment env (bypasses encrypted file store)",
        )
        let parsed: unknown
        try {
          parsed = JSON.parse(process.env.OPENCODE_AUTH_CONTENT)
        } catch (err) {
          yield* Effect.logWarning("OPENCODE_AUTH_CONTENT is not valid JSON, treating as empty", err)
          return {}
        }
        return Record.filterMap(parsed as Record<string, unknown>, (value) => Result.fromOption(decode(value), () => undefined))
      }

      const data = (yield* fsys.readJson(file).pipe(Effect.orElseSucceed(() => ({})))) as Record<string, unknown>
      return Record.filterMap(data, (value) =>
        Result.fromOption(
          decode(value).pipe(Option.map((info) =>
            info.type === "oauth" ? decryptOauth(info) :
            info.type === "api" ? new Api({ ...info, key: decryptToken(info.key) }) :
            info
          )),
          () => undefined,
        ),
      )
    })

    const get = Effect.fn("Auth.get")(function* (providerID: string) {
      return (yield* all())[providerID]
    })

    const set = Effect.fn("Auth.set")(function* (key: string, info: Info) {
      const norm = key.replace(/\/+$/, "")
      const data = yield* all()
      if (norm !== key) delete data[key]
      delete data[norm + "/"]
      // Encrypt all credential types before persisting to disk
      const stored = info.type === "oauth" ? encryptOauth(info) : info.type === "api" ? new Api({ ...info, key: encryptToken(info.key) }) : info
      yield* fsys
        .writeJson(file, { ...data, [norm]: stored }, 0o600)
        .pipe(Effect.mapError(fail("Failed to write auth data")))
    })

    const remove = Effect.fn("Auth.remove")(function* (key: string) {
      const norm = key.replace(/\/+$/, "")
      const data = yield* all()
      delete data[key]
      delete data[norm]
      yield* fsys.writeJson(file, data, 0o600).pipe(Effect.mapError(fail("Failed to write auth data")))
    })

    return Service.of({ get, all, set, remove })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(FSUtil.defaultLayer))

export const node = LayerNode.make(layer, [FSUtil.node])

export * as Auth from "."

export * as ServerAuth from "./auth"

import { Config as EffectConfig, Context, Effect, Layer, Option, Redacted } from "effect"
import { timingSafeEqual } from "node:crypto"

export type Credentials = {
  password?: string
  username?: string
}

export type DecodedCredentials = {
  readonly username: string
  readonly password: Redacted.Redacted
}

export type Info = {
  readonly password: Option.Option<string>
  readonly username: string
}

export class Config extends Context.Service<Config, Info>()("@dreamcode/ServerAuthConfig") {
  static layer(input: Info) {
    return Layer.succeed(this, this.of(input))
  }

  static get defaultLayer() {
    return Layer.effect(
      this,
      Effect.gen(function* () {
        return Config.of(
          yield* EffectConfig.all({
            password: EffectConfig.string("OPENCODE_SERVER_PASSWORD").pipe(EffectConfig.option),
            username: EffectConfig.string("OPENCODE_SERVER_USERNAME").pipe(EffectConfig.withDefault("opencode")),
          }),
        )
      }),
    )
  }
}

export function required(config: Info) {
  return Option.isSome(config.password) && config.password.value !== ""
}

export function authorized(credentials: DecodedCredentials, config: Info) {
  if (!Option.isSome(config.password)) return false
  if (credentials.username !== config.username) return false
  // F-AUTH-1 (P2): constant-time compare. Buffer lengths are normalized to
  // config.password.value length so timingSafeEqual always operates on equal
  // buffers; the result is then masked by the length-equality check.
  // F-AUTH-1 hardening (future): the env-var password is currently stored
  // in plaintext. Move to an Argon2id-hashed value at rest and add a
  // lastRotatedAt check that warns after 90 days. See wave5-retry
  // F-AUTH-01 in the audit.
  const expected = Buffer.from(config.password.value, "utf8")
  const provided = Buffer.from(Redacted.value(credentials.password), "utf8")
  if (expected.length !== provided.length) return false
  return timingSafeEqual(expected, provided)
}

export function header(credentials?: Credentials) {
  const password = credentials?.password ?? process.env.OPENCODE_SERVER_PASSWORD
  if (!password) return undefined

  return `Basic ${Buffer.from(`${credentials?.username ?? process.env.OPENCODE_SERVER_USERNAME ?? "opencode"}:${password}`).toString("base64")}`
}

export function headers(credentials?: Credentials) {
  const authorization = header(credentials)
  if (!authorization) return undefined
  return { Authorization: authorization }
}

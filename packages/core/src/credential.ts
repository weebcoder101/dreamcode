export * as Credential from "./credential"

import { asc, eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Database } from "./database/database"
import { IntegrationSchema } from "./integration/schema"
import { NonNegativeInt, withStatics } from "./schema"
import { Identifier } from "./util/identifier"
import { CredentialTable } from "./credential/sql"
import { encryptCredential, decryptCredential } from "./credential/encryption"

export const ID = Schema.String.pipe(
  Schema.brand("Credential.ID"),
  withStatics((schema) => ({ create: () => schema.make("cred_" + Identifier.ascending()) })),
)
export type ID = typeof ID.Type

export class OAuth extends Schema.Class<OAuth>("Credential.OAuth")({
  type: Schema.Literal("oauth"),
  methodID: IntegrationSchema.MethodID,
  refresh: Schema.String,
  access: Schema.String,
  expires: NonNegativeInt,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}) {}

export class Key extends Schema.Class<Key>("Credential.Key")({
  type: Schema.Literal("key"),
  key: Schema.String,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}) {}

export const Info = Schema.Union([OAuth, Key])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "Credential.Info" })
export type Info = Schema.Schema.Type<typeof Info>

export class Stored extends Schema.Class<Stored>("Credential.Stored")({
  id: ID,
  integrationID: IntegrationSchema.ID,
  label: Schema.String,
  value: Info,
}) {}

export class CredentialDecodeError extends Schema.TaggedErrorClass<CredentialDecodeError>()(
  "CredentialDecodeError",
  { message: Schema.String },
) {}

export interface Interface {
  /** Returns every stored credential. */
  readonly all: () => Effect.Effect<Stored[], CredentialDecodeError>
  /** Returns stored credentials belonging to one integration. */
  readonly list: (integrationID: IntegrationSchema.ID) => Effect.Effect<Stored[], CredentialDecodeError>
  /** Replaces any credential for an integration and returns the new record. */
  readonly create: (input: {
    readonly integrationID: IntegrationSchema.ID
    readonly value: Info
    readonly label?: string
  }) => Effect.Effect<Stored>
  /** Updates the label or secret value of a stored credential. */
  readonly update: (id: ID, updates: Partial<Pick<Stored, "label" | "value">>) => Effect.Effect<void>
  /** Removes a stored credential. */
  readonly remove: (id: ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Credential") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const decodeValue = Schema.decodeUnknownEffect(Info)
    const stored = (row: typeof CredentialTable.$inferSelect): Effect.Effect<Stored | undefined, CredentialDecodeError> => {
      if (row.integration_id == null) return Effect.succeed(undefined)
      // Decrypt credential value before schema decoding
      const rawValue = row.value as unknown
      const decrypted = typeof rawValue === "string" ? decryptCredential(rawValue) : rawValue
      return decodeValue(decrypted).pipe(
        Effect.map((value) =>
          new Stored({
            id: row.id,
            integrationID: row.integration_id as IntegrationSchema.ID,
            label: row.label,
            value,
          }),
        ),
        Effect.mapError((e) => new CredentialDecodeError({ message: `Failed to decode credential: ${e}` })),
      )
    }

    return Service.of({
      all: Effect.fn("Credential.all")(function* () {
        const rows = yield* db
          .select()
          .from(CredentialTable)
          .orderBy(asc(CredentialTable.time_created))
          .all()
          .pipe(Effect.orDie)
        const credentials: Stored[] = []
        for (const row of rows) {
          const credential = yield* stored(row)
          if (credential) credentials.push(credential)
        }
        return credentials
      }),
      list: Effect.fn("Credential.list")(function* (integrationID) {
        const rows = yield* db
          .select()
          .from(CredentialTable)
          .where(eq(CredentialTable.integration_id, integrationID))
          .orderBy(asc(CredentialTable.time_created))
          .all()
          .pipe(Effect.orDie)
        const credentials: Stored[] = []
        for (const row of rows) {
          const credential = yield* stored(row)
          if (credential) credentials.push(credential)
        }
        return credentials
      }),
      create: Effect.fn("Credential.create")(function* (input) {
        const credential = new Stored({
          id: ID.create(),
          integrationID: input.integrationID,
          label: input.label ?? "default",
          value: input.value,
        })
        // Encrypt credential value before storing
        const encryptedValue = encryptCredential(JSON.stringify(credential.value))
        yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              yield* tx
                .delete(CredentialTable)
                .where(eq(CredentialTable.integration_id, credential.integrationID))
                .run()
              yield* tx
                .insert(CredentialTable)
                .values({
                  id: credential.id,
                  integration_id: credential.integrationID,
                  label: credential.label,
                  value: encryptedValue,
                })
                .run()
            }),
          )
          .pipe(Effect.orDie)
        return credential
      }),
      update: Effect.fn("Credential.update")(function* (id, updates) {
        if (!updates.label && !updates.value) return
        // Encrypt credential value before updating
        const encryptedValue = updates.value ? encryptCredential(JSON.stringify(updates.value)) : undefined
        yield* db
          .update(CredentialTable)
          .set({ label: updates.label, value: encryptedValue })
          .where(eq(CredentialTable.id, id))
          .run()
          .pipe(Effect.orDie)
      }),
      remove: Effect.fn("Credential.remove")(function* (id) {
        yield* db.delete(CredentialTable).where(eq(CredentialTable.id, id)).run().pipe(Effect.orDie)
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Database.defaultLayer))

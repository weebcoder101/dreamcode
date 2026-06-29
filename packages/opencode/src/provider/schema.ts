import { Schema } from "effect"

/** Branded string for provider identification */
export const ProviderID = Schema.String.pipe(Schema.brand("ProviderID"))
export type ProviderID = typeof ProviderID.Type

/** Branded string for model identification */
export const ModelID = Schema.String.pipe(Schema.brand("ModelID"))
export type ModelID = typeof ModelID.Type

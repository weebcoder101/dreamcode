import { z, type ZodType } from "zod/v4"

export const openaiCompatibleErrorDataSchema = z.object({
  error: z.object({
    message: z.string(),

    // The additional information below is handled loosely to support
    // OpenAI-compatible providers that have slightly different error
    // responses:
    type: z.string().nullish(),
    param: z.unknown().nullish(),
    code: z.union([z.string(), z.number()]).nullish(),
  }),
})

export type OpenAICompatibleErrorData = z.infer<typeof openaiCompatibleErrorDataSchema>

export type ProviderErrorStructure<T> = {
  errorSchema: ZodType<T>
  errorToMessage: (error: unknown) => string
  isRetryable?: (response: Response, error?: unknown) => boolean
}

export const defaultOpenAICompatibleErrorStructure: ProviderErrorStructure<OpenAICompatibleErrorData> = {
  errorSchema: openaiCompatibleErrorDataSchema,
  errorToMessage: (data: unknown) => {
    const parsed = openaiCompatibleErrorDataSchema.safeParse(data)
    return parsed.success ? parsed.data.error.message : String(data)
  },
}

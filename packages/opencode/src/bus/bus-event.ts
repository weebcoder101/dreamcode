import { Identifier } from "@/id/id"
import z from "zod"

export const BusEvent = {
  define: <T extends z.ZodTypeAny>(type: string, schema: T) => ({
    type,
    schema,
    create: (data: z.infer<T>) => ({
      id: Identifier.create("evt", "ascending"),
      type,
      data,
    }),
  }),
}

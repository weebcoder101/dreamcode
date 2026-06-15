import { BusEvent } from "@/bus/bus-event"
import z from "zod"

export const HookEvent = {
  ReActMaxReached: BusEvent.define(
    "hook.react_max_reached",
    z.object({
      phase: z.enum(["pre", "post"]),
      actorID: z.string(),
      agentType: z.string(),
    }),
  ),
  ReActReentered: BusEvent.define(
    "hook.react_reentered",
    z.object({
      phase: z.enum(["pre", "post"]),
      actorID: z.string(),
      agentType: z.string(),
      iteration: z.number(),
      triggeredByPlugins: z.array(z.string()),
      reasonPreview: z.string(),
    }),
  ),
}

import { BusEvent } from "./bus-event"
import { GlobalBus } from "./global"
import { Context, Effect, Layer } from "effect"
import z from "zod"

export interface Interface {
  readonly publish: <T extends { type: string; schema: z.ZodTypeAny }>(
    event: T,
    data: z.infer<T["schema"]>,
  ) => Effect.Effect<void>
  readonly subscribeCallback: <T extends { type: string; schema: z.ZodTypeAny }>(
    event: T,
    callback: (data: z.infer<T["schema"]>) => void,
  ) => Effect.Effect<() => void>
}

export class Service extends Context.Service<Service, Interface>()("@dreamcode/Bus") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const publish: Interface["publish"] = (event, data) =>
      Effect.sync(() => {
        GlobalBus.emit("event", { payload: { type: event.type, data } })
      })

    const subscribeCallback: Interface["subscribeCallback"] = (_event, callback) =>
      Effect.sync(() => {
        const handler = (evt: { payload: any }) => {
          callback(evt.payload.data)
        }
        GlobalBus.on("event", handler)
        return () => {
          GlobalBus.off("event", handler)
        }
      })

    return Service.of({ publish, subscribeCallback })
  }),
)

export const defaultLayer = layer

export const Bus = { Service, layer, defaultLayer }

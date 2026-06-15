import type { SessionID } from "@/session/schema"
import { Context, Effect, Layer } from "effect"

export type SendInput = {
  readonly receiverSessionID: SessionID
  readonly receiverActorID: string
  readonly senderSessionID: SessionID
  readonly senderActorID: string
  readonly type: string
  readonly content: string
}

export interface Interface {
  readonly send: (input: SendInput) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@dreamcode/Inbox") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const send: Interface["send"] = (_input) =>
      Effect.sync(() => {})

    return Service.of({ send })
  }),
)

export const defaultLayer = layer

export const Inbox = { Service, layer, defaultLayer }
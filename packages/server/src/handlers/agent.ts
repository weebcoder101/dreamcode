import { AgentV2 } from "@opencode-ai/core/agent"
import { PluginBoot } from "@opencode-ai/core/plugin/boot"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { UnknownError } from "../errors"
import { response } from "../groups/location"

function syncErrorHandler(error: { _tag: "EventV2.InvalidSyncEvent" }): Effect.Effect<never, UnknownError> {
  return Effect.fail(new UnknownError({ message: "Unexpected server error. Check server logs for details." }))
}

export const AgentHandler = HttpApiBuilder.group(Api, "server.agent", (handlers) =>
  handlers.handle("agent.list", () =>
    response(
      Effect.gen(function* () {
        yield* PluginBoot.Service.use((plugin) => plugin.wait())
        return yield* AgentV2.Service.use((agent) => agent.all())
      }),
    ).pipe(Effect.catchTag("EventV2.InvalidSyncEvent", syncErrorHandler)),
  ),
)

import { CommandV2 } from "@opencode-ai/core/command"
import { PluginBoot } from "@opencode-ai/core/internal"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { UnknownError } from "../errors"
import { response } from "../groups/location"

export const CommandHandler = HttpApiBuilder.group(Api, "server.command", (handlers) =>
  handlers.handle("command.list", () =>
    response(
      Effect.gen(function* () {
        yield* (yield* PluginBoot.Service).wait()
        return yield* CommandV2.Service.use((command) => command.list())
      }),
    ).pipe(
      Effect.catchTag("EventV2.InvalidSyncEvent", () =>
        Effect.fail(new UnknownError({ message: "Unexpected server error. Check server logs for details." })),
      ),
    ),
  ),
)

import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "@opencode-ai/core/flag/flag"

export const ServeCommand = effectCmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs).option("allow-no-auth", {
    type: "boolean",
    description: "Allow starting the server without authentication (development only)",
  }),
  describe: "starts a headless dreamcode server",
  // Server loads instances per-request via x-opencode-directory header — no
  // need for an ambient project InstanceContext at startup.
  instance: false,
  handler: Effect.fn("Cli.serve")(function* (args) {
    const { Server } = yield* Effect.promise(() => import("../../server/server"))
    if (!Flag.OPENCODE_SERVER_PASSWORD && !args["allow-no-auth"]) {
      console.error("Error: OPENCODE_SERVER_PASSWORD is not set. Refusing to start.")
      console.error("Set OPENCODE_SERVER_PASSWORD or use --allow-no-auth for development.")
      return
    }
    const opts = yield* resolveNetworkOptions(args)
    const server = yield* Effect.promise(() => Server.listen(opts))
    console.log(`dreamcode server listening on http://${server.hostname}:${server.port}`)

    yield* Effect.never
  }),
})

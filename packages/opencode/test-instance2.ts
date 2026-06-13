import { Effect } from "effect"
import { AppRuntime } from "./src/effect/app-runtime"
import { InstanceRef } from "./src/effect/instance-ref"

async function main() {
  try {
    console.log("Testing AppRuntime...")
    const result = await AppRuntime.runPromise(
      Effect.gen(function* () {
        console.log("Inside effect - trying InstanceRef...")
        const ref = yield* InstanceRef
        console.log("InstanceRef:", JSON.stringify(ref))
        return "ok"
      })
    )
    console.log("Result:", result)
  } catch (e) {
    console.error("Error:", (e as Error)?.constructor?.name, (e as Error)?.message)
    if ((e as Error)?.stack) {
      console.error("Stack:", (e as Error).stack?.split("\n").slice(0, 10).join("\n"))
    }
  }
}

main()

import { Effect } from "effect"

const testFunc = Effect.gen(function* () {
  const result = yield* Effect.gen(function* () {
    return "hello"
  }).pipe(
    Effect.ensuring(Effect.void),
  )
  return result
})

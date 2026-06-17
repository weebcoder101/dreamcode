import { Effect, Layer, Scope, Context } from "effect"

const MyService = Context.GenericService("@test/My", Effect.succeed({
  run() { return "hello" }
}))

const layer = Layer.effect(MyService, Effect.succeed({
  run() { return "hello" }
}))

console.log("Building layer...")
try {
  const scope = Scope.makeUnsafe()
  const ctx = Effect.runSync(
    Layer.buildWithMemoMap(layer, Layer.makeMemoMapUnsafe(), scope)
  )
  const svc = Context.get(ctx, MyService)
  console.log("OK:", svc.run())
} catch (e) {
  console.log("FAIL:", String(e))
}

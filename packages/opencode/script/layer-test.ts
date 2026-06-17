import { Effect, Layer, Scope, Context } from "effect"

const Svc1 = Context.Service<{ x: number }, { x: number }>()("@test/Svc1")
const layer1 = Layer.effect(Svc1, Effect.succeed({ x: 1 }))

const Svc2 = Context.Service<{ y: number }, { y: number }>()("@test/Svc2")
const layer2 = Layer.effect(Svc2, Effect.gen(function* () {
  const svc1 = yield* Svc1
  return { y: svc1.x + 1 }
}))

const merged = Layer.mergeAll(layer1, layer2)

try {
  const scope = Scope.makeUnsafe()
  const ctx = Effect.runSync(
    Layer.buildWithMemoMap(merged, Layer.makeMemoMapUnsafe(), scope)
  )
  const svc2 = Context.get(ctx, Svc2)
  console.log("DEV OK:", svc2.y)
} catch (e) {
  console.log("DEV FAIL:", String(e))
}

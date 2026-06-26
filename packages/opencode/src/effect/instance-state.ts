import { Duration, Effect, Exit, ScopedCache, Scope } from "effect"
import type { InstanceContext } from "@/project/instance-context"
import { InstanceRef, WorkspaceRef } from "./instance-ref"
import { registerDisposer } from "./instance-registry"
import { WorkspaceContext } from "@/control-plane/workspace-context"
import { Project } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"

const TypeId = "~opencode/InstanceState"

export interface InstanceState<A, E = never, R = never> {
  readonly [TypeId]: typeof TypeId
  readonly cache: ScopedCache.ScopedCache<string, A, E, R>
}

export const context = Effect.gen(function* () {
  const ctx = yield* InstanceRef
  if (!ctx) {
    yield* Effect.logWarning("InstanceState using FallbackContext — InstanceRef is undefined. process.cwd() may mismatch project root.")
    return FallbackContext
  }
  return ctx
})

/** Fallback context used when InstanceRef is not available. Callers must check for this. */
export const FallbackContext: InstanceContext = {
  directory: AbsolutePath.make(process.cwd()),
  worktree: AbsolutePath.make(process.cwd()),
  project: {
    id: Project.ID.make("default"),
    worktree: AbsolutePath.make(process.cwd()),
    time: { created: Date.now(), updated: Date.now() },
    sandboxes: [],
  },
}

/** Like `context` but returns `null` when no InstanceRef is available instead of dying. */
export const contextOrNull = Effect.gen(function* () {
  const ctx = yield* InstanceRef
  return ctx ?? null
})

export const workspaceID = Effect.gen(function* () {
  return (yield* WorkspaceRef) ?? WorkspaceContext.workspaceID
})

export const directory = Effect.map(context, (ctx) => ctx.directory)

export const make = <A, E = never, R = never>(
  init: (ctx: InstanceContext) => Effect.Effect<A, E, R | Scope.Scope>,
): Effect.Effect<InstanceState<A, E, Exclude<R, Scope.Scope>>, never, R | Scope.Scope> =>
  Effect.gen(function* () {
    const cache = yield* ScopedCache.makeWith<string, A, E, R>({
      capacity: Number.POSITIVE_INFINITY,
      lookup: () =>
        Effect.gen(function* () {
          const ctx = yield* InstanceRef
          if (!ctx) {
            yield* Effect.logWarning("InstanceState.make using FallbackContext — InstanceRef is undefined")
            return yield* init(FallbackContext)
          }
          return yield* init(ctx)
        }),
      timeToLive: (exit) => {
        // Extended TTL to reduce cache misses during long sessions.
        // Active sessions keep calling InstanceState.get() which refreshes the TTL.
        if (Exit.isSuccess(exit)) return Duration.hours(4)
        return Duration.seconds(30)
      },
      requireServicesAt: "lookup",
    })

    const off = registerDisposer((directory) => Effect.runPromise(ScopedCache.invalidate(cache, directory)))
    yield* Effect.addFinalizer(() => Effect.sync(off))

    return {
      [TypeId]: TypeId,
      cache,
    }
  })

export const get = <A, E, R>(self: InstanceState<A, E, R>) =>
  Effect.gen(function* () {
    return yield* ScopedCache.get(self.cache, yield* directory)
  })

export const use = <A, E, R, B>(self: InstanceState<A, E, R>, select: (value: A) => B) => Effect.map(get(self), select)

export const useEffect = <A, E, R, B, E2, R2>(
  self: InstanceState<A, E, R>,
  select: (value: A) => Effect.Effect<B, E2, R2>,
) => Effect.flatMap(get(self), select)

export const has = <A, E, R>(self: InstanceState<A, E, R>) =>
  Effect.gen(function* () {
    return yield* ScopedCache.has(self.cache, yield* directory)
  })

export const invalidate = <A, E, R>(self: InstanceState<A, E, R>) =>
  Effect.gen(function* () {
    return yield* ScopedCache.invalidate(self.cache, yield* directory)
  })

export * as InstanceState from "./instance-state"

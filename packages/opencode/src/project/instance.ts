/**
 * Synchronous wrappers around the Instance ALS context for use in sync/async
 * bridge code (quickjs sandbox HostFn callbacks, spawnIsolated, etc.) that
 * cannot directly yield Effect services.
 */
import { context as instanceCtx, type InstanceContext } from "./instance-context"

export type { InstanceContext } from "./instance-context"

// ---- Internal helpers ----

const fallbackContext = (): InstanceContext => ({
  directory: process.cwd(),
  worktree: process.cwd(),
  project: {
    id: "default" as never,
    worktree: process.cwd(),
    time: { created: Date.now(), updated: Date.now() },
    sandboxes: [],
  },
})

const tryGet = (): InstanceContext => {
  try {
    return instanceCtx.use()
  } catch {
    return fallbackContext()
  }
}

// ---- Public API (getter-backed so they reflect the LIVE ALS context) ----

export const Instance = {
  get worktree(): string {
    return tryGet().worktree
  },
  get current(): InstanceContext {
    return tryGet()
  },
  provide<T>(input: { directory: string; fn: () => Promise<T> }): Promise<T> {
    const scoped: InstanceContext = { ...tryGet(), directory: input.directory }
    return instanceCtx.provide(scoped, input.fn)
  },
}

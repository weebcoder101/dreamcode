import { Effect } from "effect"

/**
 * Wraps an Effect to convert `InvalidSyncEventError` (an internal error from the
 * EventV2 sync bridge) into a defect. Used at HttpApi handler boundaries where the
 * endpoint's declared error type does not include `InvalidSyncEventError`.
 *
 * The error is still preserved for debugging (it becomes an unhandled defect/500)
 * but is removed from the typed error channel.
 *
 * NOTE: Uses `as any` on the tag because `catchTag`'s type constraint requires
 * the error type to be structurally tagged, but the generic `E` in a wrapper
 * context doesn't satisfy this constraint. Runtime behavior is correct.
 */
export const dieSyncError = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.catchTag("InvalidSyncEventError" as any, (e: any) => Effect.die(e)),
  ) as Effect.Effect<A, Exclude<E, { _tag: "InvalidSyncEventError" }>, R>

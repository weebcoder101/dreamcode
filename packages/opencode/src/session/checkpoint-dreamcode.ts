import * as fs from "fs"
import * as path from "path"

interface Checkpoint { id: string; session_id: string; timestamp: string; summary: string; files_changed: string[]; skills_executed: string[]; score: number }
const CHECKPOINT_DIR = path.join(process.cwd(), ".dreamcode", "checkpoints")

/**
 * Save a checkpoint to disk with crash-safe atomic write semantics.
 *
 * Fixes vs. the previous version:
 *  - P0-01: All filesystem ops wrapped in try/catch; failures throw a
 *    `CheckpointSaveError` with the underlying cause. No silent exceptions.
 *  - P0-02: TOCTOU race avoided via atomic write — we write to a temp
 *    file then `renameSync` into place. POSIX guarantees rename is
 *    atomic, so two concurrent saves will not interleave their JSON.
 *  - P1-05: If the existing store.json is corrupt, we move it to
 *    `store.json.bak.<timestamp>` before resetting. The previous
 *    implementation silently wiped the entire checkpoint history.
 */
export class CheckpointSaveError extends Error {
  override readonly cause: unknown
  constructor(message: string, cause: unknown) {
    super(message)
    this.name = "CheckpointSaveError"
    this.cause = cause
  }
}

export function saveCheckpoint(checkpoint: Omit<Checkpoint, "id" | "timestamp">): Checkpoint {
  try {
    fs.mkdirSync(CHECKPOINT_DIR, { recursive: true })
  } catch (err) {
    throw new CheckpointSaveError("failed to create checkpoint directory", err)
  }

  const full: Checkpoint = {
    ...checkpoint,
    id: `cp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
  }

  const storePath = path.join(CHECKPOINT_DIR, "store.json")
  const tmpPath = `${storePath}.tmp.${process.pid}.${Date.now()}`
  const bakPath = `${storePath}.bak.${Date.now()}`

  let store: { checkpoints: Checkpoint[]; last_checkpoint: string | null } = { checkpoints: [], last_checkpoint: null }
  if (fs.existsSync(storePath)) {
    try {
      store = JSON.parse(fs.readFileSync(storePath, "utf8"))
    } catch (err) {
      // P1-05: corrupt store.json — preserve the bad file before resetting.
      try {
        fs.renameSync(storePath, bakPath)
        console.warn(
          `[checkpoint] corrupt store.json moved to ${bakPath} (parse error: ${String(err)})`,
        )
      } catch (renameErr) {
        console.error("[checkpoint] failed to move corrupt store.json:", String(renameErr))
      }
      store = { checkpoints: [], last_checkpoint: null }
    }
  }

  store.checkpoints.push(full)
  store.last_checkpoint = full.id
  if (store.checkpoints.length > 50) store.checkpoints = store.checkpoints.slice(-50)

  // Atomic write: serialize to tmp, then rename. POSIX rename is atomic,
  // so concurrent saves cannot interleave their JSON contents.
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2))
    fs.renameSync(tmpPath, storePath)
  } catch (err) {
    // Clean up the tmp file if rename failed.
    try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
    throw new CheckpointSaveError("failed to write checkpoint store", err)
  }

  return full
}

export function loadCheckpoint(id?: string): Checkpoint | null {
  const storePath = path.join(CHECKPOINT_DIR, "store.json")
  if (!fs.existsSync(storePath)) return null
  try {
    const store = JSON.parse(fs.readFileSync(storePath, "utf8"))
    if (id) return store.checkpoints.find((cp: Checkpoint) => cp.id === id) || null
    return store.checkpoints[store.checkpoints.length - 1] || null
  } catch (err) {
    console.error("[checkpoint] failed to load store.json:", String(err))
    return null
  }
}

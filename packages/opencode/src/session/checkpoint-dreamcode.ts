import * as fs from "fs"
import * as path from "path"

interface Checkpoint { id: string; session_id: string; timestamp: string; summary: string; files_changed: string[]; skills_executed: string[]; score: number }
const CHECKPOINT_DIR = path.join(process.cwd(), ".opencode", "checkpoints")

export function saveCheckpoint(checkpoint: Omit<Checkpoint, "id" | "timestamp">): Checkpoint {
  fs.mkdirSync(CHECKPOINT_DIR, { recursive: true })
  const full: Checkpoint = { ...checkpoint, id: `cp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, timestamp: new Date().toISOString() }
  const storePath = path.join(CHECKPOINT_DIR, "store.json")
  let store: { checkpoints: Checkpoint[]; last_checkpoint: string | null } = { checkpoints: [], last_checkpoint: null }
  if (fs.existsSync(storePath)) try { store = JSON.parse(fs.readFileSync(storePath, "utf8")) } catch {}
  store.checkpoints.push(full)
  store.last_checkpoint = full.id
  if (store.checkpoints.length > 50) store.checkpoints = store.checkpoints.slice(-50)
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2))
  return full
}

export function loadCheckpoint(id?: string): Checkpoint | null {
  const storePath = path.join(CHECKPOINT_DIR, "store.json")
  if (!fs.existsSync(storePath)) return null
  const store = JSON.parse(fs.readFileSync(storePath, "utf8"))
  if (id) return store.checkpoints.find((cp: Checkpoint) => cp.id === id) || null
  return store.checkpoints[store.checkpoints.length - 1] || null
}

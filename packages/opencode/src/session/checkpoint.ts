// ─── Checkpoint-Based Recovery (§7.1) ───────────────────────────────────
// Save session state before risky operations so a crash can resume instead
// of restarting. The Snapshot service already provides file-level checkpoints
// (git-based); this module adds lightweight SESSION-level checkpoints that
// record which step the loop was on so recovery can resume from there.
//
// Research: "Checkpoint After Every Tool Call — separate the event log from
// derived state; include enough context for resume" (Understanding Data 2026,
// Anthropic SDK discussion #1341, Breyta 2026).
//
// Design: checkpoints are written to <data>/checkpoints/<sessionID>.json.
// Each checkpoint stores: messageID, step, toolCalls count, and a compact
// resume hint. Writing is debounced and best-effort (never blocks the loop).

import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from "fs"
import { join, dirname } from "path"
import { Global } from "@opencode-ai/core/global"

const CHECKPOINT_DIR = join(Global.Path.data, "checkpoints")

export interface SessionCheckpoint {
  sessionID: string
  /** Last user message ID the loop processed. */
  messageID: string
  /** Loop step number (0 = pre-first-turn). */
  step: number
  /** Number of tool calls completed. */
  toolCalls: number
  /** Whether a compaction is in progress. */
  compacting: boolean
  /** Resume hint for the next agent turn. */
  resumeHint: string
  /** Timestamp of the checkpoint. */
  ts: number
}

function ensureDir(dir: string) {
  try { mkdirSync(dir, { recursive: true }) } catch {}
}

function checkpointPath(sessionID: string): string {
  const safe = sessionID.replace(/[^A-Za-z0-9_-]/g, "_")
  return join(CHECKPOINT_DIR, `${safe}.json`)
}

/**
 * Write a session checkpoint (debounced, best-effort). Never throws.
 */
export function writeCheckpoint(checkpoint: SessionCheckpoint): void {
  try {
    ensureDir(CHECKPOINT_DIR)
    writeFileSync(checkpointPath(checkpoint.sessionID), JSON.stringify(checkpoint, null, 2))
  } catch {
    // Best-effort — checkpointing must never break the loop.
  }
}

/**
 * Load the most recent checkpoint for a session, if any.
 */
export function loadCheckpoint(sessionID: string): SessionCheckpoint | null {
  const path = checkpointPath(sessionID)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as SessionCheckpoint
  } catch {
    return null
  }
}

/**
 * Remove the checkpoint for a session. Called when a turn completes NORMALLY
 * so the resume hint does not fire for a brand-new user message — it must
 * only appear after an actual interruption (crash/cancel mid-turn).
 */
export function clearCheckpoint(sessionID: string): void {
  try {
    const path = checkpointPath(sessionID)
    if (existsSync(path)) unlinkSync(path)
  } catch {
    // Best-effort
  }
}

/**
 * Build a resume hint from a checkpoint so the next turn can continue
 * without re-reading history. Injected into the system prompt on resume.
 */
export function resumeHint(checkpoint: SessionCheckpoint | null): string {
  if (!checkpoint) return ""
  return [
    `<checkpoint-resume>`,
    `Previous run was interrupted at step ${checkpoint.step} (${checkpoint.toolCalls} tool calls completed).`,
    checkpoint.compacting ? `A context compaction was in progress.` : `No compaction was in progress.`,
    `Resume the task from the last user request. Do NOT restart from scratch.`,
    checkpoint.resumeHint ? `\n${checkpoint.resumeHint}` : "",
    `</checkpoint-resume>`,
  ].join("\n")
}

export * as SessionCheckpoint from "./checkpoint"

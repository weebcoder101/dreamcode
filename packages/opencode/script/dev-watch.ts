#!/usr/bin/env bun
// dev-watch.ts — Hot-reload watcher for DreamCode development.
//
// Watches src/ for changes, rebuilds the binary, and restarts the child process.
// Usage:
//   bun script/dev-watch.ts            — dev mode (fast restart, no binary rebuild)
//   bun script/dev-watch.ts --binary   — binary mode (rebuilds compiled binary on each change)
//
// Uses @parcel/watcher (native Rust backend, ~5ms latency, lowest CPU).
// Debounces rapid saves (prettier/tsc) with a 200ms window.
// Handles ETXTBSY by killing child before rebuild.

import { subscribe } from "@parcel/watcher"
import { spawn, type Subprocess } from "bun"
import path from "path"
import { fileURLToPath } from "url"
import fs from "fs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const pkgDir = path.resolve(__dirname, "..")

process.chdir(pkgDir)

const args = process.argv.slice(2)
const binaryMode = args.includes("--binary")

// Source directories to watch
const SRC_DIR = path.resolve(pkgDir, "src")
const IGNORE_PATTERNS = [
  "node_modules",
  "dist",
  ".opencode",
  ".dreamcode",
  ".git",
  "*.log",
  "*.test.ts",
  "*.test.tsx",
  "test",
]

// Debounce settings
const DEBOUNCE_MS = 200

// Graceful shutdown timeout
const SHUTDOWN_TIMEOUT_MS = 3000

let child: Subprocess | null = null
let building = false
let pendingRebuild = false
let buildCount = 0

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 19)
  console.log(`\x1b[36m[watcher ${ts}]\x1b[0m ${msg}`)
}

function logError(msg: string) {
  const ts = new Date().toISOString().slice(11, 19)
  console.error(`\x1b[31m[watcher ${ts}] ERROR:\x1b[0m ${msg}`)
}

async function killChild(): Promise<void> {
  if (!child) return

  try {
    child.kill("SIGTERM")
  } catch {
    // already dead
  }

  // Wait for exit or force-kill after timeout
  await Promise.race([
    child.exited,
    new Promise((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS)),
  ])

  if (child.exitCode === null) {
    try {
      child.kill("SIGKILL")
    } catch {
      // already dead
    }
  }

  child = null
}

async function buildBinary(): Promise<boolean> {
  log("Building binary...")
  const start = performance.now()

  try {
    const proc = Bun.spawn(["bun", "run", "script/build.ts", "--single", "--skip-install"], {
      cwd: pkgDir,
      stdout: "inherit",
      stderr: "inherit",
    })

    const exitCode = await proc.exited
    const elapsed = Math.round(performance.now() - start)

    if (exitCode !== 0) {
      logError(`Build failed (${elapsed}ms)`)
      return false
    }

    log(`Build succeeded (${elapsed}ms)`)
    return true
  } catch (err) {
    logError(`Build error: ${err}`)
    return false
  }
}

async function startChild(): Promise<void> {
  const binPath = path.resolve(pkgDir, "dist/dreamcode-linux-x64/bin/dreamcode")

  if (binaryMode) {
    if (!fs.existsSync(binPath)) {
      log("No binary found. Building first...")
      const ok = await buildBinary()
      if (!ok) {
        logError("Initial build failed. Fix errors and save to retry.")
        return
      }
    }

    log(`Starting binary: ${binPath}`)
    child = spawn([binPath, ...args.filter((a) => a !== "--binary")], {
      cwd: pkgDir,
      stdio: ["inherit", "inherit", "inherit"],
    })
  } else {
    // Dev mode: run directly from TypeScript source (fast, ~200ms restart)
    log("Starting dev mode (source)...")
    child = spawn(["bun", "run", "--conditions=browser", "./src/index.ts", ...args.filter((a) => a !== "--binary")], {
      cwd: pkgDir,
      stdio: ["inherit", "inherit", "inherit"],
    })
  }

  // Log when child exits
  child.exited.then((code) => {
    if (child) {
      log(`Child exited with code ${code}`)
    }
  }).catch(() => {})
}

async function rebuild(): Promise<void> {
  if (building) {
    pendingRebuild = true
    return
  }

  building = true
  pendingRebuild = false
  buildCount++

  try {
    await killChild()

    if (binaryMode) {
      const ok = await buildBinary()
      if (!ok) {
        logError("Build failed. Fix errors and save to retry.")
        return
      }
    }

    await startChild()
  } finally {
    building = false

    // If changes arrived during build, rebuild again
    if (pendingRebuild) {
      pendingRebuild = false
      await rebuild()
    }
  }
}

// Debounced rebuild
let debounceTimer: ReturnType<typeof setTimeout> | null = null

function scheduleRebuild() {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    void rebuild()
  }, DEBOUNCE_MS)
}

// Filter out ignored files
function shouldIgnore(filePath: string): boolean {
  const rel = path.relative(SRC_DIR, filePath)
  return IGNORE_PATTERNS.some((pattern) => {
    if (pattern.startsWith("*")) {
      return rel.endsWith(pattern.slice(1))
    }
    return rel.split(path.sep).includes(pattern)
  })
}

// Main
async function main() {
  log(`Watching ${SRC_DIR} for changes...`)
  log(`Mode: ${binaryMode ? "binary (compiled)" : "dev (source)"}`)

  // Start initial child
  await startChild()

  // Subscribe to file changes
  try {
    const subscription = await subscribe(SRC_DIR, (err, events) => {
      if (err) {
        logError(`Watch error: ${err}`)
        return
      }

      for (const event of events) {
        if (shouldIgnore(event.path)) continue
        log(`Changed: ${path.relative(pkgDir, event.path)} (${event.type})`)
        scheduleRebuild()
        break // one trigger per batch is enough
      }
    })

    // Cleanup on exit
    const cleanup = async () => {
      log("Shutting down...")
      subscription.unsubscribe()
      await killChild()
      process.exit(0)
    }

    process.on("SIGINT", () => void cleanup())
    process.on("SIGTERM", () => void cleanup())

    // Keep alive
    await new Promise(() => {})
  } catch (err) {
    logError(`Failed to start watcher: ${err}`)
    log("Falling back to node:fs.watch (polling mode)")

    // Fallback to basic fs.watch
    fs.watch(SRC_DIR, { recursive: true }, (_event, filename) => {
      if (!filename) return
      if (shouldIgnore(filename)) return
      log(`Changed: ${filename}`)
      scheduleRebuild()
    })

    await new Promise(() => {})
  }
}

main().catch((err) => {
  logError(`Fatal: ${err}`)
  process.exit(1)
})

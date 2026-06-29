/**
 * Binary Regression Tests
 *
 * Validates the compiled dreamcode binary is healthy.
 * These are live tests — they require the binary to exist at the expected path.
 * If the binary doesn't exist (e.g. on CI before build step), tests gracefully skip.
 */

import { describe, expect, test } from "bun:test"
import { existsSync, statSync } from "fs"
import { resolve } from "path"

// Platform-aware binary path — resolves to the platform-appropriate dist dir.
// The build script (script/build.ts) produces artifacts under
// dist/dreamcode-{platform}-{arch}/bin/dreamcode[.exe].
const PLATFORM_MAP: Record<string, string> = {
  linux: "linux",
  darwin: "darwin",
  win32: "windows",
}
const plat = PLATFORM_MAP[process.platform] ?? "linux"
const ext = process.platform === "win32" ? ".exe" : ""
const BINARY = resolve(import.meta.dir, `../../dist/dreamcode-${plat}-x64/bin/dreamcode${ext}`)

const describeOrSkip = existsSync(BINARY) ? describe : describe.skip

// If dist binary hasn't been built yet (e.g. CI unit-test job before build job),
// skip all binary regression tests. They will run as part of the build job
// (dreamcode-ci.yml) where the binary is guaranteed to exist.
if (!existsSync(BINARY)) {
  console.warn(`[binary-regression] Binary not found at ${BINARY} — tests will skip. Run build step first.`)
}

describeOrSkip("binary regression", () => {
  test("binary exists at expected path", () => {
    expect(existsSync(BINARY)).toBe(true)
  })

  test("binary is executable", () => {
    const stat = statSync(BINARY)
    // Check that at least one execute bit is set
    const isExecutable = (stat.mode & 0o111) !== 0
    expect(isExecutable).toBe(true)
  })

  test("binary is non-empty", () => {
    const stat = statSync(BINARY)
    expect(stat.size).toBeGreaterThan(1_000_000) // Should be > 1MB
  })

  test(
    "binary reports version via --version",
    async () => {
      // Increase timeout for this test — spawning the 175MB ELF binary can be
      // slow when the test runner is under concurrent load from other suites.
      const proc = Bun.spawnSync([BINARY, "--version"], {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, DREAMCODE_CI: "1" },
      })
      expect(proc.exitCode).toBe(0)
      const output = proc.stdout.toString().trim()
      // Should output semver like "1.3.4"
      expect(output).toMatch(/^\d+\.\d+\.\d+/)
    },
    { timeout: 15000 },
  )

  test("binary produces help-like output on --help", () => {
    // --help may exit non-zero or produce output to stderr; we just check it
    // doesn't crash and produces some text on either stream.
    const proc = Bun.spawnSync([BINARY, "--help"], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, DREAMCODE_CI: "1" },
    })
    // Accept any exit code — TUI may exit 0 or non-zero for unknown flags
    const allOutput = (proc.stdout.toString() + proc.stderr.toString()).trim()
    expect(allOutput.length).toBeGreaterThan(0)
  })
})

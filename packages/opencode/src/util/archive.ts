import fs from "fs"
import os from "os"
import path from "path"
import * as Process from "./process"

// PowerShell single-quote escape: a ' inside a single-quoted string is written as ''.
function quotePS(s: string) {
  return `'${s.replaceAll("'", "''")}'`
}

export async function extractZip(zipPath: string, destDir: string) {
  if (process.platform === "win32") {
    const winZipPath = path.resolve(zipPath)
    const winDestDir = path.resolve(destDir)
    // $global:ProgressPreference suppresses PowerShell's blue progress bar popup
    const body =
      `$global:ProgressPreference = 'SilentlyContinue'\r\n` +
      `Expand-Archive -Path ${quotePS(winZipPath)} -DestinationPath ${quotePS(winDestDir)} -Force\r\n`
    // Use -File with a temp .ps1 so a single quote inside `zipPath` (e.g. a
    // crafted download named `evil';calc;.zip`) cannot break out of the prior
    // single-quoted `-Command` string and inject PowerShell. The script is
    // removed after spawn to avoid leaving a file on disk.
    const script = path.join(os.tmpdir(), `dreamcode-extract-${process.pid}-${Date.now()}.ps1`)
    await fs.promises.writeFile(script, body, "utf8")
    try {
      await Process.run([
        "powershell",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        script,
      ])
    } finally {
      await fs.promises.unlink(script).catch(() => undefined)
    }
    return
  }

  await Process.run(["unzip", "-o", "-q", zipPath, "-d", destDir])
}

export * as Archive from "./archive"

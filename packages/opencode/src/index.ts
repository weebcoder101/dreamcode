import fs from "node:fs"
import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { RunCommand } from "./cli/cmd/run"
import { GenerateCommand } from "./cli/cmd/generate"
import { ConsoleCommand } from "./cli/cmd/account"
import { ProvidersCommand } from "./cli/cmd/providers"
import { AgentCommand } from "./cli/cmd/agent"
import { UpgradeCommand } from "./cli/cmd/upgrade"
import { UninstallCommand } from "./cli/cmd/uninstall"
import { ModelsCommand } from "./cli/cmd/models"
import { UI } from "./cli/ui"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { FormatError } from "./cli/error"
import { ServeCommand } from "./cli/cmd/serve"
import { DebugCommand } from "./cli/cmd/debug"
import { StatsCommand } from "./cli/cmd/stats"
import { McpCommand } from "./cli/cmd/mcp"
import { GithubCommand } from "./cli/cmd/github"
import { ExportCommand } from "./cli/cmd/export"
import { ImportCommand } from "./cli/cmd/import"
import { AttachCommand } from "./cli/cmd/attach"
import { TuiThreadCommand } from "./cli/cmd/tui"
import { AcpCommand } from "./cli/cmd/acp"
import { EOL } from "os"
import { WebCommand } from "./cli/cmd/web"
import { PrCommand } from "./cli/cmd/pr"
import { SessionCommand } from "./cli/cmd/session"
import { DbCommand } from "./cli/cmd/db"
import { errorMessage } from "./util/error"
import { PluginCommand } from "./cli/cmd/plug"
import { Heap } from "./cli/heap"

const LOCKFILE = "/tmp/dreamcode.pid"

function acquireLockfile(): void {
  // Use O_EXCL (exclusive create) via fs.openSync("wx") to atomically claim
  // the lockfile. This is race-free: if two instances start simultaneously,
  // only one open() succeeds; the other gets EEXIST.
  const tryLock = (retries = 0): boolean => {
    if (retries > 3) return false
    try {
      const fd = fs.openSync(LOCKFILE, "wx", 0o644)
      fs.writeSync(fd, String(process.pid))
      fs.closeSync(fd)
      return true
    } catch (err: unknown) {
      const code = typeof err === "object" && err !== null && "code" in err ? (err as { code?: string }).code : undefined
      if (code !== "EEXIST") return false
      // Lockfile exists — check if the PID inside is still alive
      try {
        const pidStr = fs.readFileSync(LOCKFILE, "utf-8").trim()
        const pid = parseInt(pidStr, 10)
        if (!isNaN(pid) && pid > 0) {
          try {
            process.kill(pid, 0)
            // Process is alive — another instance is running
            console.error(`Error: Another dreamcode instance is already running (PID ${pid})`)
            console.error(`If this is incorrect, delete ${LOCKFILE} and try again.`)
            process.exit(1)
          } catch {
            // Stale lockfile — remove and retry
            fs.unlinkSync(LOCKFILE)
            return tryLock(retries + 1)
          }
        }
        // Invalid PID — remove stale lockfile and retry
        fs.unlinkSync(LOCKFILE)
        return tryLock(retries + 1)
      } catch {
        // Can't read or remove lockfile — just proceed
        return false
      }
    }
  }

  try {
    if (!tryLock()) return // Could not acquire lock — proceed anyway

    // Clean up lockfile on exit — only if we still own it
    const cleanup = () => {
      try {
        if (fs.existsSync(LOCKFILE)) {
          const current = fs.readFileSync(LOCKFILE, "utf-8").trim()
          if (current === String(process.pid)) {
            fs.unlinkSync(LOCKFILE)
          }
        }
      } catch { /* ignore cleanup errors */ }
    }

    process.on("exit", cleanup)
  } catch {
    // If lockfile operations fail (permissions, etc.), just proceed
  }
}

acquireLockfile()

const args = hideBin(process.argv)

function show(out: string) {
  const text = out.trimStart()
  if (!text.startsWith("dreamcode ")) {
    process.stderr.write(UI.logo() + EOL + EOL)
    process.stderr.write(text + EOL)
    return
  }
  process.stderr.write(out)
}

const cli = yargs(args)
  .parserConfiguration({ "populate--": true })
  .scriptName("dreamcode")
  .wrap(100)
  .help("help", "show help")
  .alias("help", "h")
  .version("version", "show version number", InstallationVersion)
  .alias("version", "v")
  .option("print-logs", {
    describe: "print logs to stderr",
    type: "boolean",
  })
  .option("log-level", {
    describe: "log level",
    type: "string",
    choices: ["DEBUG", "INFO", "WARN", "ERROR"],
  })
  .option("pure", {
    describe: "run without external plugins",
    type: "boolean",
  })
  .middleware(async (opts) => {
    if (opts.printLogs) process.env.OPENCODE_PRINT_LOGS = "1"
    if (opts.logLevel) process.env.OPENCODE_LOG_LEVEL = opts.logLevel
    if (opts.pure) {
      process.env.OPENCODE_PURE = "1"
    }

    Heap.start()

    process.env.AGENT = "1"
    process.env.OPENCODE = "1"
    process.env.OPENCODE_PID = String(process.pid)
  })
  .usage("")
  .completion("completion", "generate shell completion script")
  .command(AcpCommand)
  .command(McpCommand)
  .command(TuiThreadCommand)
  .command(AttachCommand)
  .command(RunCommand)
  .command(GenerateCommand)
  .command(DebugCommand)
  .command(ConsoleCommand)
  .command(ProvidersCommand)
  .command(AgentCommand)
  .command(UpgradeCommand)
  .command(UninstallCommand)
  .command(ServeCommand)
  .command(WebCommand)
  .command(ModelsCommand)
  .command(StatsCommand)
  .command(ExportCommand)
  .command(ImportCommand)
  .command(GithubCommand)
  .command(PrCommand)
  .command(SessionCommand)
  .command(PluginCommand)
  .command(DbCommand)
  .fail((msg, err) => {
    if (
      msg?.startsWith("Unknown argument") ||
      msg?.startsWith("Not enough non-option arguments") ||
      msg?.startsWith("Invalid values:")
    ) {
      if (err) throw err
      cli.showHelp(show)
    }
    if (err) throw err
    process.exit(1)
  })
  .strict()

try {
  if (args.includes("-h") || args.includes("--help")) {
    await cli.parse(args, (err: Error | undefined, _argv: unknown, out: string) => {
      if (err) throw err
      if (!out) return
      show(out)
    })
  } else {
    await cli.parse()
  }
} catch (e) {
  const formatted = FormatError(e)
  if (formatted) UI.error(formatted)
  if (formatted === undefined) {
    UI.error("Unexpected error" + EOL)
    process.stderr.write(errorMessage(e) + EOL)
  }
  process.exitCode = 1
} finally {
  // Some subprocesses don't react properly to SIGTERM and similar signals.
  // Most notably, some docker-container-based MCP servers don't handle such signals unless
  // run using `docker run --init`.
  // Explicitly exit to avoid any hanging subprocesses.
  process.exit()
}

type LogLevel = "info" | "warn" | "error" | "debug"

type Logger = Record<LogLevel, (message: string, meta?: Record<string, unknown>) => void>

export const Log = {
  create: (options: { service: string }): Logger => {
    const prefix = `[${options.service}]`
    const log = (level: LogLevel, message: string, meta?: Record<string, unknown>) => {
      const ts = new Date().toISOString()
      const metaStr = meta ? ` ${JSON.stringify(meta)}` : ""
      if (level === "error") {
        console.error(`${ts} ${prefix} ${message}${metaStr}`)
      } else if (level === "warn") {
        console.warn(`${ts} ${prefix} ${message}${metaStr}`)
      } else {
        console.log(`${ts} ${prefix} ${message}${metaStr}`)
      }
    }
    return {
      info: (message, meta) => log("info", message, meta),
      warn: (message, meta) => log("warn", message, meta),
      error: (message, meta) => log("error", message, meta),
      debug: (message, meta) => log("debug", message, meta),
    }
  },
}

import { isRecord } from "@/util/record"

/**
 * Tool-call repair layer.
 *
 * Open models (DeepSeek family especially) repeat a small, deterministic set
 * of tool-argument mistakes. Command Code measured the same ~4 failures on
 * DeepSeek models and fixed them with validate-then-repair: try the call as-is,
 * and only on the failing path apply targeted repairs. Repaired calls are
 * tagged so the model learns.
 *
 * Repairs applied (in order, only at failing paths):
 * 1. dropNullOptional — optional schema fields set to `null` are omitted.
 * 2. parseStringifiedArray — `"[\"a\",\"b\"]"` → `["a","b"]`.
 * 3. wrapBareStringAsArray — `"foo"` where an array is expected → `["foo"]`.
 * 4. dropEmptyObjectPlaceholder — `{}` where an array is expected → `[]`.
 * 5. unwrapMarkdownLink — `[file.md](http://file.md)` → `file.md` on path fields.
 * 6. aliasRename — common argument-name aliases (file_path→path, pattern→glob, ...).
 */

export type JsonSchema = {
  type?: string | string[]
  properties?: Record<string, JsonSchema>
  items?: JsonSchema | JsonSchema[]
  required?: string[]
  anyOf?: JsonSchema[]
}

const PATH_KEYS = new Set(["path", "filePath", "file_path", "directory", "dir", "cwd", "glob"])

const ALIASES: Record<string, string> = {
  file_path: "path",
  filename: "path",
  pattern: "glob",
  search_pattern: "glob",
  old_string: "oldText",
  new_string: "newText",
  command_line: "command",
  shell_command: "command",
  query_text: "query",
  dir: "directory",
}

function isArrayType(schema: JsonSchema | undefined): boolean {
  if (!schema) return false
  if (schema.type === "array" || (Array.isArray(schema.type) && schema.type.includes("array"))) return true
  if (schema.anyOf?.some((s) => isArrayType(s))) return true
  return false
}

function isStringType(schema: JsonSchema | undefined): boolean {
  if (!schema) return false
  if (schema.type === "string" || (Array.isArray(schema.type) && schema.type.includes("string"))) return true
  if (schema.anyOf?.some((s) => isStringType(s))) return true
  return false
}

function unwrapMarkdownLink(value: string): string {
  const match = /^\[([^\]]+)\]\((?:https?:\/\/[^)]+)\)$/.exec(value.trim())
  return match ? match[1] : value
}

export function repairValue(
  value: unknown,
  schema: JsonSchema | undefined,
  key: string,
  repair: (note: string) => void,
  requiredKeys: Set<string> | undefined = undefined,
): unknown {
  if (value === undefined || value === null) {
    // Drop null for optional fields (repair 1). Required fields keep null so
    // the caller can still see the failure.
    if (requiredKeys?.has(key)) return value
    return undefined
  }

  if (isArrayType(schema)) {
    if (typeof value === "string") {
      const trimmed = value.trim()
      // JSON-stringified array (repair 2).
      if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        try {
          const parsed: unknown = JSON.parse(trimmed)
          if (Array.isArray(parsed)) {
            repair(`expected an array; received a JSON string. Parsed it.`)
            return parsed
          }
        } catch {
          // fall through
        }
      }
      // Bare string where an array is expected (repair 3).
      repair(`expected an array; received a bare string. Wrapped it in an array.`)
      return [value]
    }
    if (isRecord(value) && Object.keys(value).length === 0) {
      // Empty object placeholder (repair 4).
      repair(`expected an array; received an empty object. Replaced it with an empty array.`)
      return []
    }
  }

  if (typeof value === "string") {
    let repaired = value
    if (PATH_KEYS.has(key)) {
      const unwrapped = unwrapMarkdownLink(repaired)
      if (unwrapped !== repaired) {
        repair(`path field "${key}" was wrapped in a markdown auto-link. Unwrapped it.`)
        repaired = unwrapped
      }
    }
    return repaired
  }

  if (Array.isArray(value)) {
    const itemSchema = Array.isArray(schema?.items) ? undefined : (schema?.items as JsonSchema | undefined)
    return value.map((item) => repairValue(item, itemSchema, key, repair))
  }

  if (isRecord(value) && schema?.properties) {
    const out: Record<string, unknown> = { ...value }
    const childRequired = new Set(schema.required ?? [])
    for (const [k, v] of Object.entries(value)) {
      const targetKey = ALIASES[k] ?? k
      if (targetKey !== k) {
        if (!(targetKey in out)) out[targetKey] = v
        delete out[k]
        repair(`argument "${k}" renamed to "${targetKey}".`)
        continue
      }
      const childSchema = schema.properties[k]
      const repairedChild = repairValue(v, childSchema, k, repair, childRequired)
      if (repairedChild === undefined) {
        delete out[k]
      } else {
        out[k] = repairedChild
      }
    }
    return out
  }

  return value
}

export function repairToolInput(tool: string, args: unknown, schema: JsonSchema | undefined): {
  args: unknown
  notes: string[]
} {
  const notes: string[] = []
  if (!isRecord(args) || !schema?.properties) {
    return { args, notes }
  }
  const repair = (note: string) => notes.push(note)
  const requiredKeys = new Set(schema.required ?? [])
  return { args: repairValue(args, schema, "root", repair, requiredKeys), notes }
}

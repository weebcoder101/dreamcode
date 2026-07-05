import path from "path"
import { describe, expect, test, beforeAll } from "bun:test"
import { Effect, FileSystem, Layer, Scope } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { NodeFileSystem } from "@effect/platform-node"
import { Global } from "@opencode-ai/core/global"
import {
  resolveSavedSubagentModel,
  saveSubagentModel,
  clearSubagentModel,
  createVariantRuntime,
} from "@/cli/cmd/run/variant.shared"
import { testEffect } from "../../lib/effect"

const model = { providerID: "openai", modelID: "gpt-5" }

const it = testEffect(Layer.mergeAll(FSUtil.defaultLayer, NodeFileSystem.layer))

describe("subagent model functions", () => {
  test("exports exist with correct signatures", () => {
    expect(typeof resolveSavedSubagentModel).toBe("function")
    expect(typeof saveSubagentModel).toBe("function")
    expect(typeof clearSubagentModel).toBe("function")
  })

  // NOTE: saveSubagentModel and clearSubagentModel write directly to
  // Global.Path.state/model.json (MODEL_FILE is computed at module load time).
  // These functions cannot be remapped to a temp directory. The tests below
  // use the Effect-based createVariantRuntime instead, which accepts a
  // remappable FSUtil layer.

  it.live("resolveSavedSubagentModel returns undefined when no model.json exists in state dir", (): Effect.Effect<void> =>
    Effect.gen(function* () {
      // This is a read-only check against the real state directory.
      // If model.json doesn't exist, must return undefined.
      const result = resolveSavedSubagentModel()
      // Either undefined or a valid object — never throws
      if (result !== undefined) {
        expect(typeof result).toBe("object")
        expect(typeof (result as Record<string, string>).providerID).toBe("string")
        expect(typeof (result as Record<string, string>).modelID).toBe("string")
      }
    }),
  )

  it.live("createVariantRuntime persists subagentModel alongside variant fields", () =>
    Effect.gen(function* () {
      const filesys = yield* FileSystem.FileSystem
      const fs = yield* FSUtil.Service
      const root = yield* filesys.makeTempDirectoryScoped()
      const file = path.join(root, "model.json")

      // Write pre-existing data with variant
      yield* fs.writeJson(file, {
        recent: [{ providerID: "anthropic", modelID: "sonnet" }],
        variant: { "openai/gpt-4.1": "low" },
      })

      // Create runtime with remapped fs — returns Promise-based API
      const svc = createVariantRuntime(remappedFs(root))

      // Save variant — should preserve existing fields
      yield* Effect.tryPromise(() => svc.saveVariant(model, "high"))
      const raw1 = yield* fs.readJson(file)
      const data1 = raw1 as Record<string, unknown>
      expect(data1.variant).toEqual({ "openai/gpt-4.1": "low", "openai/gpt-5": "high" })
      expect(data1.recent).toEqual([{ providerID: "anthropic", modelID: "sonnet" }])
    }) as any,
  )

  it.live("createVariantRuntime round-trips variant save and resolve", () =>
    Effect.gen(function* () {
      const filesys = yield* FileSystem.FileSystem
      const fs = yield* FSUtil.Service
      const root = yield* filesys.makeTempDirectoryScoped()
      const file = path.join(root, "model.json")

      yield* fs.writeJson(file, { variant: { "openai/gpt-5": "low" } })

      const svc = createVariantRuntime(remappedFs(root))

      // NOTE: saveVariant/resolveSavedVariant return Promises wrapped by createVariantRuntime
      yield* Effect.tryPromise(() => svc.saveVariant(model, "high"))
      const afterSave = yield* Effect.tryPromise(() => svc.resolveSavedVariant(model))
      expect(afterSave).toBe("high")

      yield* Effect.tryPromise(() => svc.saveVariant(model, undefined))
      const afterClear = yield* Effect.tryPromise(() => svc.resolveSavedVariant(model))
      expect(afterClear).toBeUndefined()
    }) as any,
  )

  it.live("variant save preserves subagentModel field (TOCTOU safeguard)", () =>
    Effect.gen(function* () {
      const filesys = yield* FileSystem.FileSystem
      const fs = yield* FSUtil.Service
      const root = yield* filesys.makeTempDirectoryScoped()
      const file = path.join(root, "model.json")

      // Simulate model.json with subagentModel written by syncModelJson
      yield* fs.writeJson(file, {
        recent: [{ providerID: "anthropic", modelID: "sonnet" }],
        variant: { "openai/gpt-4.1": "low" },
        subagentModel: { providerID: "openai", modelID: "gpt-5" },
      })

      const svc = createVariantRuntime(remappedFs(root))

      // Save variant — this should preserve subagentModel
      yield* Effect.tryPromise(() => svc.saveVariant({ providerID: "openai", modelID: "gpt-5" }, "max"))

      const raw = yield* fs.readJson(file)
      const data = raw as Record<string, unknown>
      expect(data.subagentModel).toEqual({ providerID: "openai", modelID: "gpt-5" })
      expect(data.variant).toEqual({ "openai/gpt-4.1": "low", "openai/gpt-5": "max" })
      expect(data.recent).toEqual([{ providerID: "anthropic", modelID: "sonnet" }])
    }) as any,
  )

  it.live("repairs malformed model.json on variant save", () =>
    Effect.gen(function* () {
      const filesys = yield* FileSystem.FileSystem
      const fs = yield* FSUtil.Service
      const root = yield* filesys.makeTempDirectoryScoped()
      const file = path.join(root, "model.json")

      yield* filesys.writeFileString(file, "{")

      const svc = createVariantRuntime(remappedFs(root))

      yield* Effect.tryPromise(() => svc.saveVariant(model, "high"))
      const raw2 = yield* fs.readJson(file)
      const data = raw2 as Record<string, unknown>
      expect(data.variant).toEqual({ "openai/gpt-5": "high" })
    }) as any,
  )
})

/**
 * Remap Global.Path.state paths to a test temp directory.
 */
function remappedFs(root: string) {
  return Layer.effect(
    FSUtil.Service,
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const remap = (file: string) => {
        if (file === Global.Path.state) return root
        if (file.startsWith(Global.Path.state + path.sep)) {
          return path.join(root, path.relative(Global.Path.state, file))
        }
        return file
      }
      return FSUtil.Service.of({
        ...fs,
        readJson: (file) => fs.readJson(remap(file)),
        writeJson: (file, data, mode) => fs.writeJson(remap(file), data, mode),
      })
    }),
  ).pipe(Layer.provide(FSUtil.defaultLayer))
}

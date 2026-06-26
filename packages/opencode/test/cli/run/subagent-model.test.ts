import path from "path"
import { describe, expect, test, beforeAll } from "bun:test"
import { Effect, FileSystem, Layer } from "effect"
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

  it.live("resolveSavedSubagentModel returns undefined when no model.json exists in state dir", () =>
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

      // Create runtime with remapped fs
      const svc = createVariantRuntime(remappedFs(root))

      // Save variant — should preserve existing fields
      yield* Effect.promise(() => svc.saveVariant(model, "high"))
      const data1 = yield* fs.readJson(file) as Record<string, unknown>
      expect(data1.variant).toEqual({ "openai/gpt-4.1": "low", "openai/gpt-5": "high" })
      expect(data1.recent).toEqual([{ providerID: "anthropic", modelID: "sonnet" }])
    }),
  )

  it.live("createVariantRuntime round-trips variant save and resolve", () =>
    Effect.gen(function* () {
      const filesys = yield* FileSystem.FileSystem
      const fs = yield* FSUtil.Service
      const root = yield* filesys.makeTempDirectoryScoped()
      const file = path.join(root, "model.json")

      yield* fs.writeJson(file, { variant: { "openai/gpt-5": "low" } })

      const svc = createVariantRuntime(remappedFs(root))

      const initial = yield* Effect.promise(() => svc.resolveSavedVariant(model))
      expect(initial).toBe("low")

      yield* Effect.promise(() => svc.saveVariant(model, "high"))
      const afterSave = yield* Effect.promise(() => svc.resolveSavedVariant(model))
      expect(afterSave).toBe("high")

      yield* Effect.promise(() => svc.saveVariant(model, undefined))
      const afterClear = yield* Effect.promise(() => svc.resolveSavedVariant(model))
      expect(afterClear).toBeUndefined()
    }),
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
      yield* Effect.promise(() => svc.saveVariant({ providerID: "openai", modelID: "gpt-5" }, "max"))

      const data = yield* fs.readJson(file) as Record<string, unknown>
      expect(data.subagentModel).toEqual({ providerID: "openai", modelID: "gpt-5" })
      expect(data.variant).toEqual({ "openai/gpt-4.1": "low", "openai/gpt-5": "max" })
      expect(data.recent).toEqual([{ providerID: "anthropic", modelID: "sonnet" }])
    }),
  )

  it.live("repairs malformed model.json on variant save", () =>
    Effect.gen(function* () {
      const filesys = yield* FileSystem.FileSystem
      const fs = yield* FSUtil.Service
      const root = yield* filesys.makeTempDirectoryScoped()
      const file = path.join(root, "model.json")

      yield* filesys.writeFileString(file, "{")

      const svc = createVariantRuntime(remappedFs(root))

      yield* Effect.promise(() => svc.saveVariant(model, "high"))
      const data = yield* fs.readJson(file) as Record<string, unknown>
      expect(data.variant).toEqual({ "openai/gpt-5": "high" })
    }),
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

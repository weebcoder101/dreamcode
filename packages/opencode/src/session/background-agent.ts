import { Effect, Context, Layer } from "effect"
import * as fs from "fs"
import * as path from "path"
import { InstanceState } from "@/effect/instance-state"

export interface BackgroundTask {
  id: string
  name: string
  status: "pending" | "running" | "completed" | "failed"
  prompt: string
  result?: string
  error?: string
  createdAt: string
  startedAt?: string
  completedAt?: string
  branch?: string
}

export interface Interface {
  readonly spawn: (name: string, prompt: string) => Effect.Effect<BackgroundTask>
  readonly list: () => Effect.Effect<BackgroundTask[]>
  readonly getStatus: (id: string) => Effect.Effect<BackgroundTask | null>
}

export class Service extends Context.Service<Service, Interface>()("@dreamcode/BackgroundAgent") {}

function getTaskDir(projectRoot: string): string {
  const dir = path.join(projectRoot, ".dreamcode", "background")
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function loadTasks(projectRoot: string): BackgroundTask[] {
  const taskDir = getTaskDir(projectRoot)
  const files = fs.readdirSync(taskDir).filter(f => f.endsWith(".json"))
  return files.map(f => {
    try {
      return JSON.parse(fs.readFileSync(path.join(taskDir, f), "utf8"))
    } catch {
      return null
    }
  }).filter(Boolean) as BackgroundTask[]
}

function saveTask(projectRoot: string, task: BackgroundTask): void {
  const taskDir = getTaskDir(projectRoot)
  fs.writeFileSync(path.join(taskDir, `${task.id}.json`), JSON.stringify(task, null, 2))
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const ctx = yield* InstanceState.context

    return Service.of({
      spawn: Effect.fn("BackgroundAgent.spawn")(function* (name: string, prompt: string) {
        const task: BackgroundTask = {
          id: `bg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name,
          status: "pending",
          prompt,
          createdAt: new Date().toISOString(),
        }

        saveTask(ctx.directory, task)

        // In a real implementation, this would spawn a sub-agent
        // For now, we just track the task
        return task
      }),

      list: Effect.fn("BackgroundAgent.list")(function* () {
        return loadTasks(ctx.directory)
      }),

      getStatus: Effect.fn("BackgroundAgent.getStatus")(function* (id: string) {
        const tasks = loadTasks(ctx.directory)
        return tasks.find(t => t.id === id) || null
      }),
    })
  }),
)

export const defaultLayer = layer

export * as BackgroundAgent from "./background-agent"

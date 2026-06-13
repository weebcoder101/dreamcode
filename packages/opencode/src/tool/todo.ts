import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import * as fs from "fs"
import * as path from "path"
import { InstanceState } from "@/effect/instance-state"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Event as TodoEvent } from "../session/todo"

export interface TodoItem {
  id: string
  content: string
  status: "pending" | "in_progress" | "completed" | "cancelled"
  priority: "high" | "medium" | "low"
  createdAt: string
  updatedAt: string
}

export interface TodoList {
  id: string
  sessionId: string
  items: TodoItem[]
  createdAt: string
  updatedAt: string
}

function getTodoPath(projectRoot: string, sessionId: string): string {
  const dir = path.join(projectRoot, ".dreamcode", "todos")
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, `${sessionId}.json`)
}

function loadTodoList(projectRoot: string, sessionId: string): TodoList | null {
  const todoPath = getTodoPath(projectRoot, sessionId)
  if (!fs.existsSync(todoPath)) return null
  try {
    return JSON.parse(fs.readFileSync(todoPath, "utf8"))
  } catch {
    return null
  }
}

function saveTodoList(projectRoot: string, sessionId: string, list: TodoList): void {
  const todoPath = getTodoPath(projectRoot, sessionId)
  fs.writeFileSync(todoPath, JSON.stringify(list, null, 2))
}

export const Parameters = Schema.Struct({
  action: Schema.String.annotate({
    description: "Action to perform: 'create', 'update', 'list', 'clear'"
  }),
  sessionId: Schema.String.annotate({
    description: "Session ID for the TODO list"
  }),
  items: Schema.optional(Schema.Array(Schema.Struct({
    id: Schema.optional(Schema.String),
    content: Schema.String,
    status: Schema.optional(Schema.String),
    priority: Schema.optional(Schema.String),
  }))).annotate({
    description: "Items to create or update"
  }),
})

export const TodoWriteTool = Tool.define<typeof Parameters, {}>(
  "todowrite",
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service

    return {
      description: "Create and manage TODO lists for task planning. Use for multi-step tasks to track progress.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<{}>) =>
        Effect.gen(function* () {
          const instanceState = yield* InstanceState.context
          const projectRoot = instanceState.directory

          let list = loadTodoList(projectRoot, params.sessionId)

          function publishTodoEvent(items: Array<{ content: string; status: string; priority: string }>) {
            yield* events.publish(TodoEvent.Updated, {
              sessionID: params.sessionId,
              todos: items.map((i) => ({
                content: i.content,
                status: i.status as "pending" | "in_progress" | "completed" | "cancelled",
                priority: i.priority as "high" | "medium" | "low",
              })),
            }).pipe(Effect.catchAll(() => Effect.void))
          }

          switch (params.action) {
            case "create": {
              if (!params.items || params.items.length === 0) {
                return { title: "TODO: No items provided", output: "Error: items array required for create action" }
              }
              const now = new Date().toISOString()
              list = {
                id: `todo-${Date.now()}`,
                sessionId: params.sessionId,
                items: params.items.map((item, index) => ({
                  id: item.id || `item-${index}`,
                  content: item.content,
                  status: (item.status as TodoItem["status"]) || "pending",
                  priority: (item.priority as TodoItem["priority"]) || "medium",
                  createdAt: now,
                  updatedAt: now,
                })),
                createdAt: now,
                updatedAt: now,
              }
              saveTodoList(projectRoot, params.sessionId, list)
              yield* publishTodoEvent(list.items)
              return {
                title: `TODO: Created ${list.items.length} items`,
                output: `Created TODO list with ${list.items.length} items:\n${list.items.map(i => `- [${i.status}] ${i.content}`).join("\n")}`,
              }
            }
            case "update": {
              if (!list) {
                return { title: "TODO: No list found", output: "Error: No TODO list found for this session. Create one first." }
              }
              if (!params.items) {
                return { title: "TODO: No items provided", output: "Error: items array required for update action" }
              }
              const now = new Date().toISOString()
              for (const update of params.items) {
                const existing = list.items.find(i => i.id === update.id)
                if (existing) {
                  if (update.content) existing.content = update.content
                  if (update.status) existing.status = update.status as TodoItem["status"]
                  if (update.priority) existing.priority = update.priority as TodoItem["priority"]
                  existing.updatedAt = now
                }
              }
              list.updatedAt = now
              saveTodoList(projectRoot, params.sessionId, list)
              yield* publishTodoEvent(list.items)
              return {
                title: `TODO: Updated ${params.items.length} items`,
                output: `Updated TODO list:\n${list.items.map(i => `- [${i.status}] ${i.content}`).join("\n")}`,
              }
            }
            case "list": {
              if (!list) {
                return { title: "TODO: No list found", output: "No TODO list found for this session." }
              }
              const pending = list.items.filter(i => i.status === "pending")
              const inProgress = list.items.filter(i => i.status === "in_progress")
              const completed = list.items.filter(i => i.status === "completed")
              return {
                title: `TODO: ${pending.length} pending, ${inProgress.length} in progress, ${completed.length} completed`,
                output: [
                  "## TODO List",
                  "",
                  "### In Progress",
                  ...inProgress.map(i => `- [ ] ${i.content} (${i.priority})`),
                  "### Pending",
                  ...pending.map(i => `- [ ] ${i.content} (${i.priority})`),
                  "### Completed",
                  ...completed.map(i => `- [x] ${i.content}`),
                ].join("\n"),
              }
            }
            case "clear": {
              const todoPath = getTodoPath(projectRoot, params.sessionId)
              if (fs.existsSync(todoPath)) {
                fs.unlinkSync(todoPath)
              }
              yield* events.publish(TodoEvent.Updated, {
                sessionID: params.sessionId,
                todos: [],
              }).pipe(Effect.catchAll(() => Effect.void))
              return { title: "TODO: Cleared", output: "TODO list cleared." }
            }
            default:
              return { title: "TODO: Unknown action", output: `Unknown action: ${params.action}. Use 'create', 'update', 'list', or 'clear'.` }
          }
        }).pipe(Effect.orDie),
    }
  }),
)

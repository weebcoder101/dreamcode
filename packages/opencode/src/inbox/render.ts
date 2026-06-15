import type { ReturnStatus } from "@/actor/return-header"

export function renderActorNotification(input: {
  actorID: string
  description: string
  status: "completed" | "failed" | "cancelled"
  result?: string
  error?: string
  reportedStatus?: ReturnStatus
  reportedSummary?: string
}): string {
  const parts: string[] = [`Actor ${input.actorID} (${input.description}) ${input.status}`]
  if (input.reportedSummary) parts.push(`Summary: ${input.reportedSummary}`)
  if (input.result) parts.push(`Result: ${input.result}`)
  if (input.error) parts.push(`Error: ${input.error}`)
  return parts.join("\n")
}

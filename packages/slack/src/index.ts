import { App } from "@slack/bolt"
import { createOpencode, type ToolPart } from "@opencode-ai/sdk"

const SLACK_LOG_DEBUG = process.env.SLACK_LOG_DEBUG === "1"

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
})

if (SLACK_LOG_DEBUG) {
  console.log("🔧 Bot configuration:")
  console.log("- Bot token present:", !!process.env.SLACK_BOT_TOKEN)
  console.log("- Signing secret present:", !!process.env.SLACK_SIGNING_SECRET)
  console.log("- App token present:", !!process.env.SLACK_APP_TOKEN)
  console.log("🚀 Starting opencode server...")
}

const opencode = await createOpencode({
  port: 0,
})
if (SLACK_LOG_DEBUG) console.log("✅ Opencode server ready")

const sessions = new Map<string, { client: any; server: any; sessionId: string; channel: string; thread: string }>()
void (async () => {
  const events = await opencode.client.event.subscribe()
  for await (const event of events.stream) {
    if (event.type === "message.part.updated") {
      const part = event.properties.part
      if (part.type === "tool") {
        // Find the session for this tool update
        for (const [_sessionKey, session] of sessions.entries()) {
          if (session.sessionId === part.sessionID) {
            void handleToolUpdate(part, session.channel, session.thread)
            break
          }
        }
      }
    }
  }
})()

async function handleToolUpdate(part: ToolPart, channel: string, thread: string) {
  if (part.state.status !== "completed") return
  const toolMessage = `*${part.tool}* - ${part.state.title}`
  await app.client.chat
    .postMessage({
      channel,
      thread_ts: thread,
      text: toolMessage,
    })
    .catch(() => {})
}

// Redact Slack message text and other user-controlled fields before logging
// so transcripts shipped to Logpush / journald do not retain PII.
function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[depth]"
  if (value == null) return value
  if (typeof value === "string") {
    return value.length > 200 ? value.slice(0, 200) + "…" : value
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1))
  if (typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      if (k === "text" || k === "message" || k === "command" || k === "raw") {
        out[k] = "[redacted]"
      } else {
        out[k] = redact(v, depth + 1)
      }
    }
    return out
  }
  return value
}
function logEvent(label: string, payload: unknown) {
  if (!SLACK_LOG_DEBUG) return
  console.log(label, JSON.stringify(redact(payload), null, 2))
}
function logText(label: string, text: unknown) {
  if (!SLACK_LOG_DEBUG) return
  const safe = typeof text === "string" ? (text.length > 200 ? text.slice(0, 200) + "…" : text) : text
  console.log(label, safe)
}

app.use(async ({ next, context }) => {
  logEvent("📡 Raw Slack event:", context)
  await next()
})

app.message(async ({ message, say }) => {
  logEvent("📨 Received message event:", message)

  if (message.subtype || !("text" in message) || !message.text) {
    console.log("⏭️ Skipping message - no text or has subtype")
    return
  }

  logText("✅ Processing message:", message.text)

  const channel = message.channel
  const thread = (message as any).thread_ts || message.ts
  const sessionKey = `${channel}-${thread}`

  let session = sessions.get(sessionKey)

  if (!session) {
    console.log("🆕 Creating new opencode session...")
    const { client, server } = opencode

    const createResult = await client.session.create({
      body: { title: `Slack thread ${thread}` },
    })

    if (createResult.error) {
      console.error("❌ Failed to create session:", createResult.error)
      await say({
        text: "Sorry, I had trouble creating a session. Please try again.",
        thread_ts: thread,
      })
      return
    }

    console.log("✅ Created opencode session:", createResult.data.id)

    session = { client, server, sessionId: createResult.data.id, channel, thread }
    sessions.set(sessionKey, session)

    const shareResult = await client.session.share({ path: { id: createResult.data.id } })
    if (!shareResult.error && shareResult.data) {
      const sessionUrl = shareResult.data.share?.url
      console.log("🔗 Session shared:", sessionUrl)
      await app.client.chat.postMessage({ channel, thread_ts: thread, text: sessionUrl })
    }
  }

  logText("📝 Sending to opencode:", message.text)
  const result = await session.client.session.prompt({
    path: { id: session.sessionId },
    body: { parts: [{ type: "text", text: message.text }] },
  })

  logEvent("📤 Opencode response:", result)

  if (result.error) {
    console.error("❌ Failed to send message:", result.error)
    await say({
      text: "Sorry, I had trouble processing your message. Please try again.",
      thread_ts: thread,
    })
    return
  }

  const response = result.data

  // Build response text
  const responseText =
    response.info?.content ||
    response.parts
      ?.filter((p: any) => p.type === "text")
      .map((p: any) => p.text)
      .join("\n") ||
    "I received your message but didn't have a response."

  logText("💬 Sending response:", responseText)

  // Send main response (tool updates will come via live events)
  await say({ text: responseText, thread_ts: thread })
})

app.command("/test", async ({ command, ack, say }) => {
  await ack()
  logEvent("🧪 Test command received:", command)
  await say("🤖 Bot is working! I can hear you loud and clear.")
})

await app.start()
console.log("⚡️ Slack bot is running!")

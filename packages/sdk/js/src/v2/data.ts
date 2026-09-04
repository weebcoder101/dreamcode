import type { Part, UserMessage } from "./client.js"

// Generate a fresh, unique ID for test/fixture messages and parts.
// Replaces the previous `"asdasd"` placeholder that would collide across
// in-memory messages within the same session.
function createMessageID(): string {
  return `msg_${crypto.randomUUID()}`
}

function createPartID(): string {
  return `prt_${crypto.randomUUID()}`
}

export const message = {
  user(input: Omit<UserMessage, "role" | "time" | "id"> & { parts: Omit<Part, "id" | "sessionID" | "messageID">[] }): {
    info: UserMessage
    parts: Part[]
  } {
    const { parts: _parts, ...rest } = input

    const info: UserMessage = {
      ...rest,
      id: createMessageID(),
      time: {
        created: Date.now(),
      },
      role: "user",
    }

    return {
      info,
      parts: input.parts.map(
        (part) =>
          ({
            ...part,
            id: createPartID(),
            messageID: info.id,
            sessionID: info.sessionID,
          }) as Part,
      ),
    }
  },
}

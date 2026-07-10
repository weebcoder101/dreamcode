export const meta = {
  name: 'deep-research',
  description: 'Decomposes a question into 2–3 targeted research directions for parallel subagent investigation. The parent agent must spawn research subagents via the task tool with subagent_type: "deep-research".',
  whenToUse: 'Use when the user wants a thorough, multi-source investigation of a complex question. The script splits the question into complementary sub-questions. The parent agent then spawns 2-3 research subagents via the task tool, each getting a different variant. Max 3 subagents total (hard cap).',
  phases: [
    { title: "Plan", detail: "Decompose the question into 2-3 complementary search directions" },
  ],
}

// ─── Structured-output shapes ───
const PLAN_SHAPE = {
  type: "object", required: ["original_question", "sub_questions", "strategy"],
  properties: {
    original_question: { type: "string" },
    strategy: { type: "string" },
    sub_questions: { type: "array", minItems: 2, maxItems: 3, items: {
      type: "object", required: ["topic", "query", "angle"],
      properties: {
        topic: { type: "string" },
        query: { type: "string" },
        angle: { type: "string" },
      },
    }},
  },
}

// ─── Plan: split the question into 2-3 research vectors ───
phase("Plan")
const TOPIC = (typeof args === "string" && args.trim()) || ""
if (!TOPIC) {
  return { error: "No research question provided." }
}

const plan = await agent(
  "You are a research strategist. Your task is to decompose the user's question into 2-3 targeted, complementary research directions.\n\n" +
  "## Question\n" + TOPIC + "\n\n" +
  "## What to produce\n" +
  "Break the question into at least 2 and at most 3 sub-questions that approach the topic from different angles.\n" +
  "Choose directions that fit the subject. Each sub-question should:\n" +
  "- Be self-contained and focused enough for a single researcher to investigate\n" +
  "- Cover a different angle or dimension of the main question\n" +
  "- Include a specific web search query\n\n" +
  "Return the original question, a one-line strategy summary, and 2-3 sub-questions.\n" +
  "Keep queries tight enough to surface high-signal pages without overlap.\n\nReturn structured output only.",
  { label: "plan", schema: PLAN_SHAPE }
)

if (!plan) {
  return {
    original_question: TOPIC,
    error: "Failed to decompose question.",
    sub_questions: [],
    strategy: "",
  }
}

log("Decomposed into " + plan.sub_questions.length + " sub-questions: " + plan.sub_questions.map(q => q.topic).join(", "))

// Return the plan. The parent agent will read this and spawn
// research subagents via the task tool with subagent_type: "deep-research".
// Each subagent gets one sub-question variant.
// The parent MUST enforce: 2-3 subagents total, hard cap 3.
// The parent MUST NOT re-run sensor gate for deep-research prompts.
return {
  original_question: plan.original_question || TOPIC,
  strategy: plan.strategy || "",
  sub_questions: plan.sub_questions.map(q => ({
    topic: q.topic,
    query: q.query,
    angle: q.angle,
  })),
  // Instruction for the parent agent:
  _parent_instruction: "Spawn 2-3 research subagents via the task tool. Use subagent_type: 'deep-research'. Give each subagent a different sub_question from the list above as their research topic. Hard cap: 3 subagents max. Do NOT re-run sensor gate for these prompts.",
}

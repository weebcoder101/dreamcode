---
description: Deep multi-step research harness — decomposes queries, searches in parallel, iteratively refines, and synthesizes cited reports
agent: deep-research
subtask: false
---

Load the `deep-research` skill.

Decompose the following research query into 2-3 complementary sub-questions, spawn a `deep-research` subagent for each via the Task tool (`subagent_type: "deep-research"`), collect their findings, and synthesize a final cited report.

If web search returns 0 sources, fall back to manual web search tools.

## Query

$ARGUMENTS

## Rules
- Never do research yourself — always delegate to deep-research subagents via the Task tool
- Hard cap: 3 subagents max
- Each subagent gets ONE sub-question as their research topic
- After all subagents complete, produce a synthesized executive summary with key findings, contradictions, and sourced citations
- The `$ARGUMENTS` text is the FULL user query — decompress and use it as-is

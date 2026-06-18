---
description: Deep multi-step research harness — decomposes queries, searches in parallel, iteratively refines, and synthesizes cited reports
subtask: true
---

Load the `deep-research` skill and execute deep research on the following topic:

$ARGUMENTS

Follow the deep-research harness methodology:
1. PHASE 1: PLANNING — Decompose the query into 5-8 sub-questions
2. PHASE 2: PARALLEL SEARCH — Search for each sub-question using web search tools
3. PHASE 3: DEEP READ — Fetch key URLs and extract relevant content
4. PHASE 4: GAP DETECTION — Analyze coverage, identify missing angles, generate follow-ups
5. PHASE 5: SYNTHESIS — Cluster findings by theme, resolve contradictions, build cited report
6. PHASE 6: SELF-CRITIQUE — Check completeness, verify citations, improve clarity

Use `standard` mode unless the user specifies otherwise. If web search returns 0 sources, fall back to manual web search tools. Produce a final report with executive summary, key findings, contradictions, and sourced citations.

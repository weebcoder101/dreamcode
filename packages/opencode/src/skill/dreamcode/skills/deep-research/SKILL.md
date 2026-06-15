---
name: deep-research
description: >
  DEEP multi-step research harness. Decomposes queries into sub-questions,
  executes parallel web searches via Pieces MCP, iteratively refines with
  gap detection, and synthesizes cited reports. Architecture inspired by
  GPT Researcher (27.6k stars), Vane/Perplexica (35.2k stars), and Gemini
  Deep Research. Use when user asks for deep research, investigation,
  analysis, comparison, or any task requiring exhaustive web research.
category: SPECIALIZED
chains_with:
  - neuro
  - code-hardener
  - lint-fixer
  - pieces-ltm
  - automated-learning
triggers:
  - research
  - deep research
  - investigate
  - analyze
  - compare
  - find out
  - what is
  - how does
  - tell me about
---

# Deep Research — Multi-Step Exhaustive Web Research

## Purpose

Conduct deep, multi-step web research that goes beyond single-search queries.
Decomposes complex questions into sub-questions, searches in parallel, identifies
knowledge gaps, iteratively refines, and produces cited synthesis reports.

## Architecture (Hybrid: GPT Researcher + Gemini Deep Research)

```
User Query
    │
    ▼
┌──────────────────────────────┐
│  PHASE 1: PLANNING           │  ← GPT Researcher pattern
│  Decompose into sub-questions│
│  Classify research depth     │
└──────────────┬───────────────┘
               │ sub_questions[]
               ▼
┌──────────────────────────────┐
│  PHASE 2: PARALLEL SEARCH    │  ← GPT Researcher pattern
│  Fire searches for each      │
│  sub-question via Pieces MCP │
│  Collect top N results each  │
└──────────────┬───────────────┘
               │ search_results[]
               ▼
┌──────────────────────────────┐
│  PHASE 3: DEEP READ          │  ← Perplexica pattern
│  Fetch key URLs              │
│  Extract relevant content    │
│  Track source quality        │
└──────────────┬───────────────┘
               │ extracted_content[]
               ▼
┌──────────────────────────────┐
│  PHASE 4: GAP DETECTION      │  ← Gemini pattern
│  Analyze coverage            │
│  Identify missing angles     │
│  Generate follow-up queries  │
└──────────────┬───────────────┘
               │ (loop back to Phase 2 if gaps found)
               ▼
┌──────────────────────────────┐
│  PHASE 5: SYNTHESIS          │
│  Cluster findings by theme   │
│  Resolve contradictions      │
│  Build cited report          │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│  PHASE 6: SELF-CRITIQUE      │  ← Gemini pattern
│  Check completeness          │
│  Verify citations            │
│  Improve clarity             │
└──────────────┬───────────────┘
               │
               ▼
          Final Report
```

## Research Depth Modes

| Mode | Sub-questions | Searches per question | Max iterations | Use case |
|------|--------------|----------------------|----------------|----------|
| `quick` | 3-5 | 3 | 1 | Quick factual lookup |
| `standard` | 5-8 | 5 | 2 | Normal research task |
| `deep` | 8-12 | 8 | 3 | Exhaustive analysis |
| `exhaustive` | 12-20 | 10 | 4 | Deep dive, no stone unturned |

## CLI Usage

```bash
# Standard research
python .opencode/skills/deep-research/scripts/deep_research.py \
  --query "Compare Flask vs FastAPI for production ML APIs" \
  --mode standard

# Deep research with custom depth
python .opencode/skills/deep-research/scripts/deep_research.py \
  --query "What are the security implications of running LLMs locally?" \
  --mode deep

# Quick factual research
python .opencode/skills/deep-research/scripts/deep_research.py \
  --query "Latest Flask security vulnerabilities 2026" \
  --mode quick

# Save report to file
python .opencode/skills/deep-research/scripts/deep_research.py \
  --query "Quantum computing risk analysis methods" \
  --mode deep \
  --output research_report.md

# Pipe to stdout (for agent consumption)
python .opencode/skills/deep-research/scripts/deep_research.py \
  --query "..." \
  --mode standard \
  --print
```

## Output Format

```markdown
# Research Report: <query>

**Mode:** <mode> | **Sub-questions:** <count> | **Sources:** <count> | **Iterations:** <count>

## Executive Summary
<2-3 paragraph synthesis>

## Key Findings

### 1. <Theme 1>
<finding with citation [1]>

### 2. <Theme 2>
<finding with citation [2]>

...

## Contradictions & Open Questions
<areas where sources disagree or info is missing>

## Sources
[1] <url> — <title>
[2] <url> — <title>
...

## Research Metadata
- Sub-questions explored: <list>
- Search iterations: <count>
- Total searches performed: <count>
- Pages fetched: <count>
- Gap follow-ups: <count>
```

## Integration with Ecosystem

### After Research Completion
```python
from scripts.deep_research import DeepResearcher

researcher = DeepResearcher(query="...", mode="standard")
report = researcher.research()

# Auto-persist to Pieces LTM
# Primary: TypeScript Effect service (when running inside opencode runtime)
#   PiecesLTM.Service.persist({ chainName: "deep-research", ... })
# Fallback: Python pieces_persist.py
import sys
sys.path.insert(0, ".opencode/skills/pieces-ltm/scripts")
from pieces_persist import persist_chain_result

persist_chain_result(
    chain_name="deep-research",
    task_description=f"Research: {report['query']}",
    outcome="success",
    files_changed=[report.get("output_path", "")],
    key_decisions=[f"Found {len(report['sources'])} sources across {len(report['sub_questions'])} sub-questions"],
)
```

### Skill Chain Position
```
exhaustive-crosscheck → neuro → code-hardener → lint-fixer → deep-research → pieces-ltm → automated-learning
```

## Zero-Source Fallback Pattern (Critical)

Production analysis shows 6/8 deep-research runs return 0 sources with `elapsed_seconds < 1s` for 195 searches — the `pieces_web_search` tool consistently returns empty.

**Detection:** If sources_found == 0 AND elapsed_seconds < 10 AND total_searches > 50, the Pieces MCP web search has silently failed.

**Fallback protocol (MANDATORY):**
1. Abort the current deep-research harness iteration.
2. Log the failure to `research_runs.jsonl` with `web_search_fallback: true`.
3. Retry using manual `websearch` tool directly for each sub-question.
4. If manual websearch yields results, feed them into the deep-research synthesis phase manually.
5. If all searches fail, return a report with `sources_found: 0` and a note explaining search was unavailable.

## Self-Evolution

After every research run:
1. Log to `evolution/research_runs.jsonl`
2. Track which sub-questions yielded the most useful results
3. Optimize gap detection heuristics based on iteration counts
4. Update confidence thresholds based on source quality scores

## References

- GPT Researcher: https://github.com/assafelovic/gpt-researcher (27.6k stars)
- Vane/Perplexica: https://github.com/ItzCrazyKns/Vane (35.2k stars)
- Gemini Deep Research: Google Interactions API Deep Research Agent
- Pieces MCP: web_search tool via Perplexity Sonar API

# Cursor Decomposition Guide

## Input: Raw User Prompt

Example: "What questions did Bhuwin ask regarding everything when the team was presenting?"

## Step 1: Extract 5 Dimensions

### Temporal
Look for: time phrases, dates, relative references
- "yesterday" → yesterday date range
- "last week" → last Monday–Sunday
- "when the team was presenting" → infer from context (meeting time)
- "May 23" → specific date
- No explicit time → default to last 7 days

### Source
Look for: applications, tools, platforms, modalities
- "presenting" → Google Meet, presentation tools
- "meeting" → Meet, Zoom, Teams
- "VS Code" → IDE
- "Chrome" → browser
- Audio/video → audio_input

### Gesture
Look for: action verbs, activities
- "asked" → questioning, qa
- "presenting" → presenting, sharing screen
- "coding" → programming
- "reviewing" → review
- "discussing" → discussion

### Topic
Look for: subjects, projects, technologies, keywords
- "quantum POC" → quantum, QAE, Qiskit
- "VaR" → risk metrics
- "backtesting" → validation
- "comparison chart" → ES, VaR comparison
- "pipeline" → data pipeline

### People
Look for: names, roles, person references
- "Bhuwin" → Bhuwin Rag Cheekati
- "Ankur" → Ankur Chakraborty
- "Sunil" → Sunil Karki
- "Grace" → Grace Mwangi
- "team" → all team members

## Step 2: Confidence Scoring Rules

### Temporal Confidence
| Cue | Confidence | Logic |
|-----|-----------|-------|
| Explicit date ("May 23") | 0.95 | Parseable, unambiguous |
| Relative ("yesterday") | 0.90 | Needs computation, reliable |
| Vague ("recently") | 0.50 | Ambiguous, needs refinement |
| None | 0.30 | Default fallback |

### Source Confidence
| Cue | Confidence | Logic |
|-----|-----------|-------|
| Named app ("Meet", "Chrome") | 0.85 | Direct match |
| Modality ("audio", "video") | 0.70 | Broad, needs confirmation |
| Implied ("meeting") | 0.55 | Inferred |
| None | 0.20 | Weak signal |

### Gesture Confidence
| Cue | Confidence | Logic |
|-----|-----------|-------|
| Explicit verb ("asked") | 0.60 | Direct action — but LTM audio transcripts often have unknown speakers, making verb attribution unreliable |
| Implied ("discussed", "feedback") | 0.50 | Inferred from context; often overmatched in meeting audio |
| Vague ("did", "was") | 0.25 | Too generic |
| None | 0.10 | No signal |
| Observed in screen capture ("asking question in Meet UI") | 0.80 | Vision evidence stronger than audio for gesture |

### Topic Confidence
| Cue | Confidence | Logic |
|-----|-----------|-------|
| Named project/keyword | 0.80 | Specific searchable term |
| Domain term ("VaR", "ES") | 0.70 | Domain-specific |
| General ("code", "work") | 0.35 | Too broad |
| None | 0.10 | No signal |

### People Confidence
| Cue | Confidence | Logic |
|-----|-----------|-------|
| Full name ("Bhuwin Rag Cheekati") | 0.98 | Unambiguous |
| First name ("Bhuwin") | 0.90 | Strong, common name |
| Partial or nickname | 0.60 | May have false positives |
| Role ("the presenter") | 0.40 | Needs resolution |
| None | 0.05 | No signal |

## Step 3: Cursor-to-Pieces-Tool Mapping

| Cursor | Primary Tool | Secondary Tool | Parameters |
|--------|-------------|----------------|------------|
| Temporal | `pieces_time_compute` → `pieces_search_memory` | `pieces_extract_temporal_range` | `created.from` / `created.to` |
| Source | `pieces_search_memory` | `pieces_workstream_events_full_text_search` | `sources` |
| Gesture | `pieces_search_memory` | `pieces_workstream_events_full_text_search` | `sources` with action keywords |
| Topic | `pieces_search_memory` | `pieces_annotations_full_text_search` | `hints` |
| People | `pieces_search_memory` | `pieces_persons_full_text_search` | `persons` |

## Step 4: Weighted Parameter Construction

For `pieces_search_memory`, construct the call like this:

```json
{
  "persons": [{"value": "Bhuwin"}, {"value": "Bhuwin Rag Cheekati"}],
  "hints": [
    {"value": "team presentation"},
    {"value": "questions"},
    {"value": "feedback"},
    {"value": "VaR comparison"},
    {"value": "quantum POC"}
  ],
  "sources": [
    {"value": "meeting"},
    {"value": "presentation"},
    {"value": "Google Meet"},
    {"value": "asked"}
  ],
  "created": {
    "from": "2026-05-23T00:00:00Z",
    "to": "2026-05-24T23:59:59Z"
  }
}
```

The confidence scores determine:
- Whether the cursor is included at all (> 0.3 required)
- The order of values within each array (highest confidence first)
- Whether to paginate more aggressively for lower-confidence cursors

## Step 5: Refinement After First Page

After receiving first page results, refine cursor values:

- If People cursor returned many results → consider narrowing with more specific name variants
- If Topic cursor returned irrelevant results → drop low-performing keywords, add higher-specificity ones
- If Temporal cursor returned too many/few results → widen or narrow the window
- If Source cursor missed events → try alternative application names
- If Gesture cursor overmatched → use more specific verbs

---
name: youtube-transcript
description: Fetch, analyze, and summarize YouTube video transcripts. Use when the user wants to extract transcript from a YouTube video, summarize a video's content, or use video transcripts as coding context.
category: SPECIALIZED
chains_with: [communication, research]
---

# YouTube Transcript Skill

Fetch any YouTube video's full transcript, then analyze, summarize, or use it as context.

## Quick Start

### Via MCP (if youtube-transcript MCP is enabled in opencode.json)

The `youtube-transcript` MCP server provides a `get_transcript` tool:

```python
# Agent calls MCP tool directly
result = mcp_call("get_transcript", {"url": "https://youtube.com/watch?v=VIDEO_ID", "lang": "en"})
```

### Via Python (fallback — works without MCP)

```bash
# Install yt-dlp if not present
pip install yt-dlp

# Fetch transcript
python3 .opencode/skills/youtube-transcript/scripts/yt_transcript.py \
  --url "https://www.youtube.com/watch?v=VIDEO_ID" \
  --output /tmp/transcript.txt
```

## Workflows

### 1. Fetch + Summarize

```bash
# Fetch transcript
python3 .opencode/skills/youtube-transcript/scripts/yt_transcript.py \
  --url "https://youtube.com/watch?v=VIDEO_ID" \
  --output /tmp/transcript.txt

# Then use the transcript as context for any task
# The agent reads the file and summarizes/analyzes it
```

### 2. Fetch + Use as Coding Context

```bash
# Fetch transcript from a coding tutorial
python3 .opencode/skills/youtube-transcript/scripts/yt_transcript.py \
  --url "https://youtube.com/watch?v=VIDEO_ID" \
  --format markdown

# Agent uses the transcript to implement the pattern described in the video
```

### 3. Batch Fetch (multiple videos)

```bash
# Fetch transcripts for a playlist or multiple URLs
python3 .opencode/skills/youtube-transcript/scripts/yt_transcript.py \
  --url "https://youtube.com/watch?v=VIDEO_ID_1" \
  --url "https://youtube.com/watch?v=VIDEO_ID_2" \
  --output /tmp/transcripts/
```

## Parameters

| Param | Description | Default |
|-------|-------------|---------|
| `--url` / `-u` | YouTube video URL or ID | (required) |
| `--lang` / `-l` | Transcript language code | `en` |
| `--output` / `-o` | Output file path | stdout |
| `--format` / `-f` | Output format: `text`, `markdown`, `json` | `text` |
| `--timestamps` / `-t` | Include timestamps | false |
| `--verbose` / `-v` | Verbose output | false |

## Output Formats

### text (default)
```
0:00 Welcome to this tutorial...
0:15 Today we're going to build...
1:00 Let's start with the setup...
```

### markdown
```markdown
# Video Title

**Duration:** 15:30 | **Language:** en

## Transcript

[0:00] Welcome to this tutorial...
[0:15] Today we're going to build...
[1:00] Let's start with the setup...
```

### json
```json
{
  "video_id": "abc123",
  "title": "Video Title",
  "duration": 930,
  "language": "en",
  "segments": [
    {"start": 0.0, "end": 15.0, "text": "Welcome to this tutorial..."},
    {"start": 15.0, "end": 60.0, "text": "Today we're going to build..."}
  ]
}
```

## Tips

- If transcript is not available in the target language, try `--lang en` as fallback
- Some videos have auto-generated captions (lower quality) vs manual captions
- Use `--timestamps` for longer videos to navigate easily
- The transcript can be passed as context to any skill chain (neuro, code-hardener, etc.)

## Dependencies

- `yt-dlp` (Python package) — for transcript extraction
- No YouTube API key required

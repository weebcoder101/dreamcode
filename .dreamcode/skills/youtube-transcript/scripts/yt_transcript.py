#!/usr/bin/env python3
"""yt_transcript.py — YouTube Transcript Extractor

Fetches YouTube video transcripts using yt-dlp (no API key needed).
Supports multiple output formats: text, markdown, json.

Usage:
    python yt_transcript.py --url "https://youtube.com/watch?v=abc123"
    python yt_transcript.py --url "abc123" --lang en --format markdown
    python yt_transcript.py --url "abc123" --timestamps --output transcript.txt
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from datetime import timedelta
from pathlib import Path

# ---------------------------------------------------------------------------
# Data Structures
# ---------------------------------------------------------------------------

@dataclass
class TranscriptSegment:
    start: float
    end: float
    text: str

    @property
    def timestamp(self) -> str:
        td = timedelta(seconds=self.start)
        hours = int(td.total_seconds() // 3600)
        minutes = int((td.total_seconds() % 3600) // 60)
        seconds = int(td.total_seconds() % 60)
        if hours > 0:
            return f"{hours}:{minutes:02d}:{seconds:02d}"
        return f"{minutes}:{seconds:02d}"


@dataclass
class Transcript:
    video_id: str
    title: str
    duration: float
    language: str
    segments: list[TranscriptSegment] = field(default_factory=list)

    @property
    def full_text(self) -> str:
        return " ".join(s.text for s in self.segments)

    @property
    def word_count(self) -> int:
        return len(self.full_text.split())


# ---------------------------------------------------------------------------
# Transcript Fetching
# ---------------------------------------------------------------------------

def extract_video_id(url: str) -> str:
    """Extract YouTube video ID from URL or bare ID."""
    # Bare ID (11 chars, alphanumeric + _ -)
    if re.match(r'^[a-zA-Z0-9_-]{11}$', url):
        return url

    # Standard URLs
    patterns = [
        r'(?:v=|/v/|youtu\.be/)([a-zA-Z0-9_-]{11})',
        r'(?:embed/)([a-zA-Z0-9_-]{11})',
        r'(?:shorts/)([a-zA-Z0-9_-]{11})',
    ]
    for pattern in patterns:
        m = re.search(pattern, url)
        if m:
            return m.group(1)

    # Fallback: try to find any 11-char ID
    m = re.search(r'([a-zA-Z0-9_-]{11})', url)
    if m:
        return m.group(1)

    return url


def fetch_transcript(video_id: str, lang: str = "en",
                     verbose: bool = False) -> Transcript:
    """Fetch transcript using yt-dlp's subtitle extraction."""
    try:
        import yt_dlp
    except ImportError:
        print("ERROR: yt-dlp not installed. Run: pip install yt-dlp",
              file=sys.stderr)
        sys.exit(1)

    # Get video info first
    ydl_opts = {
        'skip_download': True,
        'quiet': not verbose,
        'no_warnings': not verbose,
    }

    video_url = f"https://www.youtube.com/watch?v={video_id}"

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(video_url, download=False)

    title = info.get('title', 'Unknown')
    duration = info.get('duration', 0)

    # Try to get subtitles/captions
    subs = info.get('subtitles', {})
    auto_subs = info.get('automatic_captions', {})

    # Prefer manual subs, fall back to auto
    available_langs = list(subs.keys())
    auto_langs = list(auto_subs.keys())

    chosen_lang = lang
    source = subs

    if lang not in available_langs:
        if lang in auto_langs:
            source = auto_subs
        elif available_langs:
            chosen_lang = available_langs[0]
        elif auto_langs:
            chosen_lang = auto_langs[0]
            source = auto_subs
        else:
            return Transcript(
                video_id=video_id,
                title=title,
                duration=duration,
                language=lang,
                segments=[],
            )

    # Download subtitle file
    sub_entries = source.get(chosen_lang, [])
    if not sub_entries:
        return Transcript(
            video_id=video_id,
            title=title,
            duration=duration,
            language=chosen_lang,
            segments=[],
        )

    # Find the best format (json3 > srv3 > vtt)
    sub_url = None
    for ext in ['json3', 'srv3', 'vtt']:
        for entry in sub_entries:
            if entry.get('ext') == ext:
                sub_url = entry['url']
                break
        if sub_url:
            break

    if not sub_url and sub_entries:
        sub_url = sub_entries[0].get('url')

    if not sub_url:
        return Transcript(
            video_id=video_id,
            title=title,
            duration=duration,
            language=chosen_lang,
            segments=[],
        )

    # Fetch the subtitle content
    import urllib.request
    try:
        req = urllib.request.Request(sub_url)
        with urllib.request.urlopen(req, timeout=30) as resp:
            sub_content = resp.read().decode('utf-8')
    except Exception as e:
        print(f"WARNING: Failed to fetch subtitles: {e}", file=sys.stderr)
        return Transcript(
            video_id=video_id,
            title=title,
            duration=duration,
            language=chosen_lang,
            segments=[],
        )

    # Parse the subtitle content
    segments = _parse_subtitles(sub_content, sub_entries[0].get('ext', 'vtt'))

    return Transcript(
        video_id=video_id,
        title=title,
        duration=duration,
        language=chosen_lang,
        segments=segments,
    )


def _parse_subtitles(content: str, fmt: str) -> list[TranscriptSegment]:
    """Parse subtitle content into segments."""
    if fmt == 'json3':
        return _parse_json3(content)
    elif fmt == 'srv3':
        return _parse_srv3(content)
    else:
        return _parse_vtt(content)


def _parse_json3(content: str) -> list[TranscriptSegment]:
    """Parse JSON3 subtitle format."""
    try:
        data = json.loads(content)
        events = data.get('events', [])
        segments = []
        for event in events:
            segs = event.get('segs', [])
            text = ''.join(s.get('utf8', '') for s in segs).strip()
            if not text or text == '\n':
                continue
            start = event.get('tStartMs', 0) / 1000.0
            dur = event.get('dDurationMs', 0) / 1000.0
            segments.append(TranscriptSegment(
                start=start,
                end=start + dur,
                text=text,
            ))
        return segments
    except (json.JSONDecodeError, KeyError):
        return []


def _parse_srv3(content: str) -> list[TranscriptSegment]:
    """Parse SRV3 subtitle format."""
    segments = []
    pattern = r'<p t="(\d+)" d="(\d+)">(.*?)</p>'
    for m in re.finditer(pattern, content, re.DOTALL):
        start = int(m.group(1)) / 1000.0
        dur = int(m.group(2)) / 1000.0
        text = re.sub(r'<[^>]+>', '', m.group(3)).strip()
        if text:
            segments.append(TranscriptSegment(
                start=start,
                end=start + dur,
                text=text,
            ))
    return segments


def _parse_vtt(content: str) -> list[TranscriptSegment]:
    """Parse WebVTT subtitle format."""
    segments = []
    blocks = re.split(r'\n\s*\n', content)
    for block in blocks:
        lines = block.strip().split('\n')
        for i, line in enumerate(lines):
            if '-->' in line:
                times = line.split('-->')
                start = _vtt_time_to_seconds(times[0].strip())
                end = _vtt_time_to_seconds(times[1].strip())
                text_lines = lines[i + 1:]
                text = ' '.join(
                    re.sub(r'<[^>]+>', '', l).strip()
                    for l in text_lines if l.strip()
                )
                if text:
                    segments.append(TranscriptSegment(
                        start=start,
                        end=end,
                        text=text,
                    ))
                break
    return segments


def _vtt_time_to_seconds(time_str: str) -> float:
    """Convert VTT timestamp to seconds."""
    parts = time_str.replace(',', '.').split(':')
    if len(parts) == 3:
        return float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2])
    elif len(parts) == 2:
        return float(parts[0]) * 60 + float(parts[1])
    return float(parts[0])


# ---------------------------------------------------------------------------
# Output Formatting
# ---------------------------------------------------------------------------

def format_text(transcript: Transcript, include_timestamps: bool = False) -> str:
    """Format as plain text."""
    if include_timestamps:
        lines = []
        for seg in transcript.segments:
            lines.append(f"{seg.timestamp} {seg.text}")
        return "\n".join(lines)
    return transcript.full_text


def format_markdown(transcript: Transcript, include_timestamps: bool = False) -> str:
    """Format as markdown."""
    lines = [
        f"# {transcript.title}",
        "",
        f"**Video ID:** {transcript.video_id} | "
        f"**Duration:** {timedelta(seconds=int(transcript.duration))} | "
        f"**Language:** {transcript.language} | "
        f"**Words:** {transcript.word_count:,}",
        "",
        "## Transcript",
        "",
    ]

    if include_timestamps:
        for seg in transcript.segments:
            lines.append(f"[{seg.timestamp}] {seg.text}")
    else:
        lines.append(transcript.full_text)

    return "\n".join(lines)


def format_json(transcript: Transcript) -> str:
    """Format as JSON."""
    return json.dumps({
        "video_id": transcript.video_id,
        "title": transcript.title,
        "duration": transcript.duration,
        "language": transcript.language,
        "word_count": transcript.word_count,
        "segments": [
            {
                "start": s.start,
                "end": s.end,
                "timestamp": s.timestamp,
                "text": s.text,
            }
            for s in transcript.segments
        ],
    }, indent=2)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="YouTube Transcript Extractor — fetch video transcripts via yt-dlp"
    )
    parser.add_argument("--url", "-u", action="append", required=True,
                        help="YouTube video URL or ID (can be repeated)")
    parser.add_argument("--lang", "-l", default="en",
                        help="Transcript language code (default: en)")
    parser.add_argument("--output", "-o",
                        help="Output file path (default: stdout)")
    parser.add_argument("--format", "-f", choices=["text", "markdown", "json"],
                        default="text", help="Output format (default: text)")
    parser.add_argument("--timestamps", "-t", action="store_true",
                        help="Include timestamps")
    parser.add_argument("--verbose", "-v", action="store_true",
                        help="Verbose output")
    args = parser.parse_args()

    all_output = []

    for url in args.url:
        video_id = extract_video_id(url)
        if args.verbose:
            print(f"Fetching transcript for: {video_id}", file=sys.stderr)

        transcript = fetch_transcript(video_id, args.lang, args.verbose)

        if not transcript.segments:
            print(f"WARNING: No transcript found for {video_id}",
                  file=sys.stderr)
            continue

        if args.format == "text":
            all_output.append(format_text(transcript, args.timestamps))
        elif args.format == "markdown":
            all_output.append(format_markdown(transcript, args.timestamps))
        elif args.format == "json":
            all_output.append(format_json(transcript))

    combined = "\n\n---\n\n".join(all_output) if len(all_output) > 1 else (
        all_output[0] if all_output else ""
    )

    if args.output:
        Path(args.output).write_text(combined, encoding="utf-8")
        print(f"Saved to {args.output}", file=sys.stderr)
    else:
        print(combined)


if __name__ == "__main__":
    main()

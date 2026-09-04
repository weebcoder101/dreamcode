"""timezone.py — IST timezone utilities for all automation scripts.

All timestamps in the automation system use IST (India Standard Time, UTC+5:30).
This module provides helpers to get current IST time and convert between timezones.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta, timezone

# IST offset: UTC+5:30
IST = timezone(timedelta(hours=5, minutes=30))


def now_ist() -> datetime:
    """Get current time in IST."""
    return datetime.now(IST)


def now_ist_iso() -> str:
    """Get current IST time as ISO 8601 string."""
    return now_ist().isoformat()


def now_ist_filesafe() -> str:
    """Get current IST time formatted for filenames."""
    return now_ist().strftime("%Y%m%d_%H%M%S")


def now_ist_date() -> str:
    """Get current IST date as YYYY-MM-DD."""
    return now_ist().strftime("%Y-%m-%d")


def now_ist_time() -> str:
    """Get current IST time as HH:MM:SS."""
    return now_ist().strftime("%H:%M:%S")


def ist_hour() -> int:
    """Get current IST hour (0-23)."""
    return now_ist().hour


def ist_minute() -> int:
    """Get current IST minute (0-59)."""
    return now_ist().minute


def to_ist(dt: datetime) -> datetime:
    """Convert any datetime to IST."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(IST)


def format_duration(seconds: float) -> str:
    """Format seconds as human-readable duration."""
    if seconds < 60:
        return f"{seconds:.1f}s"
    elif seconds < 3600:
        minutes = seconds / 60
        return f"{minutes:.1f}m"
    else:
        hours = seconds / 3600
        return f"{hours:.1f}h"

"""timezone.py — IST (India Standard Time) utilities for dreamcode automations."""

from datetime import datetime, timezone, timedelta

IST = timezone(timedelta(hours=5, minutes=30))


def now_ist() -> datetime:
    return datetime.now(IST)


def now_ist_iso() -> str:
    return now_ist().isoformat()


def now_ist_time() -> str:
    return now_ist().strftime("%H:%M:%S")


def format_duration(seconds: float) -> str:
    if seconds < 60:
        return f"{seconds:.1f}s"
    minutes = int(seconds // 60)
    secs = seconds % 60
    if minutes < 60:
        return f"{minutes}m {secs:.0f}s"
    hours = minutes // 60
    mins = minutes % 60
    return f"{hours}h {mins}m"

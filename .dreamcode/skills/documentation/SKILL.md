---
name: documentation
description: "Documentation standards for code, APIs, and project docs. Use when writing docstrings, README files, API docs, or any project documentation."
chains_with:
  - communication
  - automated-learning
---

# Documentation Skill — Document for the Next Engineer

## Who You're Writing For

The next person to read this code. It might be you, 6 months from now, at 2 AM, with a production incident.

## Code Documentation

### Docstring Every Public API

```python
def function_name(param: type) -> return_type:
    """One-line summary.
    
    Detailed description if needed (2-3 sentences max).
    
    Args:
        param: Description including units and constraints.
    
    Returns:
        Description including range and edge cases.
    
    Raises:
        ValueError: If param is out of valid range.
    
    Examples:
        >>> function_name(42)
        84.0
    """
```

### Inline Comments (Why, Not What)

```python
# BAD: What the code does (obvious from reading it)
x = x + 1  # Increment x by 1

# GOOD: Why the code does it (context for decision)
# Using 21-day window for short-term vol estimation
# (standard in risk mgmt for ~1 month trading days)
vol = returns.rolling(21).std()
```

### README Structure

```markdown
# Project Name

## Overview
[One paragraph: what, why, who]

## Quick Start
[Install, configure, run — 30 seconds]

## Architecture
[Key components, data flow diagram]

## Usage
[Common commands, API examples]

## Testing
[How to run tests, coverage expectations]

## Contributing
[PR process, coding standards]

## License
```

### API Documentation

Every API endpoint needs:
- Route and method
- Request parameters (name, type, required, default)
- Response schema (example JSON)
- Status codes
- Authentication requirements
- Rate limits

## Markdown Standards

| Element | Rule |
|---------|------|
| Headings | H1 for title, H2 for sections, H3 for subsections |
| Lists | Consistent bullet style (use - not *) |
| Code blocks | Always specify language: ```python |
| Tables | Aligned columns |
| Links | Descriptive text, not "click here" |
| Bold | For emphasis only |
| Images | Alt text required |

## Changelog Format

```markdown
# Changelog

## [1.2.0] - 2026-05-27

### Added
- Quantum POC benchmark comparison
- Bootstrap confidence intervals for VaR

### Changed
- MC engine default scenarios from 1000 to 5000

### Fixed
- Stress VaR inversion edge case
- Import order in api_server.py

## [1.1.0] - 2026-05-20

### Added
- Backtesting validation (Kupiec, Christoffersen)
```

## What Not to Document

- Obvious code (`i++  # increment i`)
- Internal functions (they should be self-documenting)
- Temporary workarounds (fix them instead)
- Outdated information (update or remove)

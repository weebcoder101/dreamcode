---
name: api
description: "API design patterns, REST conventions, and endpoint standards. Use when creating or modifying API endpoints. Covers routing, request/response patterns, error handling, and versioning."
chains_with:
  - security
  - quality
---

# API Design Skill — Contracts First

## Design Principles

1. **Resource-oriented**: URLs name resources, not actions
2. **Consistent**: Same patterns across all endpoints
3. **Versioned**: Never break existing clients
4. **Documented**: Every endpoint has its contract
5. **Backward compatible**: Add fields, don't remove them

## REST Conventions

### URL Structure
```
GET    /api/assets              # List resources
GET    /api/assets/{id}         # Get one resource
POST   /api/assets              # Create resource
PUT    /api/assets/{id}         # Replace resource
PATCH  /api/assets/{id}         # Partial update
DELETE /api/assets/{id}         # Delete resource
```

### Query Parameters
- `?page=2&per_page=20` — Pagination
- `?sort=date&order=desc` — Sorting
- `?fields=id,name,value` — Field selection
- `?filter[status]=active` — Filtering

### Response Envelope
```json
{
  "status": "ready",
  "data": { ... },
  "meta": {
    "page": 1,
    "total": 100,
    "timestamp": "2026-05-27T10:30:00Z"
  }
}
```

### Error Response
```json
{
  "error": "Human-readable message",
  "code": "INVALID_INPUT",
  "details": {
    "field": "confidence_level",
    "reason": "Must be between 0 and 1"
  }
}
```

## Flask Patterns (Project-Q)

```python
# Standard endpoint pattern
@app.route("/api/resource")
def get_resource():
    # 1. Parse parameters
    param = request.args.get("param", default_value, type=str)
    
    # 2. Validate
    if not valid(param):
        return jsonify({"error": "Invalid param"}), 400
    
    # 3. Process
    result = compute(param)
    
    # 4. Return
    return jsonify({"status": "ready", "data": result})
```

### Cache Pattern
```python
_cache = {"data": None, "timestamp": 0}
TTL = 300  # 5 minutes

@app.route("/api/expensive")
def expensive():
    now = time.time()
    if _cache["data"] and (now - _cache["timestamp"]) < TTL:
        return jsonify(_cache["data"])
    
    data = compute()
    _cache = {"data": data, "timestamp": now}
    return jsonify(data)
```

## Project-Q API Map

| Endpoint | Method | Purpose | Cached |
|----------|--------|---------|--------|
| `/api/health` | GET | Health check | No |
| `/api/kpis` | GET | Portfolio KPIs | No |
| `/api/correlation` | GET | Correlation matrix | No |
| `/api/regime` | GET | Current regime | No |
| `/api/risk/metrics` | GET | Full risk metrics | 5 min |
| `/api/risk/backtesting` | GET | Backtesting results | No |
| `/api/quantum/summary` | GET | Quantum POC summary | No |
| `/api/quantum/run` | POST | Run quantum layer | No |
| `/api/monte-carlo/distribution` | GET | MC distribution | No |
| `/api/pipeline/run` | POST | Trigger pipeline | No |

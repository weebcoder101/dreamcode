---
name: devops
description: "Docker, CI/CD, deployment, and infrastructure management. Use for container builds, CI pipeline changes, deployment configurations, and environment setup."
chains_with:
  - security
  - quality
---

# DevOps Skill — Ship Reliably

## Docker

### Multi-stage Build Pattern

```dockerfile
# Build stage
FROM python:3.12-slim AS builder
COPY requirements.txt .
RUN pip install --user -r requirements.txt

# Runtime stage
FROM python:3.12-slim
COPY --from=builder /root/.local /root/.local
COPY src/ /app/src/
CMD ["gunicorn", "app:create_app()"]
```

### Layer Optimization
- Combine RUN commands: `RUN apt-get update && apt-get install -y pkg && rm -rf /var/lib/apt/lists/*`
- Order by change frequency: least-changing layers first
- Use `.dockerignore` to exclude unnecessary files
- Multi-stage builds to reduce final image size

## CI/CD (GitHub Actions)

### Quality Gate
```yaml
jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
      - run: pip install ruff mypy pytest
      - run: ruff check src/
      - run: mypy src/
      - run: pytest tests/ -x -q
```

### Pipeline (Project-Q)
```
lint-and-test:
  - ruff check
  - mypy src/
  - pytest tests/ -x -q

benchmarks:
  - pytest benchmarks/ --benchmark-json=results.json
  - upload artifact
```

## Environment Management

### Variables
```bash
# .env file — NEVER commit
DATABASE_URL=postgresql://localhost:5432/projectq
API_KEY=...
FLASK_ENV=development
```

### Python Environments
```bash
# Virtual environment
python -m venv .venv
source .venv/bin/activate

# Dependencies
pip install -e ".[dev]"  # Dev install
pip freeze > requirements.txt  # Pin versions
```

## Production Checklist

- [ ] Health check endpoint (`/api/health`)
- [ ] Graceful shutdown (SIGTERM handling)
- [ ] Logging to stdout (not files)
- [ ] Error tracking (Sentry)
- [ ] Rate limiting
- [ ] CORS configured
- [ ] Security headers
- [ ] Backups configured
- [ ] Monitoring alerts
- [ ] Rollback plan documented

## Docker Compose (Project-Q)

```yaml
services:
  backend:
    build: 
      context: .
      dockerfile: Dockerfile.backend
    ports: ["5005:5005"]
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:5005/api/health"]
  
  frontend:
    build:
      context: .
      dockerfile: Dockerfile.frontend
    ports: ["8080:80"]
```

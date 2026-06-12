---
name: security
description: "Security review and vulnerability analysis. Use when handling sensitive data, authentication, authorization, input validation, or any security-relevant code. Based on OWASP Top 10 patterns."
chains_with:
  - code-hardener
  - automated-learning
---

# Security Skill — Trust Nothing, Validate Everything

## Mandate

Every input is guilty until proven innocent. Every output must be encoded. Every secret must be protected.

## Trigger Conditions

- Authentication/authorization code
- User input handling
- Database queries
- API endpoint creation
- File operations
- Network requests
- Encryption/crypto operations
- Configuration containing secrets

## OWASP Top 10 Checklist

### 1. Broken Access Control
- [ ] Principle of least privilege applied
- [ ] Role-based access checks on every endpoint
- [ ] No IDOR vulnerabilities (user A cannot access user B's data)
- [ ] Rate limiting on auth endpoints

### 2. Cryptographic Failures
- [ ] No hardcoded secrets, keys, or tokens
- [ ] HTTPS everywhere in production
- [ ] Sensitive data encrypted at rest
- [ ] Passwords hashed (bcrypt/argon2), not encrypted
- [ ] No homegrown crypto — use standard libraries

### 3. Injection
- [ ] SQL: parameterized queries only (NO f-strings in SQL)
- [ ] No eval(), exec(), or os.system() with user input
- [ ] Command injection: use subprocess with list args
- [ ] XSS: output encoding context-aware

### 4. Insecure Design
- [ ] Rate limiting on all public endpoints
- [ ] Request size limits
- [ ] Input validation on server AND client
- [ ] Proper error messages (no stack traces to users)

### 5. Security Misconfiguration
- [ ] Debug mode disabled in production
- [ ] CORS configured to specific origins
- [ ] Security headers set (HSTS, CSP, X-Frame-Options)
- [ ] Default credentials changed
- [ ] Unnecessary features disabled

### 6. Vulnerable Components
- [ ] Dependencies up to date
- [ ] Known CVEs checked with `pip-audit` or `npm audit`
- [ ] Minimal dependency footprint

### 7. Authentication Failures
- [ ] MFA available for sensitive actions
- [ ] Session management secure (httpOnly, secure, SameSite)
- [ ] Account lockout after N failures
- [ ] Password complexity enforced

### 8. Data Integrity Failures
- [ ] CI/CD pipeline signed
- [ ] Software supply chain verified
- [ ] Auto-update mechanisms authenticated

### 9. Logging & Monitoring
- [ ] Security-relevant events logged
- [ ] Logs contain: timestamp, user, action, result
- [ ] No secrets in logs
- [ ] Alerts configured for suspicious patterns

### 10. SSRF
- [ ] URL validation against allowlist
- [ ] Internal network isolation
- [ ] No open redirects

## Quick Security Scan

```bash
# Python security scan
bandit -r src/ -f json

# Dependency audit
pip-audit

# SAST with semgrep
semgrep --config=auto src/

# Check for secrets
trufflehog filesystem .
```

## File-Specific Rules

### Python
- `os.system()` → `subprocess.run()` with list args
- `pickle.load()` → JSON or safer serialization
- `eval()` / `exec()` → NEVER with user input
- `assert` → NOT for validation in production

### JavaScript
- `innerHTML` → `textContent` or safe DOM API
- `eval()` → NEVER
- `document.cookie` → use httpOnly cookies
- `Math.random()` → `crypto.getRandomValues()` for security

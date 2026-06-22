# Security Policy

## Sandbox Model

DreamCode runs with **full filesystem access by default** (sandbox is opt-in). This is intentional — DreamCode reads, writes, and executes code as part of its agent workflow.

To enable sandbox mode:

```bash
export DREAMCODE_SANDBOX=on
# Or in ~/.config/dreamcode/config.yaml:
# sandbox: true
```

When sandbox is ON, commands execute inside [firejail](https://firejail.wordpress.com/) isolation.

### What Sandbox Protects Against

- Accidental host-wide damage from shell commands
- Unauthorized filesystem access by malicious prompts
- External process visibility (process isolation)

### What Sandbox Does NOT Protect Against

- Prompt injection attacks (the AI model itself may be compromised)
- Malicious npm/bun packages installed by the agent
- Credential exfiltration if the AI model's output channel is compromised
- Kernel-level escapes from firejail

## Credential Storage

API keys and OAuth tokens are stored **unencrypted** in SQLite at `~/.local/state/opencode/`.
Any process with filesystem access can extract these credentials.

**Recommended mitigations:**
- Use environment variables for API keys (e.g., `OPENAI_API_KEY`, `NEURO_API_KEY`)
- Restrict access to `~/.local/state/opencode/`
- Use full-disk encryption

## Reporting a Vulnerability

DreamCode is a community fork. To report a security issue:

1. **Do not** open a public GitHub issue for critical vulnerabilities.
2. Open a [GitHub Issue](https://github.com/weebcoder101/dreamcode/issues) with `[security]` in the title for general concerns.
3. For critical vulnerabilities, email the repository owner directly or open a draft security advisory on GitHub.

We aim to acknowledge reports within 48 hours and triage within 1 week.

## Known Security Limitations

| Issue | Status | Notes |
|-------|--------|-------|
| Credentials stored unencrypted | Known | AES-256-GCM encryption planned |
| No sandbox by default | Intentional | Opt-in for compatibility |
| Prompt injection surface | Known | Mitigated by sensor gate classification |
| `ps aux` CLI arg leak | Known | `--prompt` visible in process listing; local-only risk |
| No runtime code signing | Known | Verify binary checksums on download |

## Dependency Security

DreamCode vendors hundreds of npm dependencies. We recommend:

- Run `bun audit` regularly
- Use `DREAMCODE_SANDBOX=on` when testing third-party plugins
- Pin dependencies in production deployments

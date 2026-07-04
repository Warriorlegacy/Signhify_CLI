# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| 0.x | Yes |

## Threat Model

Signhify is an AI coding agent that executes code on your machine. **This carries inherent risk.**

### What we control

- **Permission engine** — every tool call routes through per-mode allow/deny rules
- **Shell allowlist/denylist** — restrict which commands run in `--auto` mode
- **File-write restrictions** — plan mode prevents file modifications
- **OS keychain storage** — API keys stored in OS keychain via `keytar`, never on disk

### What we do NOT control

- **LLM provider behavior** — we send prompts to external APIs (OpenAI, Anthropic, Google, etc.). Their data handling is governed by their own policies.
- **MCP server behavior** — third-party MCP servers run as subprocesses with their own capabilities
- **Malicious config files** — `signhify.config.json` can configure arbitrary MCP servers and shell commands. Review config files from untrusted sources before using them.
- **Malicious prompts** — a carefully crafted prompt could trick the model into harmful actions. Use in sandboxed environments for untrusted code.

### You should

- Run Signhify in a **Docker container or VM** when working with untrusted code
- Review Signhify's shell denylist to block dangerous commands (`rm -rf /`, `sudo`, etc.)
- Use `--auto` mode only in CI/CD where you control the environment
- Keep your API keys secure

## Reporting a Vulnerability

**Do not** open a public GitHub issue for security vulnerabilities.

Instead, report via GitHub's private vulnerability reporting:

1. Go to https://github.com/Warriorlegacy/Signhify_CLI/security/advisories
2. Click "Report a vulnerability"
3. Describe the issue, including steps to reproduce
4. You'll receive updates as we triage and fix

We aim to respond within 48 hours and release a fix within 7 days for critical issues.

## Disclosure Policy

- We will acknowledge receipt within 2 business days
- We will investigate and determine impact within 5 business days
- We will release a fix and public advisory once a fix is ready
- We will credit you (with your permission) in the advisory

## Out of Scope

- Credential leaks in personal config files
- Attacks requiring physical access
- Social engineering of contributors
- Denial of service against your own machine
- Issues in third-party dependencies (report them upstream)

## Escalation

If you receive no response within 6 business days, escalate to: **security@signhify.dev**

**Note:** We do not accept AI-generated security reports. Reports that appear to be automatically generated will be closed without response.

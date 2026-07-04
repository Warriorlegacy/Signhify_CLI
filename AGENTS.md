# Signhify CLI — Agent Guide

## What exists

This is a **spec-only repository**. No code, build system, tests, CI, or tooling config exist yet. Three markdown specs define the product:

| File | What it covers |
|---|---|
| `Signhify_Master_Build_Prompt.md` | Product vision, feature list, architecture overview, build roadmap |
| `Signhify_PRD.md` | Requirements, user stories, success metrics, release phasing |
| `Signhify_TRD.md` | Technical architecture, data model (SQLite schema), interfaces, tool specs, testing strategy |

Read the TRD first for implementation details. The Master Build Prompt is better for the "why" behind decisions.

## What to build (Phase v0.1 MVP — not started)

Target: CLI only, single OpenAI-compatible provider, Build + Plan modes, file/shell/git tools. No VS Code extension yet.

Monorepo layout (from TRD §1.1):
```
packages/
  core/        — agent loop, mode manager, context/memory manager, permission engine
  providers/   — model adapter interface + implementations
  tools/       — file-io, shell-exec, git, browser, mcp-client, search
  memory/      — SQLite FTS5 store, checkpoint writer, dream/distill
  cli/         — terminal TUI (Ink) + non-interactive runner
  vscode-ext/  — (later) extension host, webview, inline completion
```

## Critical rules

- **Never commit `.signhify/`** — it's a runtime artifact created by the CLI at project root. Add it to `.gitignore` immediately when scaffolding.
- **Never commit API keys.** Keys go in OS keychain (`keytar`) or encrypted local file, never in config or code.
- **Permission engine is mandatory from day one.** Every tool call routes through per-mode allow/deny checks. Build mode = full access; Plan mode = read-only; `--auto` mode adds shell allowlist/denylist from config (TRD §2.2).
- **Two-tier model routing** is a core design choice: a fast/cheap model for inline autocomplete, a strong reasoning model for the agent loop. These are configured independently (Master Build Prompt §4, TRD §3.3).

## Tech stack (non-negotiable)

- TypeScript / Node.js 20+ (single language across all packages)
- SQLite + FTS5 for persistent memory
- JSON-RPC 2.0 for inter-process transport (core ↔ CLI/extension)
- Ink (React for CLIs) for terminal rendering
- MCP spec 2025-03-26 for extensibility
- MIT license

## Key architecture patterns to follow

- **Shared core, dual frontends:** the core engine (agent loop, tools, memory) is frontend-agnostic. CLI and VS Code extension both talk to it over JSON-RPC. Don't couple core to either frontend.
- **Provider adapter interface** (TRD §4): each vendor gets an adapter implementing `ModelProviderAdapter` with `streamChat()`, `countTokens()`, `supportsFunctionCalling`. Normalizes tool-call formats into a common `ToolCallIntent`.
- **Memory is dual-stored:** SQLite+FTS5 for fast retrieval + importance-ranked injection; markdown files (MEMORY.md, checkpoint.md, notes.md) for human auditability (TRD §3.2).
- **Checkpoint system:** at ~80% context window usage, a checkpoint-writer subagent snapshots session state. On resume, context is rebuilt from checkpoint + MEMORY.md + task progress + recent messages — never truncates mid-message (TRD §10).

## Testing strategy (planned, TRD §12)

- **Unit:** provider adapters, tool implementations, permission engine rules
- **Integration:** full agent loop against mocked model provider + scratch git repo
- **E2E CLI:** scripted tasks with `--auto`, assert diffs and exit codes
- **E2E Extension:** `@vscode/test-electron`, inline completion + webview chat
- **Regression:** memory/checkpoint round-trip (kill session mid-task, resume, verify reconstruction)

## Commands (post-implementation)

- `signhify` — interactive TUI
- `signhify run "<task>" --auto --output json` — non-interactive CI/CD mode (exit codes: 0=success, 1=failure, 2=goal-not-met)
- `/goal` — set stop condition; judged by independent model before session terminates
- `/dream` — distill session traces into MEMORY.md
- `/distill` — package repeated workflows into reusable custom agents/commands

## Build order (Master Build Prompt §14)

1. Core agent loop + one OpenAI-compatible provider + file/shell tools
2. CLI TUI with Build and Plan modes
3. Memory system (MEMORY.md, checkpoint, notes, task tree)
4. Multi-provider support (Claude, Gemini, GPT) + BYO API keys
5. `--auto` flag + Goal/judge stop condition
6. VS Code extension (chat panel first, inline autocomplete second)
7. Subagents, MCP client, Compose mode, Dream/Distill, browser, voice (priority order)

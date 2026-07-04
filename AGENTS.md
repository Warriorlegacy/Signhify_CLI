# Signhify CLI — Agent Guide

## What exists

This is a **fully implemented** AI coding agent. The monorepo contains six packages with working TypeScript code:

| Directory | Contents | Status |
|---|---|---|
| `packages/core/` | Agent loop, mode manager, context/memory manager, permission engine, task manager | **Implemented** |
| `packages/providers/` | Model adapter interface + implementations (OpenAI, Anthropic, Gemini, OpenAI-compatible) | **Implemented** |
| `packages/tools/` | File I/O, shell-exec, git, browser (Playwright), MCP client, search | **Implemented** |
| `packages/memory/` | SQLite FTS5 store, checkpoint writer, dream/distill engine | **Implemented** |
| `packages/cli/` | Terminal TUI (Ink), non-interactive runner, setup wizard | **Implemented** |
| `packages/vscode-ext/` | VS Code extension — chat panel + inline completions | **Implemented** |

Three spec documents exist for reference purposes:
| File | What it covers |
|---|---|
| `Signhify_Master_Build_Prompt.md` | Product vision, feature list, architecture overview, build roadmap |
| `Signhify_PRD.md` | Requirements, user stories, success metrics, release phasing |
| `Signhify_TRD.md` | Technical architecture, data model (SQLite schema), interfaces, tool specs, testing strategy |

## Tech stack

- TypeScript / Node.js 20+ (single language across all packages)
- SQLite + FTS5 for persistent memory
- JSON-RPC 2.0 for inter-process transport (core ↔ CLI/extension)
- Ink (React for CLIs) for terminal rendering
- MCP spec 2025-03-26 for extensibility
- MIT license

## Key architecture patterns

- **Shared core, dual frontends:** the core engine (agent loop, tools, memory) is frontend-agnostic. CLI and VS Code extension both talk to it over JSON-RPC.
- **Provider adapter interface** (TRD §4): each vendor gets an adapter implementing `ModelProviderAdapter` with `streamChat()`, `countTokens()`, `supportsFunctionCalling`.
- **Memory is dual-stored:** SQLite+FTS5 for fast retrieval + importance-ranked injection; markdown files (MEMORY.md, checkpoint.md, notes.md) for human auditability.
- **Checkpoint system:** at ~80% context window usage, a checkpoint-writer subagent snapshots session state. On resume, context is rebuilt from checkpoint + MEMORY.md + task progress + recent messages.

## Build & test commands

```bash
npm install          # Install all workspace dependencies
npm run build        # Build all packages
npm run lint         # ESLint check
npm run typecheck    # TypeScript type check
npm test             # Run all tests via Vitest
npm run build:cli    # Build only CLI package
npm run test:core    # Test only core package
```

## CI

GitHub Actions workflows run on push/PR to `main` and `dev`:
- `lint.yml` — ESLint
- `typecheck.yml` — TypeScript type checking
- `test.yml` — Vitest tests (matrix: Node 20, 22)
- `release.yml` — npm publish + VS Code Marketplace on tag push (`v*`)

## Critical rules

- **Never commit `.signhify/`** — it's a runtime artifact created by the CLI at project root.
- **Never commit API keys.** Keys go in OS keychain (`keytar`) or encrypted local file.
- **Permission engine is mandatory from day one.** Every tool call routes through per-mode allow/deny checks.

## Build order (spec reference)

The original 7-phase build order from the Master Build Prompt has been completed through v0.4:
1. ✅ Core agent loop + one OpenAI-compatible provider + file/shell tools
2. ✅ CLI TUI with Build and Plan modes
3. ✅ Memory system (MEMORY.md, checkpoint, notes, task tree)
4. ✅ Multi-provider support (Claude, Gemini, GPT) + BYO API keys
5. ✅ `--auto` flag + Goal/judge stop condition
6. ✅ VS Code extension (chat panel first, inline autocomplete second)
7. 🔄 Subagents, MCP client, Compose mode, Dream/Distill, browser, voice (partially done)

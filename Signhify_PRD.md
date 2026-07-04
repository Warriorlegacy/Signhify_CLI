# SIGNHIFY — Product Requirements Document (PRD)
Version 1.0 | July 2026

---

## 1. Overview

**Product Name:** Signhify
**Category:** Agentic AI Coding Assistant — dual delivery as a VS Code Extension and a Standalone CLI
**One-liner:** An open-source AI engineering partner that plans, writes, tests, and fixes code from natural language, remembers your project across sessions, and can run unattended in CI/CD.

Signhify is architected by combining validated patterns from two real open-source products: **Kilo Code** (VS Code-native "all-in-one agentic engineering platform," a superset of Roo Code and Cline) [web:3][web:4], and **MiMo Code** (Xiaomi's terminal-native AI coding agent, forked from OpenCode, distinguished by persistent multi-session memory and autonomous goal-verification) [page:1][web:11].

---

## 2. Problem Statement

Developers today juggle disconnected AI tools: chat-only assistants that don't touch the filesystem, IDE autocomplete that has no project memory, and CLI agents that forget everything between sessions. There is no single open tool that behaves like a persistent, self-verifying engineering teammate across both the terminal and the IDE.

---

## 3. Goals & Non-Goals

**Goals:**
- Ship one shared agent core usable from both a VS Code extension and a terminal CLI.
- Support natural-language task delegation that results in real file edits, command execution, and Git operations.
- Provide persistent, cross-session project memory so long-running work survives restarts.
- Allow fully unattended automation for CI/CD via a `--auto` flag.
- Support multiple frontier model providers with user-supplied API keys (no vendor lock-in).

**Non-Goals (v1):**
- Not building a hosted, multi-tenant SaaS platform in v1 (local-first, BYO-key first).
- Not targeting non-code domains (writing, spreadsheets, etc.).
- Not replacing full IDEs — Signhify augments VS Code, it does not fork it.

---

## 4. Target Users & Personas

| Persona | Needs |
|---|---|
| Solo/indie developer | Fast iteration, free/low-cost model access, works entirely in terminal |
| Professional dev on a team | IDE-integrated review-friendly diffs, safe automation for CI pipelines |
| No-code/low-code builder (e.g., transitioning from Lovable-style tools) | Natural language task input, minimal setup, guided first run |
| DevOps/platform engineer | `--auto` CI/CD mode, JSON output, scoped permissions for unattended runs |

---

## 5. User Stories

1. As a developer, I can type "add pagination to the users API" in the CLI and have Signhify plan, edit files, run tests, and report results.
2. As a developer, I can switch to Plan mode to get an architecture proposal without any files being touched.
3. As a returning user, I can resume a project after a week away and Signhify still remembers prior decisions and unfinished tasks.
4. As a CI engineer, I can run `signhify run "fix failing tests" --auto` in a pipeline with no human present, trusting it will stop only when the tests actually pass.
5. As a VS Code user, I get inline ghost-text suggestions as I type, separate from the full agent chat.
6. As a user, I can plug in my own Claude, Gemini, or GPT API key, or use a free trial channel to get started without setup.
7. As a user, I can attach MCP servers to extend the agent's tools (e.g., database access, browser control) without code changes.

---

## 6. Functional Requirements

### 6.1 Core Agent
- FR-1: Accept natural-language task input via CLI prompt or VS Code chat panel.
- FR-2: Generate and apply code edits shown as reviewable diffs (hunk-level accept/reject).
- FR-3: Execute shell commands with streamed output, scoped to project directory by default.
- FR-4: Perform Git operations: status, diff, stage, commit, branch, PR description drafting.
- FR-5: Self-verify: run tests/linters/build after changes and iterate on failures automatically before reporting done.

### 6.2 Modes
- FR-6: Provide switchable modes — Build, Plan/Architect (read-only), Debug, Compose/Orchestrator (spec-driven multi-step coordination) [web:3].
- FR-7: Support user-defined custom modes via project config (name, system prompt, allowed tools).

### 6.3 Model Providers
- FR-8: Support Anthropic Claude, Google Gemini, OpenAI GPT (current), and any OpenAI-compatible endpoint.
- FR-9: Allow BYO API key entry via CLI wizard or VS Code settings UI; store keys locally only.
- FR-10: Provide an optional zero-config free trial channel, rate-limited and time-boxed.
- FR-11: Support independent model selection for the "fast" autocomplete tier vs. the "reasoning" agent tier.

### 6.4 Inline Autocomplete (VS Code)
- FR-12: Provide ghost-text inline completions implemented via VS Code's `InlineCompletionItemProvider` API, triggered on typing pause or explicit invocation [web:17][web:20].
- FR-13: Suggestions must be cancellable mid-generation and respect `editor.suggest.showInlineCompletions` settings conventions [web:20].

### 6.5 Persistent Memory
- FR-14: Maintain project-level memory files: `MEMORY.md` (long-term knowledge), `checkpoint.md` (session snapshots), `notes.md` (scratch space), and per-task progress logs under a tree-shaped task ID scheme (T1, T1.1, …).
- FR-15: Auto-inject relevant memory at the start of each session/turn, budgeted by token limits and importance ranking.
- FR-16: Auto-checkpoint session state as the context window approaches capacity, enabling clean pause/resume.

### 6.6 Subagents & Task Orchestration
- FR-17: Allow the primary agent to spawn subagents for parallelizable subtasks, with shared context and cancellation support.
- FR-18: Track multi-step jobs with a visible task tree and progress status.

### 6.7 Autonomous Stop Condition
- FR-19: Support a user-defined goal/completion condition per session.
- FR-20: Use an independent judge-model pass to verify the goal is actually met before allowing a session to terminate, especially under `--auto`.

### 6.8 Automation / CI-CD
- FR-21: Provide a `--auto` (alias `--yes`) CLI flag that suppresses all confirmation prompts.
- FR-22: Provide `--output json` for machine-parseable pipeline results and meaningful process exit codes.
- FR-23: Support project-level permission scoping (allowed paths, disallowed shell commands) enforced specifically in automated runs.

### 6.9 Extensibility
- FR-24: Implement an MCP (Model Context Protocol) client so users can attach external MCP servers to add tools/resources without core code changes, following the MCP 2025-03-26 specification's host/client/server model [web:18][web:31].
- FR-25: Provide a marketplace/registry UI (CLI list + VS Code panel) for discovering community MCP servers and custom agent presets.

### 6.10 Self-Improvement (Stretch)
- FR-26: `/dream` command periodically distills session traces into durable `MEMORY.md` entries and prunes stale ones.
- FR-27: `/distill` command detects repeated manual workflows and packages them into reusable custom agents/commands.

### 6.11 Setup & Configuration
- FR-28: First-run wizard offering: free trial, OAuth platform login, import existing credentials, or manual custom provider entry.
- FR-29: Project config at `.signhify/signhify.json`; global config at `~/.config/signhify/signhify.json`.

---

## 7. Non-Functional Requirements

| Category | Requirement |
|---|---|
| Performance | Inline completions must return in under ~300ms perceived latency for a good typing experience |
| Security | API keys stored locally (OS keychain preferred); shell execution sandboxed with explicit user consent per MCP security principles [web:18] |
| Reliability | Automatic checkpointing must guarantee no more than one turn of work lost on crash |
| Portability | CLI must run on macOS, Linux, and Windows (WSL supported) |
| Extensibility | Tool and provider layers must be pluggable without core rewrites |
| Licensing | MIT license, matching both reference projects, to maximize community adoption |
| Privacy | No project code or memory transmitted to Signhify-operated servers except during explicit hosted/free-trial usage |

---

## 8. Success Metrics

- Time-to-first-successful-task for a new user (target: under 5 minutes from install to first accepted diff).
- Session resume accuracy (agent correctly recalls prior task context after restart).
- Autonomous run success rate under `--auto` in CI without human intervention.
- Weekly active CLI + extension users; GitHub stars/forks as OSS adoption proxy.

---

## 9. Release Phasing

| Phase | Scope |
|---|---|
| v0.1 (MVP) | CLI only, single provider, Build + Plan modes, basic file/shell/git tools |
| v0.2 | Multi-provider support, BYO keys, memory system (MEMORY.md, checkpoint, notes) |
| v0.3 | `--auto` flag + goal/judge stop condition, JSON output, CI-safe permission scoping |
| v0.4 | VS Code extension: chat panel + inline autocomplete |
| v0.5 | Subagents, MCP client, Compose mode |
| v1.0 | Dream/Distill self-improvement, marketplace, polish, docs, first stable release |

---

## 10. Open Questions

- Should the free trial channel be Signhify-hosted or rely on model vendors' own free tiers?
- What is the governance model for community-contributed MCP servers/custom agents in the marketplace?
- Should voice input ship in v1.0 or remain a post-1.0 stretch module?

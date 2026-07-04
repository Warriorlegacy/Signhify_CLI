# SIGNHIFY — Master Build Prompt
### An Agentic AI Coding Platform (VS Code Extension + Standalone CLI)
**Reverse-engineered from MiMo Code (XiaomiMiMo/MiMo-Code) and Kilo Code (Kilo-Org/kilocode)**

---

## 0. One-Paragraph Pitch

Build **Signhify**, an open-source, terminal-native and IDE-native AI coding agent that behaves like a real engineering teammate: it reads and writes files, runs shell commands, manages Git, remembers your project across sessions, plans before it codes, checks its own work, and can run fully unattended in CI/CD. It ships as two front-ends sharing one core engine — a **VS Code extension** (Signhify for Code) and a **standalone CLI** (`signhify`) — both built on a provider-agnostic model layer supporting Claude, Gemini, GPT, and any OpenAI-compatible endpoint via user-supplied API keys.

---

## 1. Architecture Overview

Use a **monorepo, shared-core architecture** (this is exactly how both MiMo Code and Kilo Code are structured):

```
signhify/
├── packages/
│   ├── core/            # Agent runtime, tool loop, memory, context manager (framework-agnostic)
│   ├── providers/       # Model adapters: Anthropic, Google, OpenAI, OpenAI-compatible, local
│   ├── tools/           # file I/O, shell exec, git, browser, search, MCP client
│   ├── memory/          # SQLite FTS5 store, checkpoint writer, dream/distill engine
│   ├── cli/             # Standalone terminal app (TUI + non-interactive mode)
│   └── vscode-ext/      # VS Code extension (webview chat panel + inline completions)
├── docs/
├── .signhify/           # per-project config, memory, tasks (created at runtime)
└── signhify.config.json # global/project config schema
```

**Why this matters:** Kilo Code is a VS Code-only fork of Roo/Cline; MiMo Code is a CLI-only fork of OpenCode. Signhify's differentiator is unifying both experiences on one core engine, so a task started in the terminal can be resumed in the IDE and vice versa, sharing the same memory files.

---

## 2. Dual Front-Ends

### 2.1 VS Code Extension ("Signhify for Code")
- Chat/agent side panel (webview) for natural-language task delegation.
- **Inline autocomplete**: ghost-text completions as the developer types, powered by a fast/cheap model tier separate from the main agentic model (mirrors Kilo Code's autocomplete feature).
- Diff-based file edits shown inline with accept/reject per hunk.
- System notifications when a long-running task finishes.
- Command palette actions: "Signhify: New Task", "Signhify: Switch Mode", "Signhify: Open Memory".

### 2.2 Standalone CLI (`signhify`)
- Interactive TUI (chat-like REPL) for daily terminal use.
- **Non-interactive / automation mode**: a `--auto` flag (and alias `--yes`) that suppresses all confirmation prompts, ideal for CI/CD pipelines, cron jobs, and scripted batch tasks.
- One-line installer (`curl -fsSL https://signhify.dev/install | bash`) and npm global install (`npm install -g @signhify/cli`).
- Guided first-run setup wizard (see Section 6).

---

## 3. Agent Modes (the "Multiple Agents" system)

Both source projects converge on 3–5 named modes. Signhify should ship these as first-class, switchable modes (Tab-key cycling in CLI, dropdown in VS Code):

| Mode | Purpose | Tool Permissions |
|---|---|---|
| **Build** (default) | Writes and edits code, runs commands, full dev loop | Full: file write, shell exec, git |
| **Plan / Architect** | Read-only exploration, architecture design, no file writes | Read-only: file read, search, no exec |
| **Debug** | Root-causes failing tests/errors, proposes and applies fixes | Full, scoped to test/error context |
| **Compose / Orchestrator** | Spec-driven, coordinates multi-step/multi-file projects using sub-skills (plan → execute → review → TDD → verify → merge) | Full + can spawn subagents |
| Custom modes | User-defined via config (name, prompt, allowed tools) | Configurable |

Users switch modes with `Tab` in CLI or a mode selector in the extension. Custom modes are declared in `.signhify/signhify.json` under an `agents` key.

---

## 4. Model & Provider Layer

- **Pluggable providers**: Anthropic (Claude), Google (Gemini), OpenAI (GPT-current), plus any OpenAI-compatible endpoint (Groq, OpenRouter, local Ollama/LM Studio, etc.).
- **Bring-your-own-key**: users paste API keys in a settings screen (CLI TUI or VS Code settings) — keys stored locally, never transmitted to Signhify's own servers.
- **Zero-config trial channel**: an optional "Signhify Free" anonymous channel (rate-limited, time-boxed) so new users can try the agent before configuring keys — this mirrors MiMo Auto.
- **Two-tier model routing**: a fast/cheap model for inline autocomplete and a stronger reasoning model for the agent loop, configurable independently.
- **Max Mode (optional/experimental)**: parallel best-of-N generations with a judge model selecting the best result, toggleable via `experimental.maxMode` in config.

---

## 5. Core Agent Capabilities

- **File read/write** with unified diff previews before applying changes.
- **Shell command execution** in a sandboxed, permission-scoped subprocess, with streamed output back into the conversation.
- **Git integration**: status, diff, commit, branch, and PR-description generation.
- **Self-verification loop**: after generating code, the agent runs relevant tests/linters/build commands and iterates on failures before reporting done ("checks its own work").
- **Browser automation** (optional, Kilo-inspired): headless browser tool for visually verifying web UI changes or scraping docs.
- **MCP (Model Context Protocol) client + marketplace**: let users discover and attach MCP servers to extend tool capabilities without core changes.

---

## 6. First-Run Setup & Configuration

On first launch (CLI or extension), present a setup wizard with these paths:

1. **Signhify Free (zero-config)** — anonymous, time-limited free channel.
2. **Signhify Platform login (OAuth)** — hosted account with model access.
3. **Import existing credentials** — one-step migration from Claude Code / other CLI tools' auth files.
4. **Custom provider** — manually enter API key + base URL for any OpenAI-compatible provider.

**Configuration files:**
- Project-level: `.signhify/signhify.json` — provider/model selection, agent permissions, custom agents, checkpoint/memory behavior, MCP servers, keybindings, theme.
- Global: `~/.config/signhify/signhify.json` — user-wide defaults.

---

## 7. Persistent Memory System (core differentiator, from MiMo Code)

Implement a SQLite + FTS5-backed, multi-layer memory system stored under `.signhify/`:

| File / Store | Purpose |
|---|---|
| `MEMORY.md` | Long-term project knowledge: architecture decisions, conventions, rules |
| `checkpoint.md` | Auto-generated structured snapshot of session state, written by a dedicated checkpoint-writer subagent |
| `notes.md` | Scratch space for the agent's temporary working notes |
| `tasks/<id>/progress.md` | Per-task execution log, supports a tree-shaped task ID scheme (`T1`, `T1.1`, `T1.2`, …) |

**Behavior:**
- Memory is auto-injected at the start of every resumed session so the agent never "forgets" the project.
- **Automatic checkpointing**: the agent decides when to snapshot state based on how full the model's context window is getting.
- **Context reconstruction**: when nearing the context limit, the agent rebuilds a compact working context from the latest checkpoint + project memory + task progress + recent messages, rather than truncating blindly.
- **Budgeted injection**: a token budget with importance ranking governs how much of MEMORY.md / checkpoint / notes gets injected per turn.

---

## 8. Task Tracking & Subagents

- **Tree-shaped task IDs** (`T1`, `T1.1`, `T1.2`) so complex jobs decompose into trackable subtasks, integrated with the checkpoint system so progress survives a restart.
- **Subagent spawning**: the primary agent can create subagents on demand that share session context, run in parallel, and support cancellation and background execution — useful for large multi-file refactors or parallel research tasks.

---

## 9. Autonomous Stop Condition ("Goal" system)

Implement a `/goal` command (CLI) and equivalent UI control (extension) that lets a user define an explicit completion condition for a session (e.g., "all tests pass and README is updated"). When the agent believes it is finished, an **independent judge model** evaluates the full conversation against the stated goal before allowing the session to stop — preventing premature "I think I'm done" exits during long autonomous runs. This is essential for the `--auto` CI/CD flag to be trustworthy.

---

## 10. Self-Improvement Loop ("Dream / Distill")

- **`/dream`** — periodically scans recent session traces, extracts durable, generalizable knowledge into `MEMORY.md`, and prunes stale entries.
- **`/distill`** — detects repeated manual workflows across sessions and packages high-confidence patterns into reusable custom agents, skills, or slash commands, so the tool gets better at your specific codebase over time.

---

## 11. Automation & CI/CD Flag

- `signhify run "<task>" --auto` — executes a task end-to-end without any confirmation prompts.
- Must combine with the **Goal/stop-condition judge** (Section 9) so unattended runs terminate correctly rather than looping or stopping early.
- Exit codes and structured JSON output (`--output json`) so pipelines can parse results.
- Recommended CI usage pattern: run in **Build** mode with a scoped `.signhify/signhify.json` limiting file-write paths and disallowed shell commands (e.g., no `rm -rf`, no network calls outside an allowlist) for safety in unattended contexts.

---

## 12. Voice Input (stretch feature)

Optional real-time streaming voice input (`/voice`) using a VAD (voice activity detection) model plus a speech-to-text model, segmenting by pauses and transcribing incrementally into the input box — available as an opt-in module, not core-blocking.

---

## 13. Branding Notes for "Signhify"

- CLI binary name: `signhify` (short alias: `sgfy`).
- Config directory: `.signhify/` (project) and `~/.config/signhify/` (global).
- VS Code extension name: **Signhify — AI Engineering Agent**.
- Tagline suggestion: "Your AI engineering partner — in the terminal and in the IDE."
- License recommendation: MIT (matches both reference projects, maximizes adoption).

---

## 14. Build Order (Suggested Roadmap)

1. Core agent loop + one provider (start with an OpenAI-compatible adapter) + file/shell tools.
2. CLI TUI with Build and Plan modes.
3. Memory system (MEMORY.md, checkpoint, notes, task tree).
4. Multi-provider support (Claude, Gemini, GPT) + custom API key entry.
5. `--auto` flag + Goal/stop-condition judge for CI/CD readiness.
6. VS Code extension: chat panel first, inline autocomplete second.
7. Subagents, MCP client, Compose mode, Dream/Distill, browser automation, voice input (in that priority order).

---

*Sources analyzed: MiMoCode README/architecture (github.com/XiaomiMiMo/MiMo-Code) and Kilo Code README/architecture (github.com/Kilo-Org/kilocode).*

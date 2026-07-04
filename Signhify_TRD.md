# SIGNHIFY — Technical Requirements Document (TRD)
Version 1.0 | July 2026

Companion document to the Signhify PRD. Defines system architecture, technology stack, interfaces, data models, and implementation details required to build the platform, based on reverse-engineered patterns from MiMo Code (OpenCode fork) [page:1][web:11] and Kilo Code (Roo/Cline superset) [web:3][web:4], plus official specs for VS Code inline completions [web:17][web:20] and the Model Context Protocol [web:18][web:31].

---

## 1. System Architecture

### 1.1 Monorepo Layout

```
signhify/
├── packages/
│   ├── core/            # Agent loop, mode manager, context/memory manager, permission engine
│   ├── providers/        # Model adapter interfaces + implementations
│   ├── tools/             # file-io, shell-exec, git, browser, mcp-client, search
│   ├── memory/            # SQLite (FTS5) store, checkpoint writer, dream/distill jobs
│   ├── cli/                # Terminal TUI + non-interactive runner
│   └── vscode-ext/         # Extension host code, webview UI, inline completion provider
├── .signhify/               # runtime project state (memory, tasks, config) - gitignored by default
└── signhify.config.schema.json
```

Rationale: this mirrors the shared-core-plus-frontends pattern used by OpenCode/MiMo Code (CLI-first, TypeScript monorepo) [page:1] and the modular tool/provider separation used by Kilo Code [web:3].

### 1.2 Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Core runtime | TypeScript / Node.js 20+ | Matches both reference projects' ecosystems; single language across CLI, extension, core |
| CLI TUI | Ink (React for CLIs) or Bubble Tea-equivalent JS lib | Interactive terminal rendering |
| VS Code extension | VS Code Extension API (TypeScript) | Webview for chat, native API for inline completion |
| Persistent memory | SQLite with FTS5 extension | Local-first, fast full-text search over memory/notes/checkpoints |
| Inter-process transport | JSON-RPC 2.0 over stdio/websocket | Shared between core-daemon and CLI/extension clients; same pattern as MCP transport [web:18] |
| Model provider protocol | Provider-agnostic adapter interface (REST/streaming) | One adapter per vendor + generic OpenAI-compatible adapter |
| Extensibility protocol | Model Context Protocol (MCP), spec 2025-03-26 | JSON-RPC based; hosts/clients/servers model [web:18] |
| Packaging | npm (`@signhify/cli`, `@signhify/vscode`) + curl installer script | Matches MiMo Code's npm + curl install patterns |
| CI | GitHub Actions | Lint, test, build, release automation |

---

## 2. Core Agent Loop (Engine Design)

### 2.1 Loop Sequence
1. Receive user task (NL string) + current mode + project context.
2. **Context Assembly**: merge system prompt, mode prompt, injected memory (budgeted), recent conversation, relevant file contents.
3. **Model Call**: stream completion from selected provider/model; parse for tool-call intents (function-calling format).
4. **Tool Execution**: dispatch to file-io / shell-exec / git / mcp-client tool implementations; enforce permission engine checks per mode.
5. **Result Injection**: feed tool outputs back into context.
6. **Self-Verification**: if code was changed, auto-run configured test/lint/build commands; on failure, loop back to step 2 with error context (bounded retry count, e.g., max 5 iterations, configurable).
7. **Checkpoint Check**: if context-window usage exceeds threshold (e.g., 80%), trigger checkpoint-writer subagent.
8. **Stop Condition Check**: if a `/goal` is set, invoke judge-model pass before finalizing; otherwise stop on natural completion or turn limit.

### 2.2 Permission Engine

Permission matrix enforced per mode and per execution context (interactive vs. `--auto`):

| Mode | File Write | Shell Exec | Git Write | Network |
|---|---|---|---|---|
| Build | Allow | Allow (confirm unless --auto) | Allow | Allow (allowlist in CI) |
| Plan/Architect | Deny | Deny (read-only commands only) | Deny | Read-only |
| Debug | Scoped to touched files | Allow (test/build commands) | Allow (branch/commit only) | Restricted |
| Compose/Orchestrator | Allow (delegates to subagents) | Allow | Allow | Allow |

`--auto` mode additionally requires: an explicit allowlist/denylist of shell command patterns defined in `.signhify/signhify.json` under `automation.shellAllowlist` / `automation.shellDenylist`.

---

## 3. Data Model

### 3.1 Memory Store Schema (SQLite)

```sql
CREATE TABLE memory_entries (
  id INTEGER PRIMARY KEY,
  project_id TEXT NOT NULL,
  category TEXT CHECK(category IN ('fact','decision','convention','rule')),
  content TEXT NOT NULL,
  importance REAL DEFAULT 0.5,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME
);
CREATE VIRTUAL TABLE memory_fts USING fts5(content, content='memory_entries', content_rowid='id');

CREATE TABLE checkpoints (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  token_usage_at_checkpoint INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,          -- e.g. 'T1', 'T1.1', 'T1.2'
  parent_id TEXT,
  title TEXT NOT NULL,
  status TEXT CHECK(status IN ('pending','in_progress','blocked','done')),
  progress_log TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 3.2 File-Based Memory Artifacts (human-readable mirror)

- `.signhify/MEMORY.md` — long-term project knowledge, markdown sections by category.
- `.signhify/checkpoint.md` — latest structured session snapshot (regenerated, not appended).
- `.signhify/notes.md` — free-form scratch notes.
- `.signhify/tasks/<task_id>/progress.md` — per-task execution log.

Rationale for dual storage: SQLite+FTS5 enables fast semantic-ish retrieval and importance-ranked budgeted injection; markdown mirrors keep everything human-auditable and git-diffable, matching MiMo Code's documented approach [page:1].

### 3.3 Config Schema (`signhify.config.schema.json`, abridged)

```json
{
  "provider": {
    "agent": { "vendor": "anthropic", "model": "claude-current", "apiKeyRef": "env:ANTHROPIC_API_KEY" },
    "autocomplete": { "vendor": "openai-compatible", "model": "fast-tier", "baseUrl": "" }
  },
  "modes": {
    "custom": [
      { "name": "reviewer", "prompt": "...", "allowedTools": ["file-read","search"] }
    ]
  },
  "memory": { "tokenBudget": 4000, "checkpointThresholdPct": 80 },
  "automation": {
    "shellAllowlist": ["npm test", "npm run build", "eslint ."],
    "shellDenylist": ["rm -rf *", "curl * | sh"]
  },
  "mcpServers": [
    { "name": "postgres", "command": "npx @modelcontextprotocol/server-postgres", "args": ["--conn", "..."] }
  ]
}
```

---

## 4. Provider Adapter Interface

```typescript
interface ModelProviderAdapter {
  id: string;
  streamChat(params: {
    messages: Message[];
    tools: ToolDefinition[];
    model: string;
  }): AsyncIterable<StreamChunk>;
  countTokens(text: string): number;
  supportsFunctionCalling: boolean;
}
```

Implementations: `AnthropicAdapter`, `GoogleGeminiAdapter`, `OpenAIAdapter`, `OpenAICompatibleAdapter` (for Groq, OpenRouter, Ollama, LM Studio, etc.). Each adapter normalizes tool-call/function-call formats into a common `ToolCallIntent` structure consumed by the core loop.

---

## 5. Tool Implementations

| Tool | Interface | Key Details |
|---|---|---|
| file-io | `readFile(path)`, `writeFile(path, diff)`, `listDir(path)` | Diffs generated via unified-diff algorithm; writes require permission-engine approval |
| shell-exec | `execCommand(cmd, cwd, timeoutMs)` | Runs via child_process with streamed stdout/stderr; killable; timeout default 120s |
| git | `status()`, `diff()`, `commit(msg)`, `branch(name)`, `generatePRDescription()` | Wraps `simple-git` or shells out to system git |
| browser | `navigate(url)`, `screenshot()`, `evaluate(js)` | Headless via Playwright, opt-in tool |
| mcp-client | `connect(serverConfig)`, `listTools()`, `invokeTool(name, args)` | JSON-RPC 2.0 client implementing MCP host/client roles [web:18] |
| search | `grep(pattern)`, `semanticSearch(query)` | Local ripgrep-based + FTS5-based semantic layer over indexed memory |

---

## 6. VS Code Extension — Technical Details

### 6.1 Inline Autocomplete
- Implement via `vscode.languages.registerInlineCompletionItemProvider(selector, provider)` [web:17].
- `provideInlineCompletionItems(document, position, context, token)` calls the fast-tier model with a windowed context (surrounding lines + relevant symbols); must respect `CancellationToken` to abort in-flight requests when the user keeps typing [web:20].
- Debounce trigger by ~150-250ms after last keystroke; also support explicit "Trigger Inline Completions" command invocation [web:20].
- Suggestions rendered as ghost text; accept via Tab, reject via Esc — standard VS Code UX so no custom keybindings required by default.

### 6.2 Chat/Agent Webview
- Implemented as a `WebviewViewProvider` registered in a custom Activity Bar container.
- Communicates with the core engine over a local JSON-RPC channel (same protocol used by CLI), ensuring feature parity and shared session/memory state between CLI and extension.
- Diff review UI reuses VS Code's built-in diff editor (`vscode.diff` command) for hunk-level accept/reject.

### 6.3 Extension Manifest Essentials
- `activationEvents`: `onStartupFinished`, `onCommand:signhify.newTask`.
- `contributes.commands`: New Task, Switch Mode, Open Memory, Trigger Inline Completion.
- `contributes.configuration`: exposes provider/model/API key settings surfaced from the shared config schema.

---

## 7. CLI — Technical Details

- Entry binary `signhify`, built with a Node-based CLI framework (e.g., Ink + yargs/commander for argument parsing).
- Interactive mode: REPL-style chat loop rendered with Ink components (task tree sidebar, streaming response pane, mode indicator).
- Non-interactive mode: `signhify run "<task>" --auto --output json` — suppresses all prompts, emits structured JSON result and process exit code (0 success, 1 failure, 2 goal-not-met after max iterations).
- First-run wizard implemented as a guided Ink flow: choose (a) free trial, (b) OAuth login, (c) import credentials, (d) manual key entry; writes result to global config.

---

## 8. MCP Integration Details

- Signhify's core acts as an **MCP Host**, embedding an **MCP Client** that connects to user-declared **MCP Servers** listed in `signhify.config.json` under `mcpServers` [web:18][web:31].
- Transport: stdio for locally spawned servers, HTTP+SSE/WebSocket for remote servers, per MCP spec 2025-03-26 [web:18].
- Servers may expose Resources (context/data), Prompts (templated workflows), and Tools (invocable functions); Signhify surfaces all three in the agent's available-tool list dynamically at session start [web:18].
- Security: explicit user consent required before any MCP tool invocation is executed, and before any resource data is shared with the model, per MCP's security principles [web:18].

---

## 9. Goal / Stop-Condition Judge

- Implemented as a secondary, independent model call (can use a smaller/cheaper model) that receives: the original `/goal` statement, the full task transcript, and current repo diff/test results.
- Returns a structured verdict: `{ "met": boolean, "reason": string, "remainingSteps": string[] }`.
- Core loop only terminates the session (or `--auto` process) when `met: true`; otherwise it re-enters the agent loop with `remainingSteps` injected as guidance, up to a configurable max-iteration safety cap (default 20).

---

## 10. Checkpoint & Context Reconstruction Algorithm

1. Monitor cumulative token usage per session against the active model's context window.
2. At threshold (default 80%), invoke checkpoint-writer subagent: summarizes decisions, current diffs, open issues into `checkpoint.md` (SQLite `checkpoints` row + markdown regeneration).
3. On next session start (or post-checkpoint continuation), rebuild working context as: `[system prompt] + [MEMORY.md budgeted excerpt] + [latest checkpoint.md] + [active task progress.md] + [last N raw messages]`, dropping older raw messages entirely rather than truncating mid-message.

---

## 11. Security & Sandbox Requirements

- Shell execution confined to the project working directory unless explicitly allowlisted otherwise.
- API keys stored via OS keychain (`keytar` or platform equivalent) where available, falling back to encrypted local file.
- All MCP tool invocations and shell commands require explicit consent in interactive mode; in `--auto` mode, consent is replaced by the pre-declared allowlist/denylist config, never implicit blanket trust.
- No telemetry or code transmission to Signhify-operated infrastructure outside the optional hosted free-trial/OAuth channel, which must be clearly disclosed and opt-in.

---

## 12. Testing Strategy

| Test Type | Scope |
|---|---|
| Unit | Provider adapters, tool implementations, permission engine rules |
| Integration | Full agent loop against a mocked model provider and a scratch git repo |
| E2E (CLI) | Scripted tasks run with `--auto`, asserting file diffs and exit codes |
| E2E (Extension) | VS Code extension test harness (`@vscode/test-electron`) covering inline completion and webview chat flows |
| Regression | Memory/checkpoint round-trip: kill session mid-task, resume, verify context reconstruction correctness |

---

## 13. Deployment & Distribution

- CLI: published to npm as `@signhify/cli`; also distributed via a one-line curl installer script for non-Node environments (bundles a Node runtime or requires Node 20+ pre-installed).
- Extension: published to the VS Code Marketplace and Open VSX Registry (for VSCodium/other forks).
- Versioning: semantic versioning across all packages in the monorepo, released via GitHub Actions on tag push.

---

## 14. Appendix — Reference Sources

- MiMo Code repository and architecture notes (XiaomiMiMo/MiMo-Code) [page:1][web:11].
- Kilo Code repository, README, and feature documentation (Kilo-Org/kilocode) [web:3][web:4].
- VS Code Inline Completion Provider API reference [web:17][web:20].
- Model Context Protocol specification (2025-03-26) and Anthropic's introduction of MCP [web:18][web:31].

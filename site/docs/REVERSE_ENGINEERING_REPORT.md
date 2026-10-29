# Reverse-Engineering Report: OpenCode, Freebuff, Kilo Code, MiMo Code

Date: 2026-10-29 · Author agent: Signhify CLI implementation session

**Provenance (pinned for honest citation):**

| Source | Evidence type | Where |
|---|---|---|
| opencode | repo clone @ HEAD `510aa79` | `C:\Users\Piyush\AppData\Local\Temp\opencode\rev-eng\opencode` (cited `opencode/…`) |
| freebuff (CodebuffAI) | repo clone @ HEAD `97a20ba` | `…\rev-eng\freebuff` (cited `freebuff/…`) |
| kilocode (Kilo-Org) | repo clone @ HEAD `42037e8` | `…\rev-eng\kilocode` (cited `kilocode/…`) |
| MiMo-Code (XiaomiMiMo) | repo clone @ HEAD `3e92e0d` | `…\rev-eng\mimocode` (cited `mimocode/…`) |
| opencode.ai | Firecrawl markdown scrape | `.firecrawl/opencode-home.md` |
| freebuff.com | Firecrawl markdown scrape | `.firecrawl/freebuff-home.md` |
| kilo.ai | Firecrawl markdown scrape | `.firecrawl/kilo-home.md` |
| mimo.xiaomi.com/mimocode | Firecrawl markdown scrape (SPA, `--wait-for 5000`) | `.firecrawl/mimo-home2.md` |

Method: REA's own guidance was followed — source repositories are analyzed with
ordinary repository tools (shallow clones + search), websites are captured with
the Firecrawl CLI, and the REA evidence layer was reserved for shipped-artifact
questions, which never arose (four MIT/Apache-style TypeScript repos, no
obfuscated binaries in scope). Line/byte counts drift; treat paths as "true at
the pinned HEAD". Site statements are labeled **claim**; repository statements
are labeled **proven**.

---

## 1. OpenCode (opencode.ai · `anomalyco/opencode` @ `510aa79`, v2.2.0)

### Site claims (`.firecrawl/opencode-home.md`)
- "The open-source AI coding agent" — 220k GitHub stars, 950+ contributors, 16M monthly devs, Metanomaly branding.
- Free starter models; log in with GitHub Copilot subscription or ChatGPT Plus/Pro.
- 75+ LLM providers "via models.dev"; desktop and web apps; MIT.

### Repo-proven architecture
- **Server-first core:** HTTP server hosts the engine and pushes events over SSE
  (`opencode/packages/server/src/event-feed.ts`, `api.ts`); TUI, desktop and web
  are thin clients of the same core. An ACP agent-protocol adapter lives under
  `opencode/packages/cli/src/acp/`.
- **Session loop:** `opencode/packages/core/src/session/runner/{llm,step,max-steps,retry}.ts`
  — step-by-step LLM→tool→LLM cycling with a max-steps cap (over-cap turns are
  re-queried with `toolChoice: "none"` so the model must answer, not act), and
  output-token-limit continuation (at most 2 resumes).
- **Sessions in SQLite:** Drizzle schema in `opencode/packages/core/src/session/sql.ts`;
  compaction in `opencode/packages/core/src/session/compaction.ts`.

### Feature inventory
- **Two-phase cost-aware compaction:** reserve floor 16k tokens (15% of window),
  stepwise shrink at request ratios [0.85, 0.7, 0.5, 0.35], a precomputed
  alternative summary (85% ratio, 64k floor) retrievable when the live one
  overruns, and an optional background compaction precompute. A hidden
  `compaction` agent owns the summarization prompt.
- **Tool set** (`opencode/packages/core/src/plugin/internal.ts:239-259`):
  shell/read/edit/write/glob/grep/patch/todowrite/webfetch/websearch/
  image_generate/question/skill/subagent/schedule*/list_mcp_resources — with
  output truncation (`tool-output.ts`: 2000 lines / 50 KB, overflow retained in
  a file the model may read).
- **Agents as markdown:** any `agent|agents/**/*.md` hot-reloads into a registry;
  YAML frontmatter selects primary vs subagent and permission allowlists.
  Hidden utility agents (`title`, `summary`, `compaction`) are not user-visible.
- **Providers:** models.dev catalog with ETag caching (`models-dev.ts`),
  resolution in `model-resolver.ts`, OAuth credentials in a global SQLite store
  (`credential.ts`), and per-model-family system-prompt overlays
  (`opencode/packages/core/src/plugin/optimize.ts` — gpt/kimi/meta/trinity/anthropic overlays).
- **TUI:** palette commands include /models, /agents, /usage, /status, /themes,
  /mcps, /connect, /reload, /sessions-resume; ctrl+p opens it; a todo sidebar
  widget renders `todowrite` state live; cost shown in sidebar/footer.
- **Distinctive:** Confined-JS "Code Mode" that batches tool calls as a program
  (`codemode/tool.ts`, `catalog.ts`); git worktree strategies + session
  `move.ts`; a hidden per-step git snapshot tree enabling message revert
  (`snapshot.ts`); batched permission prompts (once/always/reject);
  queued-prompt "steering" inbox; formatters; cron scheduling.

**Top takeaways:** the core value is *core-first architecture* — every feature is
one SSE-durable event away from the TUI — plus the cost-aware compaction
pipeline and prompt-family overlays.

---

## 2. Freebuff (freebuff.com · `CodebuffAI/freebuff` @ `97a20ba`)

### Site claims (`.firecrawl/freebuff-home.md`)
- "The 100% free coding agent. $0 forever, funded by ads." Desktop (mac/win/linux
  incl. ARM builds), mobile, web, cloud threads "pick up anywhere".
- Integrations shown: GitHub, Linear, Notion, Stripe, Vercel, Supabase, Sentry, PostHog, Resend.
- Demo model label: "Claude Haiku 5.5".

### Repo-proven architecture
- Five products on one Codebuff engine core (`freebuff/README.md:11-17`): desktop,
  CLI, web, cloud (agents over GitHub repos), chat. The multi-agent orchestration,
  tools and SDK are the Codebuff framework; Freebuff layers its model catalog,
  ads economics (`freebuff/common/src/ads/`, ~150 files, flat-rate funding,
  "Freebucks" hours) and branding on top.

### Feature inventory
- **Context pipeline (three cooperating stages, all mechanical — zero model calls):**
  1. `freebuff/agents/context-pruner.ts` — triggers on token count over the
     window *or* on a cache-miss gap (assistant→user distance > cacheExpiryMs);
     oldest tier summarises assistant turns to 1.3k tokens,
     user requests to 13k (80% head / 20% tail), tool calls become one-liners,
     tool outputs are dropped except errors, non-zero exits, Q&A results,
     edit results and subagent output. Two independent budgets: newest user
     requests 50k, assistant+tools 20k.
  2. `freebuff/packages/agent-runtime/src/compact-history.ts` — same algorithm
     *mechanically*: MECHANICAL_TARGET_SHARE 0.5, 12k mechanical budget, USER_MEMORY_TOKENS 24k
     (earlier requests + todos), old user requests shortened not dropped (≥400 tokens),
     latest tool exchange protected (MAX_PROTECTED_TOOL_CALLS 100).
  3. `freebuff/agents/compaction-working-set.ts` — after compaction it
     *re-provides the newest read* of each touched file as one synthetic
     `read_files` message (40k share cap); changed-since-read or pre-delegation
     reads degrade to language-aware outline stubs (top-level declarations +
     line numbers via per-language regex, ~3k stub cap).
- **Cache-aware compaction policies** (`freebuff/common/src/constants/compaction-policy.ts`):
  trigger at 0.8×window; per-provider lanes — DeepSeek 15 min / 40k, default 1 h / 140k, "LEAN" lane ≤100k.
- **write_todos as a progress protocol:** the CLI renders a live todo panel
  (`freebuff/cli/src/components/todo-panel.tsx`); todos survive compaction by
  contract; `freebuff/util/todo-loop.ts` anti-pathology nudges the model when a
  todo stays unchanged across sends and kills no-progress loops.
- **36 tools** incl. plan-mode approvals (`propose_*`), `ask_user`,
  `suggest_followups`, `think_deeply`, `spawn_agents`, `render_ui`, and
  `gravity_index` (recommends a service and provisions it with consent).
- **Best-of-N editor:** `freebuff/agents/editor/best-of-n/editor-multi-prompt.ts`
  spawns N implementors, a selector agent scores the diffs, the winner applies.
- **Pick-up-anywhere handback:** `freebuff/common/src/desktop-cloud/handback.ts`
  serializes a worktree (gzip + git bundle) for another machine, plus unified
  ThreadDigest and SDK RunState checkpoints; interrupted tool results are never checkpointed.

**Top takeaways:** the compaction suite is the crown jewel — deterministic,
free, cache-aware and *rehydrating* (restoring file reads post-compact).
Todos-as-contrat (a protocol, not a toy) is second.

---

## 3. Kilo Code (kilo.ai · `Kilo-Org/kilocode` @ `42037e8`)

### Site claims (`.firecrawl/kilo-home.md`)
- "500+ models, zero markup: frontier, open weighweight or your own keys." Desktop
  beta, VS Code, JetBrains, CLI (curl installer), Cloud, Slack @Kilo, mobile.
- Auto Model tiers shown in-product: **Efficient / Frontier / Free** ("Kilo Auto").
- "5M+ Kilo Coders", per-company logos (Meta, Amazon, Airbnb, PayPal, Square, Red Hat).

### Repo-proven architecture
- Kilo is a **fork of OpenCode with a large overlay**: the OpenCode core is
  vendored; Kilo behavior is isolated in `packages/opencode/src/kilocode/**`
  and `kilocode_change` comment markers (e.g. `kilocode/packages/…/session/compaction.ts`).
  The agent core is a headless HTTP server shared by VS Code
  (`kilocode/packages/kilo-vscode/src/KiloProvider.ts`), JetBrains, CLI and console.

### Feature inventory
- **Modes as agents with sealed deny-ceilings:** build(code), plan, explore
  (read-only), debug, ask, orchestrator(deprecated) in
  `kilocode/packages/opencode/src/kilocode/agent/index.ts`; a `guarded` tool list
  (bash, task, write, notebook_edit, …) can never be widened by user config —
  mode permission widening cannot escalate past the seal.
- **The most nuanced compaction of the four:**
  - Preflight byte-level estimation before each send (`kilocode/…/session/overflow.ts`,
    COMPACTION_BUFFER 20k) with a user-configurable `threshold_percent`.
  - Chat compaction (`kilocode/…/session/compaction.ts`): PRUNE_MINIMUM 20k,
    PRUNE_PROTECT 40k, TOOL_OUTPUT_MAX_CHARS 2000, recent-preservation budget
    `max(25% of usable, clamp 2k–15k)` plus `tail_turns` (default 2) protected
    turns with a `tail_start_id` marker; the compaction turn is a real
    user+assistant pair (`"compaction"` part type, `summary: true`).
  - Chunked compaction for huge transcripts (0.6 budget, concurrency 3, depth 3).
  - Per-turn payload-limit pruning before the provider call.
- **Checkpoints:** shadow git per worktree with 7-day retention and a 2 MB cap;
  a slow-repo guard (forked fiber + user opt-out persisted to `.kilo/kilo.json`).
- **Todos in SQLite per session** with a compact-diff `TodoView.calculate(before,after)`
  so UI animates only deltas.
- **Foreign transcript import:** resume Claude Code / Codex JSONL sessions
  (`kilocode/…/session-resume/import.ts`), Roo migrations.
- **Gateway + auto tiers:** `kilo-auto/{efficient,frontier,free}`, anonymous users
  default to the free tier; client-side custom auto-routing in
  `kilocode/kilocode/auto-routing/router.ts`.
- **Memory bank** (`kilocode/packages/kilo-memory/**`): markdown under the project,
  auto-saved at turn close, permission-gated recall tools.
- **Codebase indexing** (`kilo-indexing`): tree-sitter chunking → LanceDB/Qdrant,
  `semantic_search` tool behind an explicit consent flow.
- **Agent Manager** VS Code cockpit: worktree-per-agent, inline terminals, ctrl+1..9 session hotkeys.
- **Context metering:** `calcContextUsage` percentage in the UI; `/compact` with smol/condense aliases.

**Top takeaways:** preflight threshold compaction with protected tail turns,
sealed mode guards, shadow-git checkpoints, and the Agent Manager.

---

## 4. MiMo Code (mimo.xiaomi.com · `XiaomiMiMo/MiMo-Code` @ `3e92e0d`)

### Site claims (`.firecrawl/mimo-home2.md` — SPA; note the /en path serves the same zh page, verified same-byte scrape)
- "面向开发者的新一代AI编程助手，支持无限上下文" — **unlimited context** billed as
  automatic knowledge accumulation + memory organization over hundreds of turns.
- Free top-tier multimodal model, no login. Model+Agent co-optimization.
- **Self-evolving system** ( Learns from usage feedback).
- **Compose mode** — "一个人的专业开发团队" (one person's professional dev team),
  idea → product with industrial-grade delivery.

### Repo-proven architecture
- **An explicit OpenCode fork** (`mimocode/README.md:540-542`): "MiMoCode is built
  as a fork of OpenCode. It keeps all core OpenCode capabilities (TUI, LSP, MCP,
  plugins)" — root `package.json` still says `"name": "opencode"`. The additions:
  persistent memory, context management, agent orchestration, goal loops, compose-next, dream/distill.

### Feature inventory
- **Compose as a skill contract** (`mimocode/packages/cli/src/skill/builtin/.bundle/compose-next/SKILL.md`):
  grill requirements → worktree (never main; `.worktrees/{{slug}}`) → written
  spec at `docs/compose/spec/{{feature}}.md` (anchors + task list `T1..` with
  `acceptance:` and `depends:`) → implement → verify → independent reviewer
  subagent (PASS/FAIL, required to use ≥ the strongest implementer model) →
  finish. Autonomous decisions must pick "Recommended" and never auto-approve
  destructive actions. Parallelism via the `actor` tool (background subagents
  returning Status/Summary/Files-touched/Findings headers).
- **Memory = FTS5 BM25** (`mimocode/packages/cli/src/memory/*`): score floor 0.15
  over `{global, projects, sessions, cc}` stores; a **checkpoint-writer
  subagent** fires at window-density thresholds (`mimocode/…/session/prune.ts:18-42`);
  writer outputs are budget-validated (checkpoint 11k / memory 10k / task 6k,
  retry demanding "EXTRACTION REQUIRED" formats); session context is rebuilt
  from checkpoint + memory + tasks (`mimocode/…/session/prompt.ts:914-1009`);
  tail compaction 40k, tool results >8k collapse to "[Tool result omitted…Re-run]";
  `cc_index` ingests Claude Code's own memory; a `history` tool = FTS over raw
  all-time messages (search/around/get).
- **Dream/distill self-evolution:** hidden agents; `/dream` sweeps 7 days of
  checkpoints verified against the SQLite trajectory; `/distill` distills
  30 days of repeated workflows into skills/subagents/commands with confidence
  gates (refuses weak evidence); auto triggers dream.auto 7d/distill.auto 30d;
  kill switch `memory.disable_write`.
- **Bash token-efficient pipeline** (`mimocode/…/tool/bash_token_efficient_pipeline.ts`):
  progress-line fold → ANSI strip → secret redaction → long-line elision +
  per-shape plugins (gitdiff/pytest/npm/tsc/kubectl/json); opt-out via `# nofilter`
  comment or `MIMOCODE_BASH_RAW=1`.
- **maxMode best-of-5 judged** (`mimocode/…/session/max-mode.ts`); goal loop with a cold independent judge
  (`mimocode/…/session/goal.ts:64-73`); per-vendor system prompts; compaction at
  0.9×window with 33k reserve; per-model `compaction.max_context` wildcards; i18n zh-first.

**Top takeaways:** "unlimited context" = checkpoint-writer subagent + FTS retrieval
— the same family Signhify already ships — plus the deterministic bash-output
pipeline and the evidence-gated dream/distill loop.

---

## 5. Comparative table

| Capability | OpenCode | Freebuff | Kilo | MiMo | Signhify today |
|---|---|---|---|---|---|
| Compaction | 2-phase, reserve 16k/15%, precompute | mechanical 3-stage + rehydration, cache lanes | preflight threshold %, protected tail turns, chunked | 0.9×window, 33k reserve, checkpoint subagent | T3.4 3-tier deterministic pruning |
| Session store | SQLite+SSE events | threads + handback bundle | SQLite (OpenCode fork) | SQLite (OpenCode fork) | SQLite FTS5 + sessions table |
| Task tracking | todowrite tool + sidebar | write_todos protocol + anti-pathology | SQLite todos + delta-diff view | task table | tasks table + task-synced planner |
| Subagents | hot-reload md agents | 36-tool multi-agent roster | modes-as-agents | actor tool | configureSubagents + subagent tool |
| Checkpoint/undo | step snapshots | RunState checkpoints | shadow git | checkpoint-writer at density | CheckpointWriter @ 80% |
| Self-improvement | prompt overlays | gravity_index | memory bank, auto-save at turn close | dream/distill with gates | DreamDistillEngine (manual) |
| Shell hygiene | truncation → file | reserved | slow-repo guard | token-efficient pipeline | raw slice @50k |
| History search | — (session list) | threads | foreign imports | `history` FTS over messages | memory FTS only |

---

## 6. Signhify adoption plan

### Adopted this cycle (provenance + target files)

| # | Feature | Provenance | Signhify target |
|---|---|---|---|
| 1 | **Bash token-efficient pipeline** (ANSI strip → `\r` progress fold → unambiguous secret redaction → long-line elision → head+tail-preserving cap with "re-run" notice) | `mimocode/packages/cli/src/tool/bash_token_efficient_pipeline.ts`; skip-shape notice mirrors MiMo's `[Tool result omitted…Re-run]` | `packages/tools/src/shell-exec.ts` (+ exported condenser, unit tests) |
| 2 | **Compaction threshold (`threshold_percent`)**: pruning engages only once estimated context crosses % of the limit; below threshold everything stays verbatim (no silent early loss) | `kilocode/packages/opencode/src/session/overflow.ts` `threshold_percent`; Kilo preflight `measure()` | `packages/core/src/context-manager.ts` + `MemoryConfig.thresholdPercent` in `packages/core/src/types.ts` (opt-in, default preserves T3.4 window semantics) |
| 3 | **`/usage` palette command**: session tokens, context %, active router — OpenCode TUI's /usage analog | `opencode/packages/tui` palette (/usage), `kilocode/…` calcContextUsage | `packages/cli/src/interactive.ts` (sidebar already meters; adds the command) |
| 4 | **`/models` palette command**: shows the resolved agent endpoint + fallback chain, never keys | `opencode/packages/tui` palette (/models); Kilo "500+ models zero markup" is marketing-only | `packages/cli/src/interactive.ts` |
| 5 | **`/history <query>`**: FTS5 BM25 over checkpoint summaries — MiMo's raw-transcript `history` idea, adapted to what Signhify actually persists | `mimocode/packages/cli/src/memory/*` (`history` tool), `fts-query.ts` already credits MiMo's port | `packages/memory/src/memory-store.ts` (`searchCheckpoints`) + `packages/cli/src/interactive.ts` |

### Adopted earlier (attribution preserved in-tree)
- T3.1–T3.4 three-tier pruning — Freebuff `agents/context-pruner.ts` +
  `agent-runtime/src/compact-history.ts` lineage; `packages/core/src/context-manager.ts`.
- FTS5 BM25 memory + OR-phrase query builder — MiMo `packages/cli/src/memory/*`
  (noted in `packages/memory/src/fts-query.ts` header).
- Checkpoint-writer at threshold — MiMo `session/prune.ts`; `packages/memory/src/checkpoint-writer.ts`.
- Goal/stop condition loop + cold judge — MiMo `session/goal.ts`; `packages/core/src/agent-loop.ts`.
- Sidebar usage/mode/router panel — OpenCode TUI style; `packages/cli/src/tui/sidebar/`.

### Deliberately not adopted (with reasons)
- **Code Mode (confined JS batching)** — powerful but a parallel execution model;
  Signhify's ToolHandler + subagents cover the need; revisit if loops get chatty.
- **SSE server-first split** — Signhify targets CLI + VS Code direct calls; a server
  adds a protocol without a second frontend yet.
- **Worktrees / step snapshots / shadow-git checkpoints** — heavyweight; Signhify
  checkpoints state, not files; users have git.
- **Best-of-N editor / maxMode best-of-5** — multiplies cost per edit; unproven
  on Signhify's workload.
- **Kilo Agent Manager, memory bank auto-save, semantic indexing** — VS Code
  cockpit scale; indexing needs a vector store dependency (ponytail: none exists here).
- **Foreign JSONL imports, gateway/auto tiers, ads funding, handback** — product
  business, not agent behavior.
- **`tail_turns` compaction knob** — our `recentWindow` already guarantees the
  contiguous verbatim tail; turns- vs message-count would re-cut tier stats for
  no measured gain.
- **dream/distill auto-triggers** — manual `/dream` / `/distill` already work;
  scheduling needs persisted last-run state — deferred until there is a scheduler surface.

---

## Appendix A — honesty ledger
- All repo citations verified at the pinned SHAs above by delegated read-only
  exploration agents; site claims captured verbatim in `.firecrawl/` (regenerate
  with the Firecrawl CLI if numbers are contested).
- The mimo `mimo-en.md` scrape equals the zh page in bytes — the /en path serves
  the same SPA; claims were translated from the zh capture.
- Every adopted feature maps to a cited competitor file; features whose value we
  could not ground in Signhify's real workload are listed as not adopted rather
  than half-built.

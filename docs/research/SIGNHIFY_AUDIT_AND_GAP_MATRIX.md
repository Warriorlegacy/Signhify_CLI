# Signhify CLI — Repository Audit & Reference Gap Matrix

**Prepared:** 29 October 2026
**Method:** local source inspection of `D:\Signhify_CLI` at commit `c9c4d9d` (+ 18 modified working-tree files), baseline `npm run typecheck` / `npm test` / `npm run build`, plus source inspection of shallow clones in `.refs/` and a fresh scrape of the four reference websites.

**What this is not:** a claim that everything below is final. Every row names the file or command that produced it.

---

## 1. Baseline verification (run today)

| Command | Result | Evidence |
|---|---|---|
| `npm run typecheck` | **FAIL** | `packages/tools/src/subagent.ts(2,38)` — `Cannot find module '@signhify/agents'`; `packages/cli/src/interactive.ts(25,3)` — `Module '"@signhify/tools"' has no exported member 'subagentTool'` |
| `npm test` | **FAIL (1 of 24)** | `packages/cli/src/__tests__/e2e.test.ts > should run task in non-interactive mode with JSON output` |
| `npm run build` | **FAIL** | `packages/vscode-ext` esbuild: `Could not resolve "@signhify/agents"` |
| Other 23 tests | pass | core (5 files), providers (15), tools (5), memory, agents, vscode-ext (1) |

Root cause of all three failures is one fact: **`node_modules/@signhify/` has no `agents` junction**, so `@signhify/tools → @signhify/agents` (and everything downstream) cannot resolve, despite `packages/agents` building fine into `dist/`. Fixing that is Task T0.1.

### 1.1 After T0.1 / T0.2 (fixed 29 Oct 2026)

| Command | Result |
|---|---|
| `npm install` | restored the `@signhify/agents` (+`web`) workspace junctions |
| `npm run typecheck` | **PASS** |
| `npm test` | **PASS — 59 tests across 7 packages** |
| `npm run build` | **PASS** |
| `npm run lint` | 0 errors (1 pre-existing `no-explicit-any` warning in `non-interactive.ts`) |
| `SIGNHIFY_MOCK_PROVIDER=1 signhify run "echo hello" --auto --output json` | stdout parses as JSON: `success=true, auto=true, exitCode=0` |

Source size today: agents 327 LOC, cli 988, core 1147, memory 546, providers 665, tools 872, vscode-ext 610, web 40.

---

## 2. Capability inventory — what actually exists

| Capability | Status | Evidence |
|---|---|---|
| Provider adapter interface + Vercel AI SDK factory | Implemented + verified | `packages/providers/src/factory.ts`, 12 adapter-factory tests pass |
| Fallback router with circuit breaker | Implemented + verified | `fallback-router.ts`, 3 tests pass |
| Fallback **explanation surfaced in UI** | Implemented | `interactive.ts` appends a visible "*[Fallback: X unavailable …]*" message per event |
| Config validation | Partially implemented | Hand-written checks in `cli/src/config.ts:36`; `signhify.config.schema.json` is a **second** source that drifts (schema allows `apiKeyRef`, runtime reads `apiKey`) |
| SQLite + FTS5 memory | Implemented | `memory/src/memory-store.ts` — `memory_entries`, `memory_fts`, `checkpoints`, `tasks` |
| FTS query sanitisation | **Missing** | `memory-store.ts:101` passes the raw user string to `MATCH ?` → FTS5 syntax error on `"`, `(`, `-`, `:` etc. (MiMo solves this in `fts-query.ts`) |
| Checkpoint writer at threshold | Implemented | `memory/src/checkpoint-writer.ts`, `context-manager.ts:82` |
| Sliding-window compaction | Implemented + verified | `context-manager.ts:55`, context-manager tests pass |
| `/context-limit` runtime control | **Missing** | `setContextLimit()` exists but no command invokes it |
| Build / Plan / Debug / Compose modes | Implemented | `core/src/modes.ts`, mode-manager tests pass |
| Tab-switchable primary agents | Partially | `MODE_CYCLE` exists in the TUI but there is no keybinding contract or per-mode model |
| Specialized subagents (@Planner/@Editor/@Reviewer/@FilePicker/@BrowserUse) | **Stub** | `agents/src/planner.ts:16` returns a hard-coded 3-step list, no LLM call. All five subagents are template strings |
| Tree task tracking `T1 → T1.1` | Partially | Schema + `tasks` table support parent/child; nothing creates subtrees |
| MCP stdio client | Implemented | `tools/src/mcp-client.ts` — JSON-RPC line protocol, presets, consent prompt |
| MCP **real status** in sidebar | **Fake** | `interactive.ts:93-100` hard-codes `status: "connected"` for every configured server and invents `rea`/`supabase` rows when none are configured |
| Model shown in TUI footer | **Fake** | `interactive.ts:62` initialises `activeRouterInfo = "9router-local (20128)"` unconditionally |
| Token/context meter + tok/s | **Missing** | `tokenUsage` state exists but is never updated from stream usage |
| Command palette (`ctrl+p`) | **Missing** | Not present |
| Diff preview before applying edits | **Missing** | `file-io.ts` writes directly |
| `--help` / `--version` / `run <task> --output json` | Implemented + verified | 2 of 3 e2e tests pass |
| Installers (`install.sh`, `install.ps1`) | Implemented | Root + `site/` copies |
| Website | Implemented, static | `site/index.html` (25 KB, single self-contained file), deployed by `vercel.json` → `outputDirectory: site` |
| `packages/web` (Next/Astro/React) | **Stub** | `packages/web/src/index.ts` is two `export` statements of string helpers, 40 LOC total |
| VS Code extension | Implemented, unverified end-to-end | `vscode-ext/src/extension.ts`, 1 test |
| JetBrains / desktop / cloud | **Missing** | Kilo parity only |
| Session history persistence + resume | Partially | Checkpoints persist; no session list/fork/export command |

---

## 3. Reference evidence

### 3.1 Repositories (cloned shallow into `.refs/`, inspected by path)

| Project | Branch/ref | License | Imported evidence |
|---|---|---|---|
| `anomalyco/opencode` | `dev` | MIT | `packages/tui` (OpenTUI + SolidJS), `feature-plugins/sidebar/{context,mcp,todo,footer}.tsx`, `feature-plugins/prompt/footer.tsx` |
| `CodebuffAI/freebuff` | `main` | Apache-2.0 | `agents/` (base2/base3 model variants, `context-pruner.ts`, `lean-context.ts`), `sdk/`, `packages/{agent-runtime,llm-providers,code-map}` |
| `Kilo-Org/kilocode` | `main` | MIT | `packages/{tui,ui,kilo-jetbrains,kilo-vscode,kilo-gateway,kilo-indexing,kilo-memory,kilo-sandbox,kilo-telemetry}`, `docs/` |
| `XiaomiMiMo/MiMo-Code` | `main` | MIT | `packages/cli/src/memory/{fts.sql.ts,paths.ts,reconcile.ts,fts-query.ts,service.ts}`, TUI mirror of opencode layout |

Exact patterns worth taking:

- **Sidebar is a set of independent sections** — OpenCode renders each sidebar block as its own TUI plugin claiming a slot (`context.tsx`, `mcp.tsx`, `todo.tsx`). Signhify's sidebar is one monolith in `interactive.ts`; making it section-driven is what lets MCP/Context/Todo statuses be real and individually collapsible.
- **MCP status is tri-state, not boolean** — `mcp.tsx` uses `connected | failed | needs_auth | disabled` and a colour dot per state. Signhify currently has `connected | idle` and never queries.
- **Footer composition** — `prompt/footer.tsx` builds the status line from `contextUsage(tokens, percent)`, `cost`, `N subagents`, `N shells`, plus a `ctrl+p commands` hint, and hides parts when the terminal is narrow (`promptFooterLayout`). This is the exact status bar the task asks for.
- **Context section** shows `X tokens`, `Y% used`, and `$ spent`.
- **FTS5 query sanitisation + OR-join** — `fts-query.ts` wraps every alphanumeric/CJK token in phrase quotes and OR-joins, because AND-join zeroed most multi-word queries. Directly fixes Signhify's raw-`MATCH` bug.
- **Memory path grammar** — `paths.ts`: `memory/{global|projects|sessions}/<id>/<key>.md` with `detectType()` mapping `memory* → memory`, `checkpoint* → checkpoint`, `tasks/<id>/progress|notes`. Reconcile walks the tree and indexes changed fingerprints only.
- **Freebuff agent matrix** — the same agent exists per model tier (`base3-free-*`, `base3-*`) rather than one agent with a model param. Cheap models for `@FilePicker`, strong for `@Planner`.
- **`context-pruner.ts` / `lean-context.ts`** — Freebuff prunes context progressively rather than hard-truncating.

### 3.2 Websites — fresh scrape (29 Oct 2026, Jina Reader + raw HTML/CSS)

| | opencode.ai | kilo.ai | freebuff.com | mimo.xiaomi.com/mimocode |
|---|---|---|---|---|
| Server | Cloudflare | Vercel | Cloudflare | MiFE (Xiaomi CDN) |
| Framework | TanStack Start (`/_build/assets/entry-client-*.js`, `data-sm` attributes on every element) | Next.js App Router (`/_next/static/chunks/…`, `data-precedence` CSS) | Next.js + Turbopack (`/_next/static/chunks/turbopack-*.js`) | Rspress v1.46.2 static docs |
| Hero H1 | "The open source AI coding agent" | "One open agent for every developer workflow" | "The 100% free coding agent" | n/a (docs/portal) |
| Type | `var(--font-mono)` = **IBM Plex Mono**; sans loaded via `--font-*` custom props | `--font-sans: Geist`, `--font-mono: ioskeley-mono`, `--font-display: Hanken` | `--font-sans`, `--font-mono` vars | doc default |
| Accent strategy | Interactive yellow `hsl(62 84% 88%)` on near-white `hsl(0 20% 99%)`; dark mode `hsl(0 9% 7%)` bg / `hsl(0 4% 71%)` text | Tailwind v4 `oklch()` tokens; `--brand-primary:#fd0` | HSL brand pair `--brand-1/--brand-2`, glassy `--lit/--dim/--unlit` + `--shim-sweep` | — |
| Page length | ~3.4 KB text: hero video + 5 feature cards + stats + privacy + FAQ | 14 KB text: 7 install surfaces, trust stats, 3 pillars, model catalog | 5.5 KB text: download matrix, product rail | — |
| Notable mechanic | Hero is a **video** (`opencode-min-*.mp4`), not a static screenshot | Multi-RSC tabbed install bar (`curl npm pnpm bun brew paru`) | Bespoke shim/sweep chrome on nav | `@font-face` served from CDN |

**Stack conclusions for Signhify:**
1. Mimo's marketing presence is docs, not a product page — nothing to clone.
2. The only reference that renders a **real animated TUI** in the hero is OpenCode, and it does so with a video — which Signhify cannot autoplay honestly unless it records its own TUI. A deterministic CSS/React terminal replay from a fixture is the honest equivalent.
3. Signhify's current site already matches the industry convention (`Geist` + `Geist Mono`, dark `#090a0f`, indigo `#6366f1`). It is *not* behind on stack; it is behind on **honesty** (§2: footer/router status, comparison table).
4. `site/index.html` has only `#features` and `#compare` sections. Missing: install/deploy, providers, docs entry, security/privacy, changelog.

---

## 4. Gap matrix

Status: `[Implemented]` / `[Partially Stubbed]` / `[Missing]`. Priority = P0 blocks a working product, P1 core parity, P2 differentiation, P3 polish.

| # | Capability | Reference source | Signhify today | Gap | Priority |
|---|---|---|---|---|---|
| 1 | Monorepo typechecks & builds from clean clone | all | FAIL (agents unlinked) | Workspace linking | **P0** |
| 2 | FTS5 memory search on arbitrary queries | MiMo `fts-query.ts` | Crashes on punctuation | Tokenised OR query | **P0** |
| 3 | Honest provider/model status in footer | OpenCode `prompt/footer.tsx` | Hard-coded "9router-local (20128)" | Wire to router events | **P0** |
| 4 | Real MCP connection status | OpenCode `sidebar/mcp.tsx` | Hard-coded "connected" | Connect + report tri-state | **P0** |
| 5 | Token / % used / tok-per-sec meter | OpenCode `sidebar/context.tsx` | Never updated | Stream usage accounting | **P1** |
| 6 | Section-based sidebar (Context, MCP, Todo) | OpenCode `feature-plugins/sidebar/*` | Monolith block | Extract sections | **P1** |
| 7 | Command palette (`ctrl+p`) | OpenCode keymap `command.palette.show` | Missing | Palette component | **P1** |
| 8 | Diff preview before write | Kilo `REVIEW.md` flow | Direct write | `diff` gated write | **P1** |
| 9 | `/context-limit` runtime command | MiMo `/context-limit` | Setter exists, unused | Slash command | **P1** |
| 10 | Real subagents (LLM-backed) | Freebuff `agents/*` | Hard-coded templates | Wire to adapter | **P1** |
| 11 | Per-role model routing (@FilePicker cheap / @Planner strong) | Freebuff base2/base3 matrix | Single model | Role→endpoint map | **P2** |
| 12 | Session list / resume / export | OpenCode sessions | Checkpoint only | Session registry | **P1** |
| 13 | Config: one schema source | all | Two sources drift | Generate from one | **P1** |
| 14 | Memory file layout `memory/{global,projects,sessions}/…` | MiMo `paths.ts` | Flat `.signhify/MEMORY.md` | Scoped layout + reconcile | **P2** |
| 15 | Progressive context pruning | Freebuff `context-pruner.ts` | Hard truncate | Prune tiers | **P2** |
| 16 | Tree task tracking `T1 → T1.1` | MiMo task UI | Table only | Subtask creation + render | **P2** |
| 17 | Web terminal replay component | OpenCode hero video | String helper only | React component | **P1** |
| 18 | Docs site (Fumadocs or static) | OpenCode `/docs`, Kilo `kilo-docs` | `docs/*.md` only | Static docs routes | **P2** |
| 19 | JetBrains plugin / desktop app | Kilo `kilo-jetbrains` | Missing | Out of scope v1 | **P3** |
| 20 | Honest comparison table on site | — | Exists, unverified claims | Audit each cell | **P0** |

---

## 5. Risks found during audit

1. **`site/index.html` makes claims the CLI cannot back** — the comparison matrix in `site/index.html:591-661` compares Signhify against four references; with items #3 and #4 unimplemented, several Signhify-side cells are currently false. A site that overstates is the exact failure mode the Master Prompt §3 forbids.
2. **`interactive.ts` fabricates MCP servers** (`rea`, `supabase`) when none are configured — a user could believe a server is connected and permitted when it is not. This is a security-adjacent honesty bug, not cosmetics.
3. **Two schema sources** — `signhify.config.schema.json` documents `apiKeyRef` while `cli/src/config.ts` reads `apiKey`; a user following the schema silently gets no key.
4. **18 modified files uncommitted** in the working tree. Nothing below assumes they are committed; T0.3 commits the baseline only after the user confirms.

---

## 6. Licensing notes

All four references are MIT except Freebuff (Apache-2.0). Taking **patterns and architecture** (sidebar slots, tri-state MCP, FTS tokenisation, footer composition) is unproblematic. Do **not** copy OpenCode's brand yellow, IBM Plex Mono lockup, hero video, copy text, or Freebuff's ad-funded framing — Signhify must stay visually and textually its own. Nothing from `.refs/` gets committed; it stays gitignored.

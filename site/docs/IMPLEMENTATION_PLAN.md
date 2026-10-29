# Signhify CLI — Implementation Plan (Reference-Driven)

**Companion to:** `docs/research/SIGNHIFY_AUDIT_AND_GAP_MATRIX.md` (evidence for every "today" claim here).
**Rule for every task below:** no task is "done" unless `npm run typecheck && npm test && npm run build` pass and the changed capability has a test.

---

## Phase 0 — Make the repo honest and green (blocking)

### T0.1 Link `packages/agents` into the workspace — ✅ DONE
- **Why:** blocked typecheck, build, and one e2e test (audit §1).
- **Files:** root `package.json` (workspace glob was fine — the junction in `node_modules/@signhify/` was missing), `packages/tools/package.json`.
- **Do:** `npm install` restored the junctions. Additional real fixes required to get green:
  - `packages/tools/package.json` — added `"type": "module"` (it was the only ESM-source package without it, breaking `@signhify/agents` interop).
  - `packages/tools/src/subagent.ts` — `dispatch()` was passing `{role, task, workingDirectory}` to a `SubagentTask` that needs `{id, role, objective}`.
  - `packages/tools/src/git.ts` — `import simpleGit` was not callable under Node16 ESM; now resolves the CJS default.
- **Test:** `npm run typecheck` exits 0; `npm test` 59/59; `npm run build` exits 0.

### T0.2 Make the e2e JSON test hermetic — ✅ DONE (root-cause fix, not a test patch)
- **Why:** `e2e.test.ts:62` failed; but the real bug was that `--output json` printed human-readable lines to **stdout** before the JSON, so `JSON.parse(stdout)` broke for any CI consumer.
- **Files:** `packages/cli/src/non-interactive.ts` (fallback events, checkpoint events and MCP list now go to stderr; `SIGNHIFY_MOCK_PROVIDER=1` was ignored in this path and now selects the mock adapter), `packages/cli/src/interactive.ts` (removed the fabricated `rea`/`supabase` MCP rows — an unconfigured server can no longer appear "connected"), `packages/providers/{src/fallback-router.ts,__tests__/fallback-router.test.ts}` (lint errors).
- **Test:** verified by execution — `SIGNHIFY_MOCK_PROVIDER=1 … --output json` parses cleanly to `success=true`. T1.2 still owns *real* connect-state.

### T0.3 Baseline commit
- **Pending user confirmation.** Uncommitted at the time of this plan: the 18 pre-existing modified files plus these T0 fixes. Suggested message: `fix: green baseline — workspace link, ESM interop, JSON-only stdout`.

---

## Phase 1 — TUI parity with the OpenCode status layout (P0/P1)

### T1.1 Section-based sidebar
- **Reference:** `.refs/opencode/packages/tui/src/feature-plugins/sidebar/{context,mcp,todo}.tsx` — each block is independent, collapsible, and hides itself when empty.
- **Files:** new `packages/cli/src/tui/sidebar/{context.tsx,mcp.tsx,todo.tsx,index.tsx}`; `interactive.ts` drops its inline sidebar block.
- **Do:** a `SidebarSection` interface `{ id, title, collapsible, isVisible(state), render() }`; `interactive.ts` renders `state.sidebarSections.map(s => s.isVisible() ? s.render() : null)`. No plugin system — a plain array (ponytail: add slots only if a third-party plugin story appears).
- **Test:** `sidebar.test.ts` — a section with `isVisible() === false` renders nothing; toggling collapses.

### T1.2 Real MCP status (replaces the fabricated list)
- **Reference:** OpenCode `sidebar/mcp.tsx` states `connected | failed | needs_auth | disabled`, counted as `N active, M errors`.
- **Files:** `tools/src/mcp-client.ts` (expose `getConnectionStatus(name)`), `cli/src/interactive.ts:93-100` (delete the fake list), new `tui/sidebar/mcp.tsx`.
- **Do:** on mount, connect only servers in `config.mcpServers`; each row shows a state dot + name. Never invent a server. On connect failure show `failed` with the first line of the error.
- **Test:** `mcp-client` status unit test with a fake child process that exits non-zero → `failed`; missing command → `failed`, never `connected`.

### T1.3 True footer status line
- **Reference:** OpenCode `prompt/footer.tsx` — `{tokens} · {percent}% · {tok/s} · {N subagents} · ctrl+p commands`, elements dropped when the terminal is narrow.
- **Files:** new `tui/footer.tsx`, `interactive.ts` (delete `activeRouterInfo` default at line 62 and the unused `tokenUsage` at 58-61).
- **Do:** the footer reads from a single `SessionStatus` object updated by the agent loop: `{ provider, model, tokens, contextLimit, tokensPerSecond, subagentCount, fallback }`. Before any turn completes it shows `no session` — never a made-up endpoint.
- **Test:** render footer with `tokens=0` → no percent shown; with a fallback event → `via <endpoint>` string present; narrow width (40 cols) → shortcuts hidden.

### T1.4 Command palette
- **Reference:** OpenCode keymap `command.palette.show`, shown in the footer as `ctrl+p commands`.
- **Files:** `tui/palette.tsx`; commands registered next to their implementation (`/context-limit`, `/model`, `/mode`, `/memory`, `/mcp`, `/compact`, `/sessions`).
- **Do:** fuzzy filter over a static command array, `Enter` dispatches, `Esc` closes.
- **Test:** palette.test.ts — filtering and dispatch.

---

## Phase 2 — Memory & context correctness (P0/P1)

### T2.1 FTS5 query sanitiser
- **Reference:** `.refs/mimo-code/packages/cli/src/memory/fts-query.ts`.
- **Files:** new `packages/memory/src/fts-query.ts`; `memory-store.ts:96` `search()` uses it.
- **Do:** tokenise with `/[\p{L}\p{N}_]+/gu`, phrase-quote each token (doubling inner `"`), OR-join; return `null` on no tokens and have `search()` return `[]`.
- **Test:** `search('postgres "port" - 5433')` returns rows instead of throwing; `search('!!!')` returns `[]`; a query whose tokens all hit still ranks by `rank`.

### T2.2 `/context-limit` command
- **Reference:** MiMo `/context-limit`.
- **Files:** `cli/src/palette` registration + `core/src/context-manager.ts` (already has `setContextLimit`).
- **Do:** `/context-limit 64000` sets the live limit and persists to `.signhify/config.json` via the existing `saveConfig`.
- **Test:** command sets and persists; invalid value rejected with the schema error.

### T2.3 One schema source
- **Files:** `signhify.config.schema.json`, `cli/src/config.ts`.
- **Do:** make the runtime parse with a JSON-Schema validator against the shipped schema (single source), or generate the schema from the TS type — pick the one that deletes code. Today `apiKeyRef` vs `apiKey` disagree; resolve in favor of `apiKeyRef` everywhere and keep a migration that maps legacy `apiKey`.
- **Test:** a config using `apiKeyRef: "env:X"` validates and resolves; `apiKey` legacy still loads.

---

## Phase 3 — Agent quality (P1/P2)

### T3.1 Diff-before-write
- **Files:** `tools/src/file-io.ts`.
- **Do:** `write_file` emits a unified diff and routes through the permission engine's `requiresConsent` when the target exists; `--auto` keeps current behaviour but logs the diff.
- **Test:** existing file → consent requested, content unchanged on deny; new file → no prompt.

### T3.2 LLM-backed subagents
- **Reference:** Freebuff `agents/{thinker,editor,reviewer,file-picker}.ts`; Kilo `REVIEW.md`.
- **Files:** `packages/agents/src/*.ts`.
- **Do:** each subagent receives an adapter and returns real output. `@Planner` produces a `TaskNode[]` with `T1 → T1.n` children persisted via `memory-store.saveTask`. Keep the current template output as the offline fallback when `SIGNHIFY_MOCK_PROVIDER=1`.
- **Test:** orchestrator test asserts a planner result yields ≥1 child task with `parentId === 'T1'`.

### T3.3 Session registry
- **Files:** `packages/memory/src/memory-store.ts` (new `sessions` table), CLI `/sessions` list, `--resume <id>` flag.
- **Test:** create → list → resume reads back the checkpoint.

### T3.4 Progressive context pruning
- **Reference:** Freebuff `agents/context-pruner.ts`, `lean-context.ts`.
- **Files:** `core/src/context-manager.ts`.
- **Do:** three tiers — keep last N turns verbatim → summarise older turns into the existing `[Context Notice]` line → drop tool outputs older than the window. Order matters; summarisation is the only new code.
- **Test:** a 200-message session prunes in the right order and reports accurate `compactedCount`.

---

## Phase 4 — Website (P0 honesty, P1 build)

### T4.1 Audit and fix the comparison table
- **Files:** `site/index.html:591-661`.
- **Do:** every Signhify-side cell must be provable from the CLI at the commit shipped. Until T1.2/T1.3 land, those cells say "in progress" or are removed.
- **Test:** manual — run the CLI, confirm each claimed row.

### T4.2 Terminal replay component
- **Reference:** OpenCode ships a hero **video**; Signhify cannot honestly do that without recording its own TUI.
- **Files:** `packages/web/src/components/TerminalPreview.ts` → a fixture-driven replay that emits escaped HTML. The fixture is a real transcript captured from `SIGNHIFY_MOCK_PROVIDER=1`.
- **Test:** a vitest assert — the fixture's transcript HTML escapes `<`/`>`/`&` in message content (no injection), and the output contains every fixture line. `prefers-reduced-motion` is a CSS concern in `site/`, not something a string helper can test.

### T4.3 Site sections
- **Files:** `site/index.html`.
- **Do:** add `#install` (three shell tabs: npm / curl / PowerShell `irm`), `#providers` (the actual `DEFAULT_ZERO_COST_CHAIN` order, labelled "yours to reorder"), `#security` (data-flow: nothing leaves the machine unless you configure a remote provider), `#changelog` (from `CHANGELOG.md`).

### T4.4 Docs routes
- **Files:** `docs/*.md` → static pages under `site/docs/` with a `vercel.json` rewrite. No framework migration: the current `outputDirectory: "site"` is already free-tier-deployable and fast.

---

## Phase 5 — Release (P2/P3)

- T5.1 Windows + Linux CI running typecheck/test/build (matrix exists in `.github/workflows`).
- T5.2 `install.ps1` / `install.sh` idempotence test in CI.
- T5.3 Checksums on release artifacts; changelog generated from conventional commits.
- T5.4 JetBrains plugin and desktop app — explicitly **out of scope** for v1; Kilo parity here costs more than it returns before the CLI is solid.

---

## Explicitly rejected from the references

| Idea | Source | Why rejected |
|---|---|---|
| Ad-funded "100% free forever" framing | Freebuff | Cost claims Signhify cannot guarantee; the free path is user-owned keys + local routing, which is stronger anyway |
| 500+ model catalog with zero markup | Kilo | Requires a gateway business; Signhify routes to the user's own endpoints |
| Plugin slot system for TUI sidebar | OpenCode | Real value only for third-party TUI plugins; a plain array is enough now |
| OpenTUI/Solid rewrite of the TUI | OpenCode/Kilo/MiMo | Ink already works on Node 22 and shares types with the CLI; a rewrite buys split-pane panes and costs the whole TUI |
| Video hero | OpenCode | Fabricated if not recorded from Signhify itself |

---

## Execution order

`T0.1 → T0.2 → T0.3 (commit) → T2.1 → T1.2 → T1.3 → T1.1 → T2.2 → T3.1 → T1.4 → T3.2 → T2.3 → T3.3 → T4.1 → T4.3 → T3.4 → T4.2 → T4.4 → T5.*`

Rationale: unblock the build, then fix the two bugs that make the product lie (T2.1 crashes on real queries; T1.2 invents MCP servers), then the footer, then everything additive.

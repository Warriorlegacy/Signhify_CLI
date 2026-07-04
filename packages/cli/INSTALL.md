# @signhify/cli — Installation

Terminal frontend for the Signhify AI coding agent — Ink TUI + non-interactive runner.

## Install

```bash
npm install @signhify/cli
```

## Peer dependencies

```bash
npm install @signhify/core @signhify/providers @signhify/tools @signhify/memory
```

## Requirements

- Node.js 20+
- No additional runtime dependencies

## CLI binary

```bash
npx signhify --help
npx signhify run "fix the failing tests" --auto --output json
npx signhify wizard
```

## Optional dependencies

- `keytar` — OS keychain access for API key storage. Installation is best-effort; omitted platforms still build and run without keychain features.

## Package scripts

```bash
npm run build
npm run test
```

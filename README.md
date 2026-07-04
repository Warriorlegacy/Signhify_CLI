# Signhify

An open-source AI coding agent — in the terminal and in the IDE.

Signhify plans, writes, tests, and fixes code from natural language, remembers your project across sessions, and can run unattended in CI/CD. Ships as a standalone CLI and a VS Code extension sharing one core engine.

## Quick Start

```bash
npm install
npm run build
npm run test
```

## Documentation

- [npm installation guide](docs/npm-install.md) — install from source, consume packages, VS Code extension build
- [Package INSTALL.md](packages/core/INSTALL.md) — per-package installation instructions

## Packages

| Package | Description |
|---|---|
| `@signhify/core` | Agent loop, mode manager, context/memory manager, permission engine |
| `@signhify/providers` | Model adapter interface + Anthropic, Gemini, OpenAI, compatible adapters |
| `@signhify/tools` | file-io, shell-exec, git, browser, mcp-client, search |
| `@signhify/memory` | SQLite FTS5 store, checkpoint writer, dream/distill engine |
| `@signhify/cli` | Terminal TUI (Ink) + non-interactive runner |
| `@signhify/vscode` | VS Code extension — chat panel + inline completions |

## CLI

```bash
npx signhify --help
npx signhify run "fix the failing tests" --auto --output json
npx signhify wizard
```

## Development

```bash
# Build all packages
npm run build

# Run all tests
npm run test

# Lint
npm run lint

# Typecheck
npm run typecheck
```

## License

MIT

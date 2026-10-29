# Architecture

## Overview

`Warriorlegacy/Signhify_CLI` is a turbo-monorepo AI developer CLI providing:
- **CLI** — Command-line interface for Signhify workflows
- **Core** — Shared utilities and types
- **Memory** — Agent memory and state management
- **Providers** — AI provider adapters (OpenAI, Anthropic, Google, open-weight)
- **Tools** — Tool definitions, permissions, and MCP integration
- **VSCode Extension** — IDE integration

## Tech Stack

- **Runtime:** Node.js + TypeScript
- **Build:** Turbo + pnpm
- **Testing:** Vitest
- **Linting:** ESLint + Prettier
- **CI/CD:** GitHub Actions (5 workflows)
- **Package Registry:** npm

## Monorepo Structure

```
packages/
├── cli/             Command-line interface
├── core/            Shared utilities and types
├── memory/          Agent memory and state management
├── providers/       AI provider adapters
├── tools/           Tool definitions, permissions, MCP
└── vscode-ext/      VSCode extension

site/                Documentation site
```

## AI-Native Features

- Multi-provider LLM support with auto-fallback
- Agent lifecycle management
- Tool registry with permissions and audit
- MCP-compatible tool access
- Structured output validation

## Security

See [SECURITY.md](SECURITY.md).

## Testing

- Unit tests: Vitest
- Type checking: TypeScript
- Linting: ESLint
- CI: GitHub Actions

## License

MIT — see [LICENSE](LICENSE).

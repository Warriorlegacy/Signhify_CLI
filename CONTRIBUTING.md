# Contributing to Signhify

We love contributions! Here's how to get started.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [What We Accept](#what-we-accept)
- [Getting Started](#getting-started)
- [Issue-First Policy](#issue-first-policy)
- [Pull Request Guidelines](#pull-request-guidelines)
- [Development Setup](#development-setup)
- [Coding Conventions](#coding-conventions)
- [Testing](#testing)
- [Trust & Vouch System](#trust--vouch-system)

## Code of Conduct

All contributors must follow our [Code of Conduct](CODE_OF_CONDUCT.md). Be respectful, constructive, and inclusive.

## What We Accept

We welcome contributions in these areas:

- **Bug fixes** — open an issue first, then submit a PR
- **New model provider adapters** — Anthropic, Gemini, Groq, OpenRouter, etc.
- **Additional tools** — new agent capabilities (database, API, etc.)
- **Performance improvements** — faster agent loop, lower token usage, better caching
- **Documentation** — README improvements, guides, better error messages
- **Test coverage** — add tests for untested paths

For UI/core architecture changes, please open a discussion with the core team before starting work.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/<your-username>/Signhify_CLI.git`
3. Install dependencies: `npm install`
4. Build all packages: `npm run build`
5. Run tests: `npm test`

Look for issues labeled `good first issue` or `help wanted` to find starter tasks.

## Issue-First Policy

**All pull requests must reference an existing issue.**

1. Search existing issues before opening a new one
2. If no issue exists, create one describing the problem or feature
3. Wait for maintainer feedback before starting work
4. Reference the issue in your PR description with `Closes #123`

PRs without a linked issue will be closed. This avoids duplicated effort and unplanned work.

## Pull Request Guidelines

- PR title must follow [Conventional Commits](https://www.conventionalcommits.org/):
  - `feat:` — new feature
  - `fix:` — bug fix
  - `docs:` — documentation
  - `chore:` — maintenance, tooling
  - `refactor:` — code restructuring
  - `test:` — adding/fixing tests
- Keep PRs focused on a single concern (one issue per PR)
- Include a clear description of what and why
- List verification steps so reviewers can reproduce
- Ensure all CI checks pass (build, lint, typecheck, test)
- Squash commits before merging

### PR Description Template

```markdown
Closes #<issue-number>

## Description
<brief description of changes>

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Refactor
- [ ] Documentation
- [ ] Tests

## Verification
1. <step 1>
2. <step 2>
```

## Development Setup

### Prerequisites

- Node.js 20+ (use `nvm use` or `.nvmrc`)
- npm 9+

### Build & Test

```bash
npm install          # Install all workspace dependencies
npm run build        # Build all packages
npm run lint         # Check code style
npm run typecheck    # Type-check all packages
npm test             # Run all tests
```

### Debugging with VS Code

A launch configuration is available at `.vscode/launch.json`. Open the repo in VS Code, set breakpoints, and press F5.

## Coding Conventions

- **Language:** TypeScript only (strict mode)
- **Module system:** ES modules (`type: "module"` in package.json)
- **Formatting:** Prettier (2 spaces, no semicolons, trailing commas)
- **Linting:** ESLint with TypeScript rules
- **No `any`** — use proper types. If unavoidable, add a `// eslint-disable-next-line` comment explaining why.
- **No `else`** after early returns — prefer guard clauses
- **No unnecessary destructuring** — keep it simple
- **Prefer `const`** over `let`
- **Async/await** over raw promises
- **File naming:** kebab-case (`file-io.ts`, `agent-loop.ts`)
- **Exports:** named exports only (no `export default`)

## Testing

- **Framework:** Vitest
- **Run:** `npm test` (from root) or `npm test -w packages/<name>`
- **Location:** `src/__tests__/` next to source files
- **Naming:** `<module>.test.ts`
- **Coverage target:** 80%+
- **Test types:** unit (mocked), integration (real FS/git), E2E (full agent loop)

## Trust & Vouch System

To maintain quality, we use a trust-based system:

- **Vouched contributors** have PRs auto-approved for trivial changes
- Maintainers vouch by commenting `/vouch @user` on a merged PR
- Low-quality AI-generated PRs will be flagged with `/denounce`
- Three denouncements = temporary contribution ban

This system is enforced via [vouch](https://github.com/mitchellh/vouch) and `.github/VOUCHED.td`.

## Security

Report security vulnerabilities privately via [GitHub Security Advisory](https://github.com/Warriorlegacy/Signhify_CLI/security/advisories) — never in public issues.

See [SECURITY.md](SECURITY.md) for our full disclosure policy.

## Questions?

Open a [Discussion](https://github.com/Warriorlegacy/Signhify_CLI/discussions) or join our community chat.

Thank you for contributing to Signhify!

# Signhify — npm Installation Guide

This guide covers installing Signhify from source, consuming the workspace packages in another project, and understanding the per-package npm scripts.

## Prerequisites

- Node.js 20+
- npm 9+ (npm workspaces enabled)
- Git

## Install from source

```bash
git clone https://github.com/Warriorlegacy/Signhify_CLI.git
cd Signhify_CLI
npm install
npm run build
```

## Run tests

```bash
# Run all test suites across workspaces
npm test

# Run a single package's suite
node node_modules/vitest/vitest.mjs run packages/memory/tests
node node_modules/vitest/vitest.mjs run packages/providers/tests
node node_modules/vitest/vitest.mjs run packages/tools/tests
```

## Consume packages

Workspace packages are referenced via npm workspaces with `"*"` cross-dependencies. If you need to `npm link` an individual package for local development:

```bash
# From the repo root
npm link @signhify/core
npm link @signhify/providers
npm link @signhify/tools
npm link @signhify/memory
npm link @signhify/cli
```

Then in a consumer project:

```bash
npm link @signhify/core
npm link @signhify/providers
npm link @signhify/tools
npm link @signhify/memory
npm link @signhify/cli
```

## CLI usage

```bash
npx signhify --help
npx signhify run "fix the failing tests" --auto --output json
npx signhify wizard
```

## Package scripts

| Package | Scripts |
|---|---|
| `@signhify/core` | `npm run build`, `npm run dev`, `npm run typecheck`, `npm run clean` |
| `@signhify/providers` | `npm run build`, `npm run test`, `npm run typecheck` |
| `@signhify/tools` | `npm run build`, `npm run test` |
| `@signhify/memory` | `npm run build`, `npm run dev`, `npm run test`, `npm run typecheck`, `npm run clean` |
| `@signhify/cli` | `npm run build`, `npm run test` |
| `@signhify/vscode-ext` | `npm run build`, `npm run watch`, `npm run test`, `npm run typecheck`, `npm run clean` |

## Notes

- `better-sqlite3` is a native module; prebuilt binaries are used on most platforms. On Windows, Visual Studio Build Tools may be required if no prebuilt is available.
- `keytar` is an optional dependency in `@signhify/cli`. It provides OS keychain access for API key storage. If installation fails (common on Windows), build still succeeds and keychain features are disabled at runtime.
- Playwright is opt-in. It is declared in `@signhify/tools` so `tsc -b` can resolve the module, but it is not bundled unless you install it.
- Per-package `vitest` runs can be unreliable under npm workspace hoisting. For `packages/cli`, use: `node ../../node_modules/vitest/vitest.mjs run`.

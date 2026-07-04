# @signhify/vscode-ext — Installation

VS Code extension — chat panel, inline completions, diff viewer, system notifications.

## Install (from source)

```bash
cd packages/vscode-ext
npm install
npm run build
```

## Requirements

- Node.js 20+
- esbuild (bundles to CJS at `dist/extension.js`)
- VS Code 1.85+

## Bundle

```bash
npm run build        # one-shot bundle
npm run watch        # watch mode
```

The bundle is written to `dist/extension.js`.

## Install in VS Code

Use the `.vsix` produced by `vsce package`, or run the extension in the Extension Development Host via `F5`.

## Scripts

```bash
npm run build
npm run watch
npm run typecheck
npm run test
npm run clean
```

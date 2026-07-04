# @signhify/tools — Installation

Tool handlers for the Signhify agent loop — file-io, shell-exec, git, browser, mcp-client, search.

## Install

```bash
npm install @signhify/tools
npm install simple-git
```

## Peer dependencies

```bash
npm install @signhify/core
```

## Requirements

- Node.js 20+
- `simple-git` is required for git operations
- `playwright` is optional — browser tool uses dynamic import and falls back to an install hint if absent

## Usage

```ts
import { fileIoTool, shellExecTool, gitTool, searchTool, browserTool, mcpClientTool } from '@signhify/tools';
```

## Playwright (optional)

```bash
npm install --save-dev playwright @playwright/test
npx playwright install chromium
```

## Package scripts

```bash
npm run build
npm run test
```

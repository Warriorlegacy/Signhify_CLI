# @signhify/providers — Installation

Model provider adapters for Signhify CLI — Anthropic, Gemini, OpenAI, OpenAI-compatible.

## Install

```bash
npm install @signhify/providers
```

## Peer dependencies

```bash
npm install @signhify/core
```

## Requirements

- Node.js 20+
- No native dependencies

## Usage

```ts
import { createProviderAdapter } from '@signhify/providers';
```

Supports providers: `anthropic`, `google`, `openai`, `openai-compatible`.

## Package scripts

```bash
npm run build
npm run test
npm run typecheck
```

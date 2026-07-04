# @signhify/memory — Installation

Persistent memory — SQLite FTS5 store, checkpoint writer, dream/distill engine.

## Install

```bash
npm install @signhify/memory
```

## Peer dependencies

```bash
npm install @signhify/core
npm install better-sqlite3
```

## Requirements

- Node.js 20+
- `better-sqlite3` is a native module; prebuilt binaries are used on most platforms
- On Windows without a prebuilt binary, Visual Studio Build Tools are required

## Usage

```ts
import { MemoryStore, CheckpointWriter, MemoryMdManager, DreamDistillEngine } from '@signhify/memory';
```

## Package scripts

```bash
npm run build
npm run dev
npm run test
npm run typecheck
npm run clean
```

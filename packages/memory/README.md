# @signhify/memory

Persistent memory, checkpointing, and session branching engine for Signhify CLI.

## Installation

```bash
npm install @signhify/memory
```

## Features

- **SQLite + FTS5 Store**: Fast vector and full-text search over conversation turns, code snippets, and execution traces with SQL injection and syntax error-proof token sanitization (`fts-query`).
- **Session Branching**: Fork active sessions into isolated branches via `forkSession`, with lineage tracking (`parent_id`) and interactive session resumption.
- **Checkpoint System**: Automatic 80% context window memory snapshotting preserving active goals, modified files, and open tasks.
- **Dream / Distill**: Trace distillation converting raw session logs into durable `.signhify/MEMORY.md` summaries and specialized agent personas.

## License

MIT

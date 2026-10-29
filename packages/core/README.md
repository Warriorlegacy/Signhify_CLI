# @signhify/core

The core engine for Signhify CLI and VS Code extension. Provides agent loops, permissions, modes, task management, and project instruction discovery.

## Installation

```bash
npm install @signhify/core
```

## Features

- **AgentLoop**: Core iterative agent loop with streaming LLM output, tool invocation, token tracking, and cooperative `AbortSignal` cancellation.
- **ModeManager**: Built-in mode profiles (`build`, `plan`, `debug`, `compose`) governing allowed actions and instructions.
- **PermissionEngine**: Fine-grained capability checks (`read`, `write`, `execute`, `browser`, `network`) with auto-approve or user-prompt workflows.
- **ContextManager**: Hierarchical context assembly, rolling conversation compaction, and sliding window budgeting.
- **ProjectInstructions**: Automatic multi-tier instruction discovery supporting `AGENTS.md`, `CLAUDE.md`, and `.signhify/instructions.md`.

## License

MIT

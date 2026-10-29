# @signhify/cli

The terminal interface for Signhify CLI. Features a rich Ink-based interactive TUI, streaming token velocity metrics, session branching, and non-interactive CI/CD execution.

## Installation

```bash
# Global install
npm install -g @signhify/cli

# Run directly
npx signhify
```

## Quick Start

```bash
# Start interactive TUI
signhify

# Non-interactive autonomous execution
signhify run "Add comprehensive test suite" --auto --goal "all tests pass"

# Manage and resume sessions
signhify sessions
signhify resume <session-id>

# Run configuration wizard
signhify wizard
```

## Key Capabilities

- **Interactive TUI**: Ink React-based terminal interface with real-time markdown streaming, syntax highlighting, diff viewing, and slash commands (`/fork`, `/sessions`, `/dream`, `/goal`).
- **Live Velocity Meter**: Real-time token output speed tracking (`tok/s`) during model streaming.
- **Instant Cancellation**: Press `Esc` to instantly abort in-flight LLM calls, kill spawned child process trees, and halt queued subagents.
- **CI/CD Mode**: Deterministic `--output json` and exit codes for GitHub Actions and headless environments.

## License

MIT

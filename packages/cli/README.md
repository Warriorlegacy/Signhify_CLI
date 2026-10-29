# @signhify/cli

The terminal interface for the Signhify AI coding agent. Features an interactive Ink-based TUI, streaming token velocity metrics, session branching, non-interactive CI/CD execution, and hardened Bring Your Own Key (BYOK) multi-provider support.

## Installation

```bash
# Universal single install command (macOS, Linux, Windows)
npm install -g @signhify/cli

# Zero-install direct execution (runs latest version)
npx @signhify/cli
```

## Quick Start

```bash
# Start interactive TUI session
signhify

# Non-interactive autonomous execution
signhify run "Add comprehensive test suite" --auto --goal "all tests pass"

# Manage and resume sessions
signhify sessions
signhify resume <session-id>

# Run interactive configuration wizard
signhify configure
# or
signhify wizard
```

## Multi-Provider BYOK & Setup Methods

Signhify CLI works with your own API keys across all major providers: Anthropic (Claude 3.5 Sonnet), OpenAI (GPT-4o, o1), Google Gemini (1.5 Pro), Groq, DeepSeek (V3, R1), OpenRouter, Mistral, Ollama, and generic OpenAI-compatible endpoints.

### 1. Interactive Setup Wizard (`signhify configure`)
Configure providers, test connectivity, and migrate secrets securely:
```bash
signhify configure
```
Prompts for vendor selection, model ID, and API key. When saved, literal keys are securely placed into the operating system keychain (`keytar`), leaving only safe references in configuration.

### 2. Environment Variables
Export credentials in your shell or CI/CD environment. Signhify CLI automatically detects both namespaced and canonical variables:
```bash
# Namespaced variables (highest priority)
export SIGNHIFY_ANTHROPIC_API_KEY="sk-ant-..."
export SIGNHIFY_OPENAI_API_KEY="sk-..."
export SIGNHIFY_GEMINI_API_KEY="AIzaSy..."
export SIGNHIFY_GROQ_API_KEY="gsk_..."
export SIGNHIFY_DEEPSEEK_API_KEY="sk-..."

# Standard variables
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."
export GROQ_API_KEY="gsk_..."
```

### 3. CLI Overrides (`--provider`, `--api-key`, `--model`)
Supply or override active provider settings on the fly without modifying configuration files:
```bash
# Interactive session with specific provider
signhify --provider anthropic --api-key sk-ant-...

# Headless task with Groq for high-velocity code generation
signhify run "generate integration tests" --provider groq --api-key gsk_... --auto

# Local offline task with Ollama
signhify run "review pull request diff" --provider ollama --model qwen2.5-coder:7b --auto
```

## Credential Safety & Zero-Leak Isolation

- **OS Keychain Storage**: Keys entered interactively are stored in macOS Keychain, Windows Credential Manager, or Linux Secret Service via `keytar`. Configuration files store only pointers (`keytar:signhify:...` or `env:...`).
- **Telemetry Stripped**: API keys, Bearer headers, and secrets are scrubbed before any telemetry is emitted.
- **Excluded from Session Checkpoints**: Memory SQLite databases (`.signhify/memory.db`) record messages and tool results; raw credentials are never persisted to checkpoint tables.
- **Masked in TUI**: Keys are masked across terminal screens, sidebars, and log outputs (`sk-ant-***1234`).

## Transparent Fallback & Resilient Failover

Signhify automatically recovers from transient upstream errors:
- **HTTP 429 Failover**: Switches immediately to the next configured fallback model when rate limits or quotas are hit.
- **Context Overflow Recovery**: Automatically routes oversized prompts to long-context models without dropping execution state.
- **Upstream Outages**: Handles transient HTTP 5xx errors with exponential backoff and seamless provider failover.
- **Zero Progress Loss**: Active task checkpoints, subagents, and tool outputs persist safely across provider transitions.

## Key Capabilities

- **Interactive TUI**: Ink React-based terminal interface with real-time markdown streaming, syntax highlighting, diff viewing, and slash commands (`/fork`, `/sessions`, `/dream`, `/goal`).
- **Live Velocity Meter**: Real-time token output speed tracking (`tok/s`) during model streaming.
- **Instant Cancellation**: Press `Esc` to instantly abort in-flight LLM calls, kill spawned child process trees, and halt queued subagents.
- **CI/CD Mode**: Deterministic `--output json` and exit codes for GitHub Actions and headless environments.
- **Session Checkpoints**: Automatic snapshots at 80% context window to prevent truncation and allow seamless resume.

## License

MIT

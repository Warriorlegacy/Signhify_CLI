# Changelog

All notable changes to Signhify will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.1] - 2026-07-04

### Fixed

- SQLite database crash on first run — `MemoryStore` now creates the `.signhify/` directory before opening the database
- Installer scripts (`install.ps1`, `install.sh`) returning 404 on the website — now served from Vercel

### Added

- Studio brand assets (logo, banner, icon) across README, website, and VS Code extension
- Vercel deployment config for static site publishing
- Clean URL support and Open Graph meta tags for the website

## [0.1.0] - 2026-07-04

### Added

- Full OSS infrastructure: CONTRIBUTING.md, SECURITY.md, CODE_OF_CONDUCT.md, USE_RESTRICTIONS.md
- GitHub issue templates (bug report, feature request, question) and PR template
- Separate CI workflows for lint, typecheck, and test with caching
- Release workflow for npm publishing and VS Code Marketplace on tag push
- PowerShell install script for Windows
- Nix flake for reproducible development shells
- Husky pre-push hooks (version check + typecheck)
- VS Code workspace settings and extension recommendations
- Improved README with badges, install options, architecture diagram, and roadmap

### Changed

- `.gitignore` restructured with additional exclusions
- `MiMo-Code-main/` removed from git tracking (reference fork)
- `AGENTS.md` updated to reflect actual codebase state

## [0.1.0] - 2026-07-04

### Added

- Core agent loop with streaming, tool execution, and permission enforcement
- Model provider adapters: OpenAI, Anthropic, Google Gemini, OpenAI-compatible
- Tool implementations: file-io, shell-exec, git, search, browser (Playwright), MCP client
- Memory system with SQLite+FTS5 storage, checkpoints, and dream/distill
- CLI with interactive TUI (Ink), non-interactive runner, and setup wizard
- VS Code extension with chat panel and inline completions
- Multi-mode system: Build, Plan, Debug, Compose
- Goal/judge verification for autonomous termination
- JSON Schema for configuration
- MIT License

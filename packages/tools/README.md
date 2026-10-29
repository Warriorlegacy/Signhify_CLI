# @signhify/tools

Comprehensive execution and automation tools for Signhify CLI.

## Installation

```bash
npm install @signhify/tools
```

## Tools Included

- **file-io**: Sandboxed file read, write, targeted patch, and pre-write unified diff generation with truncation safeguards.
- **shell-exec**: Terminal command runner with output condensing and cross-platform process tree killing (`taskkill` on Windows, process groups on POSIX) on cancellation.
- **git**: Git repository inspection, staging, committing, and status parsing.
- **search**: Fast ripgrep/regex file and content indexing.
- **browser**: Playwright-backed headless browser navigation, DOM inspection, and screenshot capture with safe process lifecycle handling.
- **mcp-client**: Model Context Protocol (MCP) client over stdio transport supporting dynamic tool discovery and execution.
- **subagent**: Delegated subagent dispatch and parallel swarm execution.

## License

MIT

# MCP servers

Signhify currently supports local MCP servers over stdio. Remote `sse` and `http` entries are rejected by the config schema until those transports are implemented.

## Configure a server

Add a server entry to `.signhify/config.json`:

```json
{
  "provider": {
    "agent": {
      "vendor": "openai",
      "model": "gpt-4o-mini",
      "apiKeyRef": "env:OPENAI_API_KEY"
    }
  },
  "mcpServers": [
    {
      "name": "my-tools",
      "command": "node",
      "args": ["./mcp-server.js"],
      "transport": "stdio"
    }
  ]
}
```

Configured servers stay stopped when Signhify starts. Ask Signhify to connect to a configured server or built-in preset; the CLI shows `disabled` before connection and `connected` or `failed` afterward. The approval preview shows the exact command and arguments. MCP subprocesses inherit Signhify's process environment, so only approve commands and packages you trust.

The current built-in preset is REA, using `npx -y rea-agents@6.8.0 mcp`. That package currently requires Node.js 22.23.4 or newer; check its [installation guide](https://github.com/morluto/rea/blob/main/docs/installation.md) and [npm package](https://www.npmjs.com/package/rea-agents) before connecting.

Cloudflare, Supabase, and OpenSEO do not have Signhify presets at this time. Supabase and OpenSEO currently document hosted HTTP MCP setup ([Supabase](https://supabase.com/docs/guides/ai-tools/mcp), [OpenSEO](https://www.openseo.so/docs/mcp)); those endpoints require the future Streamable HTTP transport work.

## Automatic mode

`mcp-client` can list configured server names and connection status without approval. Connecting, invoking a server tool, and disconnecting require a preview and explicit approval. `--auto` rejects all three actions. Shell command allowlists do not authorize MCP processes.

The client fetches tool schemas on connection so it can validate tool names before invocation. It exposes one generic `mcp-client` function to the model instead of adding every server schema directly. Resources and prompts are fetched only when explicitly listed, which avoids startup requests to capabilities a session may not use.

Pressing Esc during an interactive run cancels the client wait for an in-flight stdio request and sends MCP's `notifications/cancelled` notification. Request timeouts do the same, except for the required `initialize` handshake. Cancellation is cooperative; a server may ignore the notification or finish an action before it receives it, so completed side effects are not rolled back.

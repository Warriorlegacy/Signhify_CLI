import { ToolHandler } from './tool-handler.js';
import { spawn, ChildProcess } from 'node:child_process';

export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpPrompt {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}

export const BUILT_IN_MCP_PRESETS: Record<string, { command: string; args: string[]; description: string }> = {
  rea: {
    command: 'npx',
    args: ['-y', 'rea-agents@6.8.0', 'mcp'],
    description: 'Reverse-Engineer-Anything MCP server for runtime code & web inspection (requires Node.js 22.23.4+)',
  },
};


interface McpConnection {
  process: ChildProcess;
  tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
  nextId: number;
  pending: Map<number, { resolve: (value: unknown) => void; reject: (reason: Error) => void; timeout: ReturnType<typeof setTimeout>; cleanup: () => void }>;
  reconnectAttempts: number;
  command: string;
  args: string[];
}

const connections = new Map<string, McpConnection>();
let configuredServers: Array<{ name: string; command?: string; args?: string[] }> = [];

export function configureMcpServers(servers: Array<{ name: string; command?: string; args?: string[] }> = []): void {
  configuredServers = servers;
}

function resolveMcpCommand(serverName: string, args: Record<string, unknown>): { command: string; args: string[] } {
  const configured = configuredServers.find((server) => server.name === serverName);
  const preset = BUILT_IN_MCP_PRESETS[serverName];
  const command = typeof args.command === 'string' ? args.command : configured?.command ?? preset?.command;
  const commandArgs = args.args ?? configured?.args ?? preset?.args ?? [];
  if (!command?.trim()) throw new Error(`No command specified for server "${serverName}" and no matching preset found.`);
  if (!Array.isArray(commandArgs) || commandArgs.some((arg) => typeof arg !== 'string')) {
    throw new Error('MCP command arguments must be an array of strings.');
  }
  return { command, args: commandArgs as string[] };
}

function getKnownServerNames(): string[] {
  return Array.from(new Set([
    ...configuredServers.map((server) => server.name),
    ...Object.keys(BUILT_IN_MCP_PRESETS),
    ...statuses.keys(),
    ...connections.keys(),
  ]));
}

function previewMcpAction(args: Record<string, unknown>): string {
  const action = String(args.action ?? '');
  const serverName = String(args.serverName ?? '');
  if (action === 'connect') {
    if (!serverName) throw new Error('MCP server name is required.');
    const command = resolveMcpCommand(serverName, args);
    return `Connect to MCP server ${serverName}\nCommand: ${command.command} ${JSON.stringify(command.args)}\nEnvironment: inherits Signhify's process environment.`;
  }
  if (action === 'invoke') {
    if (!serverName || typeof args.toolName !== 'string' || !args.toolName) throw new Error('MCP server name and tool name are required.');
    const toolArgs = args.arguments ?? {};
    if (typeof toolArgs !== 'object' || toolArgs === null || Array.isArray(toolArgs)) throw new Error('MCP tool arguments must be an object.');
    return `Invoke ${serverName}.${args.toolName}\nArguments: ${JSON.stringify(toolArgs, null, 2)}`;
  }
  if (action === 'disconnect') {
    if (!serverName) throw new Error('MCP server name is required.');
    return `Disconnect MCP server ${serverName}`;
  }
  return action;
}

function readJsonLines(buffer: string): { messages: Array<Record<string, unknown>>; remainder: string } {
  const results: Array<Record<string, unknown>> = [];
  const newline = buffer.lastIndexOf('\n');
  if (newline < 0) return { messages: results, remainder: buffer };
  const lines = buffer.slice(0, newline).split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      results.push(parsed);
    } catch {
      // Ignore malformed stdout lines; MCP servers must keep diagnostics on stderr.
    }
  }

  return { messages: results, remainder: buffer.slice(newline + 1) };
}

function drainBuffer(conn: McpConnection): void {
  const { process } = conn;
  if (!process.stdout) return;

  const onData = (data: Buffer) => {
    const text = data.toString();
    const messages = (process as unknown as { _jsonBuffer?: string })._jsonBuffer ?? '';
    const updated = messages + text;
    const parsed = readJsonLines(updated);
    if (parsed.remainder.length > 8 * 1024 * 1024) {
      process.kill();
      return;
    }
    (process as unknown as { _jsonBuffer?: string })._jsonBuffer = parsed.remainder;

    for (const entry of parsed.messages) {
      const id = typeof entry.id === 'number' ? entry.id : Number(entry.id);
      if (id && conn.pending.has(id)) {
        const pending = conn.pending.get(id)!;
        conn.pending.delete(id);
        pending.cleanup();
        const { resolve, reject } = pending;
        if ('error' in entry && entry.error) {
          reject(new Error((entry.error as { message?: string }).message ?? 'MCP error'));
        } else {
          resolve(entry);
        }
      }
    }
  };

  process.stdout.on('data', onData);
}

async function createConnection(
  serverName: string,
  command: string,
  commandArgs: string[],
  signal?: AbortSignal,
  maxReconnectAttempts = 3
): Promise<McpConnection> {
  for (let attempt = 0; attempt < maxReconnectAttempts; attempt++) {
    if (signal?.aborted) throw new Error('MCP connection cancelled by user');
    let child: ChildProcess | undefined;
    try {
      const spawned = spawn(command, commandArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
      });
      child = spawned;

      (spawned as unknown as { _jsonBuffer?: string })._jsonBuffer = '';

      // spawn reports ENOENT/EACCES asynchronously on 'error'. Without this
      // listener the failure is unhandled and the pending initialize request
      // waits out its timeout instead of failing fast.
      const spawnError = new Promise<never>((_, reject) => {
        spawned.once('error', (err) => reject(err));
      });
      spawnError.catch(() => {
        // observed by the race below; keeps Node from reporting it as unhandled
      });

      const conn: McpConnection = {
        process: child,
        tools: [],
        nextId: 0,
        pending: new Map(),
        reconnectAttempts: attempt,
        command,
        args: commandArgs,
      };

      drainBuffer(conn);
      child.stderr?.on('data', () => {});

      child.on('exit', (code) => {
        for (const [, { reject, timeout }] of conn.pending) {
          clearTimeout(timeout);
          reject(new Error(`MCP server ${serverName} exited with code ${code}`));
        }
        conn.pending.clear();
        if (connections.get(serverName) === conn) {
          connections.delete(serverName);
          statuses.set(serverName, { name: serverName, status: 'failed', error: `server exited with code ${code}` });
        }
      });

      await Promise.race([
        sendRequest(conn, {
          jsonrpc: '2.0',
          id: nextRequestId(conn),
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'signhify', version: '0.1.0' },
          },
        }, signal),
        spawnError,
      ]);
      child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

      const toolsResponse = await sendRequest(conn, {
        jsonrpc: '2.0',
        id: nextRequestId(conn),
        method: 'tools/list',
        params: {},
      }, signal);

      const tools = (toolsResponse as { result?: { tools?: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> } }).result?.tools ?? [];
      conn.tools = tools;

      connections.set(serverName, conn);

      return conn;
    } catch (error) {
      child?.kill();
      if (signal?.aborted) throw error;
      if (attempt === maxReconnectAttempts - 1) {
        throw new Error(`Failed to connect to MCP server ${serverName} after ${maxReconnectAttempts} attempts: ${error instanceof Error ? error.message : String(error)}`);
      }

      const backoffMs = Math.min(1000 * Math.pow(2, attempt), 10000);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  throw new Error(`Failed to connect to MCP server ${serverName}`);
}

export const mcpClientTool: ToolHandler = {
  name: 'mcp-client',
  get description() {
    const names = getKnownServerNames();
    return `List MCP server status, connect to configured servers, and invoke tools. Configured server names: ${names.length ? names.join(', ') : '(none; configure one in .signhify/config.json)'}. Connecting, invoking, or disconnecting requires approval.`;
  },
  requiresConsent: (args) => ['connect', 'invoke', 'disconnect'].includes(String(args.action)),
  async preview(args) {
    return previewMcpAction(args);
  },
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list-servers', 'list-presets', 'connect', 'list-tools', 'list-resources', 'list-prompts', 'invoke', 'disconnect'], description: 'MCP action' },
      serverName: { type: 'string', description: 'Name of the MCP server' },
      command: { type: 'string', description: 'Command to start the MCP server (for connect)' },
      args: { type: 'array', items: { type: 'string' }, description: 'Arguments for the command' },
      toolName: { type: 'string', description: 'Tool name to invoke' },
      arguments: { type: 'object', description: 'Arguments to pass to the tool' },
    },
    required: ['action'],
  },

  async execute(args, context) {
    const action = String(args.action ?? '');
    const serverName = String(args.serverName ?? '');
    const needsApproval = ['connect', 'invoke', 'disconnect'].includes(action);

    if (context.autoMode && needsApproval) {
      return JSON.stringify({ error: 'MCP process and tool execution require interactive approval and are disabled in --auto mode.' });
    }

    try {
      if (needsApproval && !serverName) return JSON.stringify({ error: 'MCP server name is required for this action.' });
      const conn = connections.get(serverName);
      if (action === 'connect' && conn) return JSON.stringify({ error: `Already connected to ${serverName}. Disconnect first.` });
      if (action === 'disconnect' && !conn) return JSON.stringify({ error: `Not connected to ${serverName}` });
      if (action === 'invoke') {
        if (!conn) return JSON.stringify({ error: `Not connected to ${serverName}. Use the "connect" action first.` });
        if (typeof args.toolName !== 'string' || !conn.tools.some((tool) => tool.name === args.toolName)) {
          return JSON.stringify({ error: `Unknown MCP tool for ${serverName}: ${String(args.toolName ?? '')}` });
        }
      }

      let consentGranted = context.consentGranted === true;
      if (needsApproval && !consentGranted) {
        if (!context.confirm) return JSON.stringify({ error: 'MCP action denied: explicit approval callback required.' });
        const preview = previewMcpAction(args);
        consentGranted = await context.confirm(preview);
        if (!consentGranted) return JSON.stringify({ error: 'MCP action denied by user consent.' });
      }

      switch (action) {
        case 'list-servers': {
          const servers = getKnownServerNames().map((name) => ({
            name,
            status: statuses.get(name)?.status ?? (connections.has(name) ? 'connected' : 'disabled'),
            toolCount: statuses.get(name)?.toolCount,
          }));
          return JSON.stringify({ servers });
        }

        case 'list-presets': {
          return JSON.stringify({
            presets: Object.entries(BUILT_IN_MCP_PRESETS).map(([key, val]) => ({
              preset: key,
              command: val.command,
              args: val.args,
              description: val.description,
            })),
          });
        }
      }

      if (!serverName) return JSON.stringify({ error: 'MCP server name is required for this action.' });

      switch (action) {
        case 'connect': {
          if (connections.has(serverName)) {
            return JSON.stringify({ error: `Already connected to ${serverName}. Disconnect first.` });
          }

          const { command, args: commandArgs } = resolveMcpCommand(serverName, args);

          const conn = await createConnection(serverName, command, commandArgs, context.signal);
          statuses.set(serverName, { name: serverName, status: 'connected', toolCount: conn.tools.length });

          return JSON.stringify({
            success: true,
            server: serverName,
            tools: conn.tools.map((t) => t.name),
            reconnectAttempts: conn.reconnectAttempts,
          });
        }

        case 'list-tools': {
          const conn = connections.get(serverName);
          if (!conn) return JSON.stringify({ error: `Not connected to ${serverName}` });
          return JSON.stringify({ tools: conn.tools });
        }

        case 'list-resources': {
          const conn = connections.get(serverName);
          if (!conn) return JSON.stringify({ error: `Not connected to ${serverName}` });
          return JSON.stringify({ resources: await requestMcpResources(conn, context.signal) });
        }

        case 'list-prompts': {
          const conn = connections.get(serverName);
          if (!conn) return JSON.stringify({ error: `Not connected to ${serverName}` });
          return JSON.stringify({ prompts: await requestMcpPrompts(conn, context.signal) });
        }

        case 'invoke': {
          const conn = connections.get(serverName);
          if (!conn) return JSON.stringify({ error: `Not connected to ${serverName}. Use the "connect" action first.` });

          const toolName = args.toolName as string;
          const toolArgs = (args.arguments as Record<string, unknown>) ?? {};

          if (!consentGranted) {
            return JSON.stringify({ error: 'MCP tool invocation denied by user' });
          }

          const result = await sendRequest(conn, {
            jsonrpc: '2.0',
            id: nextRequestId(conn),
            method: 'tools/call',
            params: { name: toolName, arguments: toolArgs },
          }, context.signal);

          return JSON.stringify(result);
        }

        case 'disconnect': {
          const conn = connections.get(serverName);
          if (!conn) return JSON.stringify({ error: `Not connected to ${serverName}` });
          for (const [, pending] of conn.pending) {
            clearTimeout(pending.timeout);
            pending.reject(new Error(`MCP server ${serverName} disconnected`));
          }
          conn.pending.clear();
          connections.delete(serverName);
          statuses.set(serverName, { name: serverName, status: 'disabled' });
          conn.process.kill('SIGTERM');
          return JSON.stringify({ success: true, disconnected: serverName });
        }

        default:
          return JSON.stringify({ error: `Unknown MCP action: ${action}` });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (action === 'connect') statuses.set(serverName, { name: serverName, status: 'failed', error: message });
      return JSON.stringify({ error: `MCP error: ${message}` });
    }
  },
};

function nextRequestId(conn: McpConnection): number {
  return ++conn.nextId;
}

async function sendRequest(
  conn: McpConnection,
  request: Record<string, unknown>,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  const id = typeof request.id === 'number' ? request.id : Number(request.id);

  return new Promise((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | undefined = undefined;
    let sent = false;
    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
    };
    const cancel = (message: string) => {
      if (!conn.pending.delete(id)) return;
      cleanup();
      if (sent && request.method !== 'initialize') {
        const input = conn.process.stdin;
        if (input?.writable) {
          try {
            input.write(`${JSON.stringify({
              jsonrpc: '2.0',
              method: 'notifications/cancelled',
              params: { requestId: id, reason: message },
            })}\n`);
          } catch {
            // The connection may have closed while cancellation was sent.
          }
        }
      }
      reject(new Error(message));
    };
    const onAbort = () => cancel('MCP request cancelled by user');
    timeout = setTimeout(() => cancel(`MCP request ${id} timed out`), 60_000);

    conn.pending.set(id, {
      resolve: (value: unknown) => { cleanup(); resolve(value as Record<string, unknown>); },
      reject: (reason: Error) => { cleanup(); reject(reason); },
      timeout,
      cleanup,
    });

    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }

    try {
      if (!conn.process.stdin?.writable) throw new Error('MCP server input stream is closed');
      conn.process.stdin.write(`${JSON.stringify(request)}\n`);
      sent = true;
    } catch (error) {
      const pending = conn.pending.get(id);
      if (pending) {
        conn.pending.delete(id);
        pending.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  });
}

export async function listMcpResources(serverName: string): Promise<McpResource[]> {
  const conn = connections.get(serverName);
  if (!conn) return [];
  return requestMcpResources(conn);
}

export async function listMcpPrompts(serverName: string): Promise<McpPrompt[]> {
  const conn = connections.get(serverName);
  if (!conn) return [];
  return requestMcpPrompts(conn);
}

async function requestMcpResources(conn: McpConnection, signal?: AbortSignal): Promise<McpResource[]> {
  try {
    const response = await sendRequest(conn, {
      jsonrpc: '2.0',
      id: nextRequestId(conn),
      method: 'resources/list',
      params: {},
    }, signal);
    return (response as { result?: { resources?: McpResource[] } }).result?.resources ?? [];
  } catch (error) {
    if (signal?.aborted) throw error;
    return [];
  }
}

async function requestMcpPrompts(conn: McpConnection, signal?: AbortSignal): Promise<McpPrompt[]> {
  try {
    const response = await sendRequest(conn, {
      jsonrpc: '2.0',
      id: nextRequestId(conn),
      method: 'prompts/list',
      params: {},
    }, signal);
    return (response as { result?: { prompts?: McpPrompt[] } }).result?.prompts ?? [];
  } catch (error) {
    if (signal?.aborted) throw error;
    return [];
  }
}

export async function disconnectAllMcpServers(): Promise<void> {
  for (const [name, conn] of connections) {
    for (const [, pending] of conn.pending) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('MCP client is shutting down'));
    }
    conn.pending.clear();
    connections.delete(name);
    statuses.set(name, { name, status: 'disabled' });
    conn.process.kill();
  }
}

export type McpStatus = 'connected' | 'failed' | 'disabled';

export interface McpServerStatus {
  name: string;
  status: McpStatus;
  toolCount?: number;
  error?: string;
}

// Tracked separately from `connections` so a failed server keeps its reason
// instead of vanishing into an empty list.
const statuses = new Map<string, McpServerStatus>();

export function getMcpStatuses(): McpServerStatus[] {
  return Array.from(statuses.values());
}

/** Connect servers only after the caller approves the exact command. */
export async function connectMcpServers(
  servers: Array<{ name: string; command?: string; args?: string[] }>,
  workingDirectory: string,
  confirm?: (message: string) => Promise<boolean>
): Promise<McpServerStatus[]> {
  for (const server of servers) {
    const current = connections.get(server.name);
    if (current) {
      statuses.set(server.name, { name: server.name, status: 'connected', toolCount: current.tools.length });
      continue;
    }
    if (!server.command) {
      statuses.set(server.name, {
        name: server.name,
        status: 'failed',
        error: 'no command configured',
      });
      continue;
    }

    const commandArgs = server.args ?? [];
    if (!confirm || !(await confirm(`Connect to MCP server ${server.name}\nCommand: ${server.command} ${JSON.stringify(commandArgs)}\nEnvironment: inherits Signhify's process environment.`))) {
      statuses.set(server.name, {
        name: server.name,
        status: 'disabled',
        error: 'connection requires explicit user approval',
      });
      continue;
    }

    try {
      // createConnection registers the connection itself on success.
      const conn = await createConnection(server.name, server.command, commandArgs);
      statuses.set(server.name, {
        name: server.name,
        status: 'connected',
        toolCount: conn.tools.length,
      });
    } catch (error) {
      statuses.set(server.name, {
        name: server.name,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  void workingDirectory; // shortcut: no per-project cwd isolation, add it when MCP configs support a working directory.
  return getMcpStatuses();
}

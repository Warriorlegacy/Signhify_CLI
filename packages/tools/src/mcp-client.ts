import { ToolHandler } from './tool-handler.js';
import { spawn, ChildProcess } from 'node:child_process';
import * as readline from 'node:readline';

async function promptConsent(toolName: string, args: Record<string, unknown>, autoMode?: boolean): Promise<boolean> {
  if (autoMode) return true;

  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const argsPreview = Object.keys(args).length > 0 ? JSON.stringify(args, null, 2) : '(no arguments)';

  return new Promise((resolve) => {
    rl.question(
      `\nMCP tool "${toolName}" wants to run:\n${argsPreview}\n\nAllow? (y/N) `,
      (answer) => {
        rl.close();
        resolve(answer.trim().toLowerCase() === 'y');
      }
    );
  });
}

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

interface McpConnection {
  process: ChildProcess;
  tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
  resources: McpResource[];
  prompts: McpPrompt[];
  nextId: number;
  pending: Map<number, { resolve: (value: unknown) => void; reject: (reason: Error) => void; timeout: ReturnType<typeof setTimeout> }>;
  reconnectAttempts: number;
  command: string;
  args: string[];
}

const connections = new Map<string, McpConnection>();

function readJsonLines(buffer: string): Array<Record<string, unknown>> {
  const results: Array<Record<string, unknown>> = [];
  const lines = buffer.split('\n');
  let carry = '';

  for (const line of lines) {
    const candidate = carry + line;
    const trimmed = candidate.trim();
    if (!trimmed) {
      carry = '';
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      results.push(parsed);
      carry = '';
    } catch {
      carry = candidate;
    }
  }

  return results;
}

function drainBuffer(conn: McpConnection): void {
  const { process } = conn;
  if (!process.stdout) return;

  const onData = (data: Buffer) => {
    const text = data.toString();
    const messages = (process as unknown as { _jsonBuffer?: string })._jsonBuffer ?? '';
    const updated = messages + text;
    (process as unknown as { _jsonBuffer?: string })._jsonBuffer = updated;

    const entries = readJsonLines((process as unknown as { _jsonBuffer: string })._jsonBuffer!);
    (process as unknown as { _jsonBuffer?: string })._jsonBuffer = '';

    for (const entry of entries) {
      const id = typeof entry.id === 'number' ? entry.id : Number(entry.id);
      if (id && conn.pending.has(id)) {
        clearTimeout(conn.pending.get(id)!.timeout);
        const { resolve, reject } = conn.pending.get(id)!;
        conn.pending.delete(id);
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
  maxReconnectAttempts = 3
): Promise<McpConnection> {
  for (let attempt = 0; attempt < maxReconnectAttempts; attempt++) {
    try {
      const child = spawn(command, commandArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
      });

      (child as unknown as { _jsonBuffer?: string })._jsonBuffer = '';

      const conn: McpConnection = {
        process: child,
        tools: [],
        resources: [],
        prompts: [],
        nextId: 0,
        pending: new Map(),
        reconnectAttempts: attempt,
        command,
        args: commandArgs,
      };

      drainBuffer(conn);

      child.on('exit', (code) => {
        for (const [, { reject, timeout }] of conn.pending) {
          clearTimeout(timeout);
          reject(new Error(`MCP server ${serverName} exited with code ${code}`));
        }
        conn.pending.clear();
        connections.delete(serverName);
      });

      const initResponse = await sendRequest(conn, {
        jsonrpc: '2.0',
        id: nextRequestId(conn),
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'signhify', version: '0.1.0' },
        },
      });

      const toolsResponse = await sendRequest(conn, {
        jsonrpc: '2.0',
        id: nextRequestId(conn),
        method: 'tools/list',
        params: {},
      });

      const tools = (toolsResponse as { result?: { tools?: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> } }).result?.tools ?? [];
      conn.tools = tools;

      // Fetch resources if the server supports them
      try {
        const resourcesResponse = await sendRequest(conn, {
          jsonrpc: '2.0',
          id: nextRequestId(conn),
          method: 'resources/list',
          params: {},
        });
        const resources = (resourcesResponse as { result?: { resources?: McpResource[] } }).result?.resources ?? [];
        conn.resources = resources;
      } catch {
        // Server may not support resources — that's fine
      }

      // Fetch prompts if the server supports them
      try {
        const promptsResponse = await sendRequest(conn, {
          jsonrpc: '2.0',
          id: nextRequestId(conn),
          method: 'prompts/list',
          params: {},
        });
        const prompts = (promptsResponse as { result?: { prompts?: McpPrompt[] } }).result?.prompts ?? [];
        conn.prompts = prompts;
      } catch {
        // Server may not support prompts — that's fine
      }

      connections.set(serverName, conn);

      return conn;
    } catch (error) {
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
  description: 'Connect to MCP servers and invoke their tools',
  requiresConsent: true,
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['connect', 'list-tools', 'list-resources', 'list-prompts', 'invoke', 'disconnect'], description: 'MCP action' },
      serverName: { type: 'string', description: 'Name of the MCP server' },
      command: { type: 'string', description: 'Command to start the MCP server (for connect)' },
      args: { type: 'array', items: { type: 'string' }, description: 'Arguments for the command' },
      toolName: { type: 'string', description: 'Tool name to invoke' },
      arguments: { type: 'object', description: 'Arguments to pass to the tool' },
    },
    required: ['action', 'serverName'],
  },

  async execute(args, context) {
    const action = args.action as string;
    const serverName = args.serverName as string;

    try {
      switch (action) {
        case 'connect': {
          if (connections.has(serverName)) {
            return JSON.stringify({ error: `Already connected to ${serverName}. Disconnect first.` });
          }

          const command = args.command as string;
          const commandArgs = (args.args as string[]) ?? [];

          const conn = await createConnection(serverName, command, commandArgs);

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
          return JSON.stringify({ resources: conn.resources });
        }

        case 'list-prompts': {
          const conn = connections.get(serverName);
          if (!conn) return JSON.stringify({ error: `Not connected to ${serverName}` });
          return JSON.stringify({ prompts: conn.prompts });
        }

        case 'invoke': {
          const conn = connections.get(serverName);
          if (!conn) return JSON.stringify({ error: `Not connected to ${serverName}. Use the "connect" action first.` });

          const toolName = args.toolName as string;
          const toolArgs = (args.arguments as Record<string, unknown>) ?? {};

          const allowed = await promptConsent(toolName, toolArgs, context.autoMode);
          if (!allowed) {
            return JSON.stringify({ error: 'MCP tool invocation denied by user' });
          }

          const result = await sendRequest(conn, {
            jsonrpc: '2.0',
            id: nextRequestId(conn),
            method: 'tools/call',
            params: { name: toolName, arguments: toolArgs },
          });

          return JSON.stringify(result);
        }

        case 'disconnect': {
          const conn = connections.get(serverName);
          if (!conn) return JSON.stringify({ error: `Not connected to ${serverName}` });
          conn.process.kill('SIGTERM');
          connections.delete(serverName);
          return JSON.stringify({ success: true, disconnected: serverName });
        }

        default:
          return JSON.stringify({ error: `Unknown MCP action: ${action}` });
      }
    } catch (error) {
      return JSON.stringify({ error: `MCP error: ${error instanceof Error ? error.message : String(error)}` });
    }
  },
};

function nextRequestId(conn: McpConnection): number {
  return ++conn.nextId;
}

async function sendRequest(
  conn: McpConnection,
  request: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const id = typeof request.id === 'number' ? request.id : Number(request.id);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      conn.pending.delete(id);
      reject(new Error(`MCP request ${id} timed out`));
    }, 60_000);

    conn.pending.set(id, { resolve: (value: unknown) => resolve(value as Record<string, unknown>), reject, timeout });

    const payload = JSON.stringify(request) + '\n';
    conn.process.stdin?.write(payload);
  });
}

export async function listMcpResources(serverName: string): Promise<McpResource[]> {
  const conn = connections.get(serverName);
  if (!conn) return [];
  return conn.resources;
}

export async function listMcpPrompts(serverName: string): Promise<McpPrompt[]> {
  const conn = connections.get(serverName);
  if (!conn) return [];
  return conn.prompts;
}

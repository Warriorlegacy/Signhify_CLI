import { runNonInteractive } from './non-interactive.js';
import { loadConfig } from './config.js';

type RpcId = string | number;
type JsonObject = Record<string, unknown>;

interface ActiveRun {
  id: RpcId;
  controller: AbortController;
  promise: Promise<void>;
}

interface PendingConfirmation {
  finish(approved: boolean): void;
}

const MAX_LINE_LENGTH = 1024 * 1024;
const CONFIRMATION_TIMEOUT_MS = 120_000;
const RUN_MODES = new Set(['build', 'plan', 'debug', 'compose']);

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRpcId(value: unknown): value is RpcId {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}

export async function runStdioServer(): Promise<void> {
  let inputEnded = false;
  let outputClosed = false;
  let buffer = '';
  let nextConfirmationId = 0;
  let activeRun: ActiveRun | undefined;
  let shutdownRequested = false;
  let finishInput!: () => void;
  const pendingConfirmations = new Map<RpcId, PendingConfirmation>();

  const write = (message: JsonObject) => {
    if (outputClosed) return;
    try {
      process.stdout.write(`${JSON.stringify(message)}\n`);
    } catch {
      outputClosed = true;
      activeRun?.controller.abort();
    }
  };

  const response = (id: RpcId, result: unknown) =>
    write({ jsonrpc: '2.0', id, result });

  const errorResponse = (id: RpcId | null, code: number, message: string) =>
    write({ jsonrpc: '2.0', id, error: { code, message } });

  const notify = (method: string, params: JsonObject) =>
    write({ jsonrpc: '2.0', method, params });

  const confirm = (message: string, signal: AbortSignal): Promise<boolean> => {
    const id = `signhify-confirm-${++nextConfirmationId}`;

    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined = undefined;
      const finish = (approved: boolean) => {
        if (timer) clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        pendingConfirmations.delete(id);
        resolve(approved);
      };
      const onAbort = () => finish(false);

      pendingConfirmations.set(id, { finish });
      if (signal.aborted || inputEnded || outputClosed) {
        finish(false);
        return;
      }

      signal.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => finish(false), CONFIRMATION_TIMEOUT_MS);
      notify('signhify/confirm', { message, timeoutMs: CONFIRMATION_TIMEOUT_MS, id });
    });
  };

  const startRun = (id: RpcId, params: JsonObject) => {
    if (!isObject(params) || typeof params.task !== 'string' || !params.task.trim() || params.task.length > 32_000) {
      errorResponse(id, -32602, 'params.task must be a non-empty string up to 32000 characters');
      return;
    }
    if (params.auto !== undefined && params.auto !== false) {
      errorResponse(id, -32602, 'The IDE host cannot enable auto mode; approvals stay explicit');
      return;
    }
    const mode = params.mode === undefined ? 'build' : params.mode;
    if (typeof mode !== 'string' || !RUN_MODES.has(mode)) {
      errorResponse(id, -32602, 'params.mode must be build, plan, debug, or compose');
      return;
    }
    if (params.resume !== undefined && (typeof params.resume !== 'string' || params.resume.length > 256)) {
      errorResponse(id, -32602, 'params.resume must be a session id up to 256 characters');
      return;
    }
    if (!params.resume && params.resume !== undefined) {
      errorResponse(id, -32602, 'params.resume cannot be empty');
      return;
    }
    if (activeRun) {
      errorResponse(id, -32002, 'A Signhify session is already running');
      return;
    }

    const controller = new AbortController();
    const state: ActiveRun = { id, controller, promise: Promise.resolve() };
    activeRun = state;
    state.promise = (async () => {
      try {
        const config = await loadConfig();
        const result = await runNonInteractive(params.task as string, config, {
          auto: false,
          output: 'quiet',
          mode,
          resume: params.resume as string | undefined,
          signal: controller.signal,
          confirm: (message) => confirm(message, controller.signal),
          onStream: (chunk) => notify('signhify/event', { runId: id, type: 'stream', chunk }),
          onToolCall: (call) => notify('signhify/event', { runId: id, type: 'tool-call', call }),
          onToolResult: (toolCallId, result, isError) =>
            notify('signhify/event', { runId: id, type: 'tool-result', toolCallId, result, isError: isError ?? false }),
        });
        response(id, result as unknown as JsonObject);
      } catch (error) {
        errorResponse(id, -32000, error instanceof Error ? error.message : String(error));
      } finally {
        if (activeRun === state) activeRun = undefined;
      }
    })();
  };

  const handleResponse = (message: JsonObject) => {
    if (!isRpcId(message.id)) return;
    const pending = pendingConfirmations.get(message.id);
    if (!pending) return;
    const result = isObject(message.result) ? message.result : undefined;
    pending.finish(result?.approved === true);
  };

  const dispatch = (message: unknown) => {
    if (!isObject(message)) {
      errorResponse(null, -32600, 'Invalid JSON-RPC message');
      return;
    }

    if (message.method === undefined && ('result' in message || 'error' in message)) {
      handleResponse(message);
      return;
    }

    const hasId = Object.prototype.hasOwnProperty.call(message, 'id');
    const id = isRpcId(message.id) ? message.id : undefined;
    if (message.jsonrpc !== '2.0' || typeof message.method !== 'string' || (hasId && id === undefined)) {
      if (hasId) errorResponse(null, -32600, 'Invalid JSON-RPC request');
      return;
    }
    const params = message.params === undefined ? {} : message.params;
    if (!isObject(params)) {
      if (hasId) errorResponse(id!, -32602, 'params must be a JSON object');
      return;
    }

    if (message.method === 'initialize') {
      response(id!, {
        protocolVersion: '2026-10-29',
        serverInfo: { name: 'signhify-cli', version: '0.5.0' },
        capabilities: { sessions: true, streaming: true, cancellation: true, approvals: true },
      });
      return;
    }
    if (message.method === 'initialized') return;
    if (message.method === 'signhify/run') {
      if (!hasId) return;
      if (shutdownRequested) {
        errorResponse(id!, -32000, 'The Signhify session host is shutting down');
        return;
      }
      startRun(id!, params);
      return;
    }
    if (message.method === '$/cancelRequest') {
      if (activeRun && params.id === activeRun.id) activeRun.controller.abort();
      return;
    }
    if (message.method === 'signhify/cancel') {
      const cancelled = !!activeRun && (params.runId === undefined || params.runId === activeRun.id);
      if (cancelled) activeRun!.controller.abort();
      if (hasId) response(id!, { cancelled });
      return;
    }
    if (message.method === 'shutdown') {
      if (activeRun) {
        if (hasId) errorResponse(id!, -32002, 'Cancel the active session before shutdown');
        return;
      }
      shutdownRequested = true;
      if (hasId) response(id!, null);
      return;
    }
    if (message.method === 'exit') {
      if (!shutdownRequested) process.exitCode = 1;
      activeRun?.controller.abort();
      finishInput();
      return;
    }
    if (hasId) errorResponse(id!, -32601, `Method not found: ${message.method}`);
  };

  const done = new Promise<void>((resolve) => {
    let finished = false;
    finishInput = () => {
      if (finished) return;
      finished = true;
      inputEnded = true;
      process.stdin.pause();
      resolve();
    };
  });

  process.stdout.on('error', () => {
    outputClosed = true;
    activeRun?.controller.abort();
  });
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    if (inputEnded) return;
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/, '');
      buffer = buffer.slice(newline + 1);
      if (line.length > MAX_LINE_LENGTH) {
        errorResponse(null, -32700, 'JSON-RPC line exceeds the 1 MiB limit');
        finishInput();
        return;
      }
      if (line.trim()) {
        try {
          dispatch(JSON.parse(line));
        } catch {
          errorResponse(null, -32700, 'Parse error');
        }
      }
      newline = buffer.indexOf('\n');
    }
    if (buffer.length > MAX_LINE_LENGTH) {
      errorResponse(null, -32700, 'JSON-RPC line exceeds the 1 MiB limit');
      finishInput();
    }
  });
  process.stdin.on('end', finishInput);
  process.stdin.on('error', (error) => {
    console.error(`[stdio] input failed: ${error.message}`);
    finishInput();
  });

  await done;
  activeRun?.controller.abort();
  for (const pending of [...pendingConfirmations.values()]) pending.finish(false);
  await activeRun?.promise;
}

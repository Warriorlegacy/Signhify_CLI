import { ToolHandler } from './tool-handler.js';
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { AbortError } from './errors.js';
import { killProcessTree } from './process-utils.js';

export { AbortError };
export { killProcessTree };

function isWithinDirectory(filePath: string, dir: string): boolean {
  const resolved = path.resolve(dir, filePath);
  const resolvedDir = path.resolve(dir);
  return resolved.startsWith(resolvedDir + path.sep) || resolved === resolvedDir;
}

// Bash token-efficient output pipeline, ported from MiMo-Code
// (packages/cli/src/tool/bash_token_efficient_pipeline.ts at HEAD 3e92e0d):
// ANSI strip → carriage-return progress fold → secret redaction →
// long-line elision → head+tail-preserving cap.
const ANSI_RE =
  // eslint-disable-next-line no-control-regex -- matching escape bytes IS the job; ANSI_RE strips exactly those bytes
  /\x1b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])|\x07/g;

// Unambiguous token shapes only — redaction never costs anything, so formats
// with reliable look-alikes are masked; everything else is passed through to
// avoid hiding real output.
const SECRET_REDACTIONS: Array<{ re: RegExp }> = [
  { re: /\bsk-[A-Za-z0-9_-]{16,}\b/g }, // sk-... API keys
  { re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g }, // classic GitHub tokens
  { re: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g }, // fine-grained GitHub PATs
  { re: /\bAKIA[0-9A-Z]{16}\b/g }, // AWS access key IDs
  { re: /\bxox[bpsra]-[A-Za-z0-9-]{10,}\b/g }, // Slack tokens
];

const MAX_LINE_CHARS = 2_000;
const MAX_BUFFER = 10 * 1024 * 1024; // 10MB

/** Exported for tests. */
export function condenseShellOutput(output: string, maxChars = 50_000): string {
  // 1. ANSI escapes (color/OSC sequences leaked by tools that ignore FORCE_COLOR).
  let text = output.replace(ANSI_RE, '');

  // 2. Fold carriage-return progress lines down to their final state.
  if (text.includes('\r')) {
    text = text
      .split('\n')
      .map((line) => {
        const last = line.lastIndexOf('\r');
        return last === -1 ? line : line.slice(last + 1);
      })
      .join('\n');
  }

  // 3. Redact whole-secrets; keep the surrounding text untouched.
  for (const { re } of SECRET_REDACTIONS) {
    text = text.replace(re, '<redacted>');
  }

  // 4. Elide pathological single lines instead of spending context on them.
  text = text
    .split('\n')
    .map((line) =>
      line.length > MAX_LINE_CHARS
        ? `${line.slice(0, MAX_LINE_CHARS)}… [line elided, ${line.length - MAX_LINE_CHARS} more chars]`
        : line,
    )
    .join('\n');

  // 5. Cap with head+tail preserved; the model can re-run a narrower command.
  if (text.length > maxChars) {
    const half = Math.floor(maxChars * 0.4);
    const omitted = text.length - half * 2;
    return `${text.slice(0, half)}\n[${omitted.toLocaleString()} chars omitted — re-run with a narrower command for details]\n${text.slice(text.length - half)}`;
  }
  return text;
}

export const shellExecTool: ToolHandler = {
  name: 'shell-exec',
  description: 'Execute a shell command in the working directory',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command to execute' },
      cwd: { type: 'string', description: 'Working directory (defaults to project directory)' },
      timeoutMs: { type: 'number', description: 'Timeout in milliseconds (default 120000)' },
    },
    required: ['command'],
  },

  async execute(args, context) {
    const command = args.command as string;
    const cwd = (args.cwd as string) ?? context.projectDir ?? context.workingDirectory;
    const timeoutMs = (args.timeoutMs as number) ?? 120_000;

    if (!fs.existsSync(cwd)) {
      return JSON.stringify({ exitCode: 1, stdout: '', stderr: `Working directory does not exist: ${cwd}` });
    }

    if (context.signal?.aborted) {
      throw new AbortError('Shell command execution was aborted');
    }

    return new Promise<string>((resolve, reject) => {
      let child: import('node:child_process').ChildProcess;
      try {
        child = spawn(command, {
          cwd,
          shell: true,
          detached: process.platform !== 'win32',
          env: { ...process.env, FORCE_COLOR: '0' },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (err) {
        if (context.signal?.aborted) {
          reject(new AbortError('Shell command execution was aborted'));
        } else {
          reject(err);
        }
        return;
      }

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let maxBufferExceeded = false;
      let timeoutTimer: NodeJS.Timeout | undefined;

      const terminateChild = () => {
        killProcessTree(child);
      };

      const cleanup = () => {
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
          timeoutTimer = undefined;
        }
        if (context.signal) {
          context.signal.removeEventListener('abort', onAbort);
        }
      };

      const onAbort = () => {
        terminateChild();
        cleanup();
        reject(new AbortError('Shell command execution was aborted'));
      };

      if (context.signal) {
        if (context.signal.aborted) {
          terminateChild();
          cleanup();
          reject(new AbortError('Shell command execution was aborted'));
          return;
        }
        context.signal.addEventListener('abort', onAbort, { once: true });
      }

      if (timeoutMs > 0 && Number.isFinite(timeoutMs)) {
        timeoutTimer = setTimeout(() => {
          timedOut = true;
          terminateChild();
        }, timeoutMs);
        timeoutTimer.unref();
      }

      child.stdout?.on('data', (chunk: Buffer) => {
        if (stdout.length + chunk.length > MAX_BUFFER) {
          maxBufferExceeded = true;
          terminateChild();
          return;
        }
        stdout += chunk.toString('utf-8');
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderr.length + chunk.length > MAX_BUFFER) {
          maxBufferExceeded = true;
          terminateChild();
          return;
        }
        stderr += chunk.toString('utf-8');
      });

      child.on('error', (err) => {
        cleanup();
        if (context.signal?.aborted) {
          reject(new AbortError('Shell command execution was aborted'));
          return;
        }
        resolve(
          JSON.stringify({
            exitCode: 1,
            stdout: condenseShellOutput(stdout),
            stderr: condenseShellOutput(err.message),
          })
        );
      });

      child.on('close', (code, signalName) => {
        cleanup();

        if (context.signal?.aborted) {
          reject(new AbortError('Shell command execution was aborted'));
          return;
        }

        if (timedOut) {
          resolve(
            JSON.stringify({
              exitCode: 124,
              stdout: condenseShellOutput(stdout),
              stderr: condenseShellOutput(`Command timed out after ${timeoutMs}ms`),
            })
          );
          return;
        }

        if (maxBufferExceeded) {
          resolve(
            JSON.stringify({
              exitCode: 1,
              stdout: condenseShellOutput(stdout),
              stderr: `Command stdout/stderr exceeded maxBuffer of ${MAX_BUFFER} bytes`,
            })
          );
          return;
        }

        const exitCode = typeof code === 'number' ? code : signalName ? 128 : 0;
        resolve(
          JSON.stringify({
            exitCode,
            stdout: condenseShellOutput(stdout),
            stderr: condenseShellOutput(stderr),
          })
        );
      });
    });
  },
};

export { isWithinDirectory };

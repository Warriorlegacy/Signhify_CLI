import { ToolHandler } from './tool-handler.js';
import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(execCb);

export const shellExecTool: ToolHandler = {
  name: 'shell-exec',
  description: 'Execute a shell command in the working directory',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command to execute' },
      timeoutMs: { type: 'number', description: 'Timeout in milliseconds (default 120000)' },
    },
    required: ['command'],
  },

  async execute(args, context) {
    const command = args.command as string;
    const timeoutMs = (args.timeoutMs as number) ?? 120_000;

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: context.workingDirectory,
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, FORCE_COLOR: '0' },
      });

      return JSON.stringify({
        exitCode: 0,
        stdout: stdout.slice(0, 50_000),
        stderr: stderr.slice(0, 50_000),
      });
    } catch (error: unknown) {
      const execError = error as { code?: number; stdout?: string; stderr?: string; message?: string };
      return JSON.stringify({
        exitCode: execError.code ?? 1,
        stdout: (execError.stdout ?? '').slice(0, 50_000),
        stderr: (execError.stderr ?? execError.message ?? '').slice(0, 50_000),
      });
    }
  },
};

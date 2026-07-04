import { ToolHandler } from './tool-handler.js';
import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import * as fs from 'node:fs';

const execAsync = promisify(execCb);

function isWithinDirectory(filePath: string, dir: string): boolean {
  const resolved = path.resolve(dir, filePath);
  const resolvedDir = path.resolve(dir);
  return resolved.startsWith(resolvedDir + path.sep) || resolved === resolvedDir;
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

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd,
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

export { isWithinDirectory };

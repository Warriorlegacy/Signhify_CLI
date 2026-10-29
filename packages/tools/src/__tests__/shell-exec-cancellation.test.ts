import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { shellExecTool, browserTool, AbortError, isProcessRunning } from '../index.js';

describe('shell-exec and browser cancellation', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'signhify-cancel-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('rejects immediately with AbortError if signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const markerFile = path.join(tmpDir, 'should-not-exist.txt');
    const scriptPath = path.join(tmpDir, 'marker-script.js');
    fs.writeFileSync(
      scriptPath,
      `const fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(markerFile)}, 'done');`,
    );

    const command = `"${process.execPath}" "${scriptPath}"`;

    await expect(
      shellExecTool.execute(
        { command, cwd: tmpDir },
        { workingDirectory: tmpDir, signal: controller.signal },
      ),
    ).rejects.toThrow(AbortError);

    expect(fs.existsSync(markerFile)).toBe(false);
  });

  it('promptly terminates running child process on abort and throws AbortError', async () => {
    const controller = new AbortController();
    const pidFile = path.join(tmpDir, 'running.pid');
    const scriptPath = path.join(tmpDir, 'long-runner.js');

    // Node process writes its PID then enters an interval loop
    fs.writeFileSync(
      scriptPath,
      `const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
setInterval(() => {}, 1000);
`,
    );

    const command = `"${process.execPath}" "${scriptPath}"`;

    const execPromise = shellExecTool.execute(
      { command, cwd: tmpDir },
      { workingDirectory: tmpDir, signal: controller.signal },
    );

    // Wait for the PID file to appear
    let pid: number | undefined;
    for (let i = 0; i < 50; i++) {
      if (fs.existsSync(pidFile)) {
        const content = fs.readFileSync(pidFile, 'utf8').trim();
        if (content) {
          pid = Number(content);
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 50));
    }

    expect(pid).toBeDefined();
    expect(isProcessRunning(pid!)).toBe(true);

    const startTime = Date.now();
    controller.abort();

    await expect(execPromise).rejects.toThrow(AbortError);
    const duration = Date.now() - startTime;
    // Abort and termination should be prompt (< 2000ms)
    expect(duration).toBeLessThan(2000);

    // Wait briefly and verify the child process is terminated
    let alive = true;
    for (let i = 0; i < 20; i++) {
      if (!isProcessRunning(pid!)) {
        alive = false;
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(alive).toBe(false);
  });

  it('kills entire process tree (parent and grandchild processes) on abort', async () => {
    const controller = new AbortController();
    const parentPidFile = path.join(tmpDir, 'parent.pid');
    const childPidFile = path.join(tmpDir, 'child.pid');
    const grandchildScriptPath = path.join(tmpDir, 'grandchild.js');
    const parentScriptPath = path.join(tmpDir, 'parent.js');

    // Grandchild script writes its PID and waits
    fs.writeFileSync(
      grandchildScriptPath,
      `const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(childPidFile)}, String(process.pid));
setInterval(() => {}, 1000);
`,
    );

    // Parent script spawns grandchild, writes its own PID, and waits
    fs.writeFileSync(
      parentScriptPath,
      `const { spawn } = require('node:child_process');
const fs = require('node:fs');
spawn(process.execPath, [${JSON.stringify(grandchildScriptPath)}], { stdio: 'ignore' });
fs.writeFileSync(${JSON.stringify(parentPidFile)}, String(process.pid));
setInterval(() => {}, 1000);
`,
    );

    const command = `"${process.execPath}" "${parentScriptPath}"`;

    const execPromise = shellExecTool.execute(
      { command, cwd: tmpDir },
      { workingDirectory: tmpDir, signal: controller.signal },
    );

    // Wait until both parent and child PIDs are recorded
    let parentPid: number | undefined;
    let childPid: number | undefined;
    for (let i = 0; i < 60; i++) {
      if (fs.existsSync(parentPidFile) && fs.existsSync(childPidFile)) {
        const pContent = fs.readFileSync(parentPidFile, 'utf8').trim();
        const cContent = fs.readFileSync(childPidFile, 'utf8').trim();
        if (pContent && cContent) {
          parentPid = Number(pContent);
          childPid = Number(cContent);
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 50));
    }

    expect(parentPid).toBeDefined();
    expect(childPid).toBeDefined();
    expect(isProcessRunning(parentPid!)).toBe(true);
    expect(isProcessRunning(childPid!)).toBe(true);

    controller.abort();

    await expect(execPromise).rejects.toThrow(AbortError);

    // Verify both parent and child processes are dead
    let parentAlive = true;
    let childAlive = true;
    for (let i = 0; i < 30; i++) {
      if (!isProcessRunning(parentPid!)) parentAlive = false;
      if (!isProcessRunning(childPid!)) childAlive = false;
      if (!parentAlive && !childAlive) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    expect(parentAlive).toBe(false);
    expect(childAlive).toBe(false);
  });

  it('completes normal non-aborted command successfully', async () => {
    const resultJson = await shellExecTool.execute(
      { command: `"${process.execPath}" -e "console.log(12345)"`, cwd: tmpDir },
      { workingDirectory: tmpDir },
    );
    const parsed = JSON.parse(resultJson);
    expect(parsed.exitCode).toBe(0);
    expect(parsed.stdout.trim()).toBe('12345');
  });

  it('browserTool rejects immediately with AbortError when signal is pre-aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      browserTool.execute(
        { action: 'navigate', url: 'https://example.com' },
        { workingDirectory: tmpDir, signal: controller.signal },
      ),
    ).rejects.toThrow(AbortError);
  });
});

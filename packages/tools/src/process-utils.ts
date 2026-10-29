import { spawnSync, type ChildProcess } from 'node:child_process';

/**
 * Checks whether a process with the specified PID is currently running.
 */
export function isProcessRunning(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Forcefully terminates a child process and all of its descendants (process tree).
 *
 * - On Windows: executes `taskkill /pid <pid> /T /F` to kill the entire process tree,
 *   with fallback to `child.kill('SIGTERM')`.
 * - On POSIX: sends `SIGTERM` to the process group (`-pid`) if group leader, falling
 *   back to `child.kill('SIGTERM')`. If the process has not terminated after 2s,
 *   escalates with `SIGKILL`.
 */
export function killProcessTree(target: ChildProcess | number): void {
  const pid = typeof target === 'number' ? target : target?.pid;
  const child = typeof target === 'number' ? undefined : target;

  if (!pid || pid <= 0 || (child && child.killed)) {
    return;
  }

  if (process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      // ignore
    }
    try {
      child?.kill('SIGTERM');
    } catch {
      // ignore
    }
  } else {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      try {
        if (child) {
          child.kill('SIGTERM');
        } else {
          process.kill(pid, 'SIGTERM');
        }
      } catch {
        // ignore
      }
    }

    const escalation = setTimeout(() => {
      try {
        if (isProcessRunning(pid)) {
          try {
            process.kill(-pid, 'SIGKILL');
          } catch {
            if (child) {
              child.kill('SIGKILL');
            } else {
              process.kill(pid, 'SIGKILL');
            }
          }
        }
      } catch {
        // ignore
      }
    }, 2000);
    escalation.unref();
  }
}

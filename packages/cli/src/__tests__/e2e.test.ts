import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

const CLI_PATH = path.resolve(import.meta.dirname, '../../dist/index.js');

describe('CLI E2E', () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'signhify-e2e-'));
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({
      name: 'test-project',
      version: '1.0.0',
      scripts: { test: 'echo "tests passed"' },
    }));

    // Ensure mock provider configuration in tmpDir for hermetic testing
    await fs.mkdir(path.join(tmpDir, '.signhify'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.signhify', 'config.json'),
      JSON.stringify({
        provider: {
          agent: { vendor: 'mock', model: 'mock-model' },
        },
      }, null, 2)
    );
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const execEnv = {
    ...process.env,
    SIGNHIFY_MOCK_PROVIDER: '1',
  };

  it('should show help with --help', () => {
    const output = execSync(`node "${CLI_PATH}" --help`, {
      cwd: tmpDir,
      encoding: 'utf-8',
      timeout: 30_000,
      env: execEnv,
    });
    expect(output).toContain('signhify');
    expect(output).toContain('run');
  });

  it('should show version with --version', () => {
    const output = execSync(`node "${CLI_PATH}" --version`, {
      cwd: tmpDir,
      encoding: 'utf-8',
      timeout: 30_000,
      env: execEnv,
    });
    expect(output).toMatch(/\d+\.\d+\.\d+/);
  });

  it('should run task in non-interactive mode with JSON output', () => {
    const output = execSync(
      `node "${CLI_PATH}" run "echo hello" --auto --output json`,
      {
        cwd: tmpDir,
        encoding: 'utf-8',
        timeout: 30_000,
        env: execEnv,
      }
    );
    const result = JSON.parse(output);
    expect(result).toHaveProperty('success', true);
    expect(result).toHaveProperty('task', 'echo hello');
    expect(result).toHaveProperty('auto', true);
  });
});

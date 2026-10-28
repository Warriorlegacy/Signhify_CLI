import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileIoTool } from '../file-io.js';

describe('fileIoTool', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'signhify-tools-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should write and read a file', async () => {
    const writeResult = await fileIoTool.execute(
      { action: 'write', path: 'test.txt', content: 'hello world' },
      { workingDirectory: tmpDir }
    );
    const writeParsed = JSON.parse(writeResult);
    expect(writeParsed.success).toBe(true);

    const readResult = await fileIoTool.execute(
      { action: 'read', path: 'test.txt' },
      { workingDirectory: tmpDir }
    );
    const readParsed = JSON.parse(readResult);
    expect(readParsed.content).toBe('hello world');
  });

  it('should list directory contents', async () => {
    await fs.writeFile(path.join(tmpDir, 'a.txt'), 'a');
    await fs.writeFile(path.join(tmpDir, 'b.txt'), 'b');
    await fs.mkdir(path.join(tmpDir, 'subdir'));

    const result = await fileIoTool.execute(
      { action: 'list', path: '.' },
      { workingDirectory: tmpDir }
    );
    const parsed = JSON.parse(result);
    expect(parsed.entries.length).toBe(3);
  });

  it('should prevent path traversal', async () => {
    const result = await fileIoTool.execute(
      { action: 'read', path: '../../../etc/passwd' },
      { workingDirectory: tmpDir }
    );
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain('Path traversal');
  });

  it('should report created:true and no diff for a new file', async () => {
    const result = JSON.parse(
      await fileIoTool.execute(
        { action: 'write', path: 'new.txt', content: 'line 1\nline 2' },
        { workingDirectory: tmpDir }
      )
    );
    expect(result.created).toBe(true);
    expect(result.diff).toBeUndefined();
  });

  it('should return a diff of what an overwrite replaces', async () => {
    await fs.writeFile(path.join(tmpDir, 'existing.ts'), 'const a = 1;\nconst b = 2;\n');

    const result = JSON.parse(
      await fileIoTool.execute(
        { action: 'write', path: 'existing.ts', content: 'const a = 1;\nconst b = 3;\nconst c = 4;\n' },
        { workingDirectory: tmpDir }
      )
    );

    expect(result.created).toBe(false);
    expect(result.diff).toContain('--- a/existing.ts');
    expect(result.diff).toContain('- const b = 2;');
    expect(result.diff).toContain('+ const b = 3;');
    expect(result.diff).toContain('+ const c = 4;');
    // Unchanged first line must not be reported as changed.
    expect(result.diff).not.toContain('- const a = 1;');
  });

  it('should still write the file after producing the diff', async () => {
    await fs.writeFile(path.join(tmpDir, 'f.txt'), 'old');
    await fileIoTool.execute({ action: 'write', path: 'f.txt', content: 'new' }, { workingDirectory: tmpDir });
    expect(await fs.readFile(path.join(tmpDir, 'f.txt'), 'utf-8')).toBe('new');
  });
});

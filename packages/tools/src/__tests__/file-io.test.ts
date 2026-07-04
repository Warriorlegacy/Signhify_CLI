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
});

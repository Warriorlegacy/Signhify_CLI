import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileIoTool, summariseDiff, generateDiffPreview, previewWrite } from '../file-io.js';

describe('fileIoTool', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'signhify-tools-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function approvedWrite(args: { action: 'write'; path: string; content: string }): Promise<string> {
    const context = { workingDirectory: tmpDir };
    const approvedPreview = await fileIoTool.preview!(args, context);
    return fileIoTool.execute(args, { ...context, consentGranted: true, approvedPreview });
  }

  it('should write and read a file', async () => {
    const writeResult = await approvedWrite({ action: 'write', path: 'test.txt', content: 'hello world' });
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
      await approvedWrite({ action: 'write', path: 'new.txt', content: 'line 1\nline 2' })
    );
    expect(result.created).toBe(true);
    expect(result.diff).toBeUndefined();
  });

  it('should return a diff of what an overwrite replaces with additions and deletions counts', async () => {
    await fs.writeFile(path.join(tmpDir, 'existing.ts'), 'const a = 1;\nconst b = 2;\n');

    const result = JSON.parse(
      await approvedWrite({ action: 'write', path: 'existing.ts', content: 'const a = 1;\nconst b = 3;\nconst c = 4;\n' })
    );

    expect(result.created).toBe(false);
    expect(result.diff).toContain('--- a/existing.ts');
    expect(result.diff).toContain('- const b = 2;');
    expect(result.diff).toContain('+ const b = 3;');
    expect(result.diff).toContain('+ const c = 4;');
    expect(result.additions).toBe(2);
    expect(result.deletions).toBe(1);
    // Unchanged first line must not be reported as changed.
    expect(result.diff).not.toContain('- const a = 1;');
  });

  it('writes the file after the approved preview remains current', async () => {
    await fs.writeFile(path.join(tmpDir, 'f.txt'), 'old');
    await approvedWrite({ action: 'write', path: 'f.txt', content: 'new' });
    expect(await fs.readFile(path.join(tmpDir, 'f.txt'), 'utf-8')).toBe('new');
  });

  it('generates a pre-write unified diff preview before disk mutation without modifying the file', async () => {
    const initialContent = 'line 1\nline 2\nline 3\n';
    await fs.writeFile(path.join(tmpDir, 'preview-target.txt'), initialContent);

    const preview = await fileIoTool.preview!(
      { action: 'write', path: 'preview-target.txt', content: 'line 1\nline 2 modified\nline 3\nline 4 added\n' },
      { workingDirectory: tmpDir }
    );

    // Target file on disk must NOT have changed during preview generation
    const onDisk = await fs.readFile(path.join(tmpDir, 'preview-target.txt'), 'utf-8');
    expect(onDisk).toBe(initialContent);

    // Preview header and unified diff checks
    expect(preview).toContain('Update preview-target.txt');
    expect(preview).toContain('--- a/preview-target.txt');
    expect(preview).toContain('+++ b/preview-target.txt');
    expect(preview).toContain('- line 2');
    expect(preview).toContain('+ line 2 modified');
    expect(preview).toContain('+ line 4 added');
  });

  it('generates diff preview with additions for new files before creation', async () => {
    const preview = await fileIoTool.preview!(
      { action: 'write', path: 'brand-new.txt', content: 'alpha\nbeta\n' },
      { workingDirectory: tmpDir }
    );

    expect(preview).toContain('Create brand-new.txt');
    expect(preview).toContain('--- a/brand-new.txt');
    expect(preview).toContain('+ alpha');
    expect(preview).toContain('+ beta');
  });

  it('refuses pre-write preview when change exceeds 40 lines threshold', async () => {
    await fs.writeFile(path.join(tmpDir, 'large.txt'), 'initial\n');
    const largeContent = Array.from({ length: 50 }, (_, i) => `new line ${i}`).join('\n');

    await expect(
      previewWrite({ path: 'large.txt', content: largeContent }, tmpDir)
    ).rejects.toThrow('Change is too large to review');
  });

  it('rejects write without explicit preview approval in interactive mode', async () => {
    await fs.writeFile(path.join(tmpDir, 'guarded.txt'), 'secret');
    const result = JSON.parse(
      await fileIoTool.execute(
        { action: 'write', path: 'guarded.txt', content: 'corrupted' },
        { workingDirectory: tmpDir, consentGranted: false }
      )
    );
    expect(result.error).toContain('explicit preview approval is required');
    expect(await fs.readFile(path.join(tmpDir, 'guarded.txt'), 'utf-8')).toBe('secret');
  });

  it('rejects write when file was mutated on disk after preview approval', async () => {
    await fs.writeFile(path.join(tmpDir, 'stale.txt'), 'v1');
    const approvedPreview = await fileIoTool.preview!(
      { action: 'write', path: 'stale.txt', content: 'v2' },
      { workingDirectory: tmpDir }
    );

    // Concurrently mutate the file before execution
    await fs.writeFile(path.join(tmpDir, 'stale.txt'), 'v1-tampered');

    const result = JSON.parse(
      await fileIoTool.execute(
        { action: 'write', path: 'stale.txt', content: 'v2' },
        { workingDirectory: tmpDir, consentGranted: true, approvedPreview }
      )
    );
    expect(result.error).toContain('File changed after approval');
  });
});

describe('summariseDiff & generateDiffPreview', () => {
  it('correctly reports additions only', () => {
    const before = 'line 1\nline 2';
    const after = 'line 1\nline 2\nline 3\nline 4';
    const diff = generateDiffPreview('test.txt', before, after);

    expect(diff.additions).toBe(2);
    expect(diff.deletions).toBe(0);
    expect(diff.text).toContain('@@ line 3: -0 +2 @@');
    expect(diff.text).toContain('+ line 3');
    expect(diff.text).toContain('+ line 4');
  });

  it('correctly reports deletions only', () => {
    const before = 'line 1\nline 2\nline 3';
    const after = 'line 1';
    const diff = summariseDiff('test.txt', before, after);

    expect(diff.additions).toBe(0);
    expect(diff.deletions).toBe(2);
    expect(diff.text).toContain('- line 2');
    expect(diff.text).toContain('- line 3');
  });

  it('reports (no change) when content matches, including CRLF normalization', () => {
    const before = 'hello\r\nworld\r\n';
    const after = 'hello\nworld\n';
    const diff = generateDiffPreview('windows.txt', before, after);

    expect(diff.text).toBe('(no change to windows.txt)');
    expect(diff.additions).toBe(0);
    expect(diff.deletions).toBe(0);
  });
});

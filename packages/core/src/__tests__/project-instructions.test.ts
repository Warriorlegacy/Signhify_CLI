import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadProjectInstructions } from '../project-instructions.js';

describe('loadProjectInstructions', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'signhify-inst-test-'));
    // Make it look like a git repo root
    await fs.mkdir(path.join(tempDir, '.git'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it('returns undefined when no AGENTS.md or CLAUDE.md exists', async () => {
    const result = await loadProjectInstructions(tempDir, 2000);
    expect(result).toBeUndefined();
  });

  it('loads AGENTS.md within root directory', async () => {
    await fs.writeFile(
      path.join(tempDir, 'AGENTS.md'),
      '# Test Instructions\nFollow strict TypeScript conventions.',
      'utf8',
    );
    const result = await loadProjectInstructions(tempDir, 2000);
    expect(result).toBeDefined();
    expect(result).toContain('## Project Instructions and Skills');
    expect(result).toContain('Follow strict TypeScript conventions.');
  });

  it('discovers project skills under .agents/skills/', async () => {
    const skillDir = path.join(tempDir, '.agents', 'skills', 'code-review');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: code-review\ndescription: Reviews code changes for safety\n---\nRule: check all inputs',
      'utf8',
    );
    const result = await loadProjectInstructions(tempDir, 2000);
    expect(result).toBeDefined();
    expect(result).toContain('code-review');
    expect(result).toContain('Reviews code changes for safety');
  });

  it('ignores ignoredDirectories such as node_modules', async () => {
    const nmDir = path.join(tempDir, 'node_modules', 'subpkg');
    await fs.mkdir(nmDir, { recursive: true });
    await fs.writeFile(path.join(nmDir, 'AGENTS.md'), '# Should be ignored', 'utf8');

    const result = await loadProjectInstructions(tempDir, 2000);
    expect(result).toBeUndefined();
  });
});

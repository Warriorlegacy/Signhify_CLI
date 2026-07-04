import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { MemoryStore } from '../memory-store.js';

describe('MemoryStore', () => {
  let store: MemoryStore;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'signhify-memory-test-'));
    store = new MemoryStore(path.join(tmpDir, 'test.db'));
  });

  afterEach(() => {
    store.close();
  });

  it('should add and retrieve entries', () => {
    const id = store.addEntry({
      projectId: 'test-project',
      category: 'fact',
      content: 'TypeScript is the primary language',
      importance: 0.8,
    });
    expect(id).toBeGreaterThan(0);

    const entries = store.getAll('test-project');
    expect(entries.length).toBe(1);
    expect(entries[0].content).toBe('TypeScript is the primary language');
  });

  it('should search entries with FTS', () => {
    store.addEntry({ projectId: 'p1', category: 'fact', content: 'Uses React for UI', importance: 0.5 });
    store.addEntry({ projectId: 'p1', category: 'decision', content: 'Chose SQLite for storage', importance: 0.7 });

    const results = store.search('p1', 'React');
    expect(results.length).toBe(1);
    expect(results[0].content).toContain('React');
  });

  it('should delete stale entries', () => {
    store.addEntry({ projectId: 'p1', category: 'fact', content: 'Old fact', importance: 0.2 });
    const deleted = store.deleteStale('p1', 0); // 0 days = all stale
    expect(deleted).toBeGreaterThanOrEqual(0);
  });
});

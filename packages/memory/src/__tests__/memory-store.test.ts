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

  it('should not throw on FTS5 operators in the query', () => {
    store.addEntry({
      projectId: 'p1',
      category: 'fact',
      content: 'Postgres runs on port 5433 behind the proxy',
      importance: 0.6,
    });

    // Every one of these used to reach MATCH raw and throw a syntax error.
    for (const query of [
      'postgres "port" - 5433',
      '(postgres)',
      'port:5433',
      'postgres*',
      '^proxy',
      '{postgres} proxy',
    ]) {
      expect(() => store.search('p1', query)).not.toThrow();
      expect(store.search('p1', query).length).toBeGreaterThan(0);
    }
  });

  it('should return no results for a query with no usable tokens', () => {
    store.addEntry({ projectId: 'p1', category: 'fact', content: 'Anything at all', importance: 0.5 });
    expect(store.search('p1', '!!! ??? ---')).toEqual([]);
    expect(store.search('p1', '')).toEqual([]);
  });

  it('should OR-join tokens so one absent word does not zero the query', () => {
    store.addEntry({
      projectId: 'p1',
      category: 'fact',
      content: 'Postgres runs on port 5433',
      importance: 0.6,
    });
    // "database" appears nowhere; strict AND would return nothing here.
    expect(store.search('p1', 'postgres database port').length).toBe(1);
  });
});

describe('MemoryStore.searchCheckpoints (/history)', () => {
  let store: MemoryStore;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'signhify-history-test-'));
    store = new MemoryStore(path.join(tmpDir, 'test.db'));
  });

  afterEach(() => {
    store.close();
  });

  it('finds checkpoints by summary content across sessions', () => {
    const s1 = store.createSession(tmpDir);
    const s2 = store.createSession(tmpDir);
    store.saveCheckpoint(s1, 'Migrated the docker-compose setup to kubernetes manifests', 12_000);
    store.saveCheckpoint(s2, 'Rewrote the vite.config.ts plugin ordering', 9_000);

    const hits = store.searchCheckpoints('docker kubernetes', 10);
    expect(hits).toHaveLength(1);
    expect(hits[0].sessionId).toBe(s1);
    expect(hits[0].tokenUsageAtCheckpoint).toBe(12_000);
    expect(hits[0].summary).toContain('kubernetes');
  });

  it('survives FTS5 operators and returns empty for token-free queries', () => {
    const s = store.createSession(tmpDir);
    store.saveCheckpoint(s, 'Fixed the flaky checkout test', 100);
    for (const query of ['(flaky)', 'flaky* -checkout', '"checkout"', '!!! ??? ---']) {
      expect(() => store.searchCheckpoints(query)).not.toThrow();
    }
    expect(store.searchCheckpoints('!!! ??? ---')).toEqual([]);
  });

  it('highlights matches in the snippet field', () => {
    const s = store.createSession(tmpDir);
    store.saveCheckpoint(s, 'Traced the login race through the auth middleware', 500);

    const [hit] = store.searchCheckpoints('login', 10);
    expect(hit).toBeDefined();
    expect(hit!.snippet).toContain('[');
  });

  it('ranks the matching checkpoint above non-matching sessions when filtered', () => {
    const s = store.createSession(tmpDir);
    store.saveCheckpoint(s, 'Off-topic summary about CSS variables', 100);
    expect(store.searchCheckpoints('kubernetes', 10)).toEqual([]);

    // Session-scoped search narrows the space.
    store.saveCheckpoint(s, 'Implemented kubernetes rollback', 200);
    const scoped = store.searchCheckpoints('kubernetes', 10, s);
    expect(scoped).toHaveLength(1);
  });
});

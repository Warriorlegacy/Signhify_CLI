import { describe, it, expect } from 'vitest';
import { MemoryStore } from '../memory-store.js';
import { CheckpointWriter } from '../checkpoint-writer.js';

describe('Session registry (T3.3): create -> list -> resume reads back the checkpoint', () => {
  it('registers a session, lists it, and resumes its checkpoint', async () => {
    const store = new MemoryStore(':memory:');
    const writer = new CheckpointWriter(store, '/tmp/test-sessions-project');

    // create
    const sessionId = store.createSession('/tmp/test-sessions-project');
    expect(store.getSession(sessionId)).not.toBeNull();

    // list
    const listed = store.listSessions(20);
    expect(listed.some(s => s.id === sessionId)).toBe(true);

    // a checkpoint written by that session is linked through the same id
    await writer.writeCheckpoint({
      sessionId,
      summary: 'WIP auth refactor',
      tokenUsage: 4096,
      decisions: ['Reuse the tasks table'],
      currentDiffs: [],
      openIssues: [],
    });

    // resume: the --resume read path (MemoryStore, not the single-session file)
    const resumed = store.getCheckpointBySession(sessionId);
    expect(resumed).not.toBeNull();
    expect(resumed!.summary).toBe('WIP auth refactor');
    expect(resumed!.tokenUsageAtCheckpoint).toBe(4096);

    // resuming an unknown session id reports "no checkpoint" without throwing
    expect(store.getCheckpointBySession('sess_missing')).toBeNull();

    await store.close();
  });

  it('createSession upserts: resuming the same id keeps one row', () => {
    const store = new MemoryStore(':memory:');
    const id = store.createSession('/a');
    store.createSession('/b', id); // same id, new cwd

    expect(store.listSessions()).toHaveLength(1);
    expect(store.getSession(id)?.cwd).toBe('/b');
    store.close();
  });

  describe('listSessions', () => {
    it('returns sessions with checkpoint counts and metadata', () => {
      const store = new MemoryStore(':memory:');
      const s1 = store.createSession('/proj1', 'sess_1', 'Session One');
      const s2 = store.createSession('/proj2', 'sess_2', 'Session Two');

      store.saveCheckpoint(s1, 'Checkpoint 1 for s1', 100);
      store.saveCheckpoint(s1, 'Checkpoint 2 for s1', 200);
      store.saveCheckpoint(s2, 'Checkpoint 1 for s2', 300);

      const sessions = store.listSessions(10);
      expect(sessions).toHaveLength(2);

      const foundS1 = sessions.find((s) => s.id === 'sess_1');
      expect(foundS1).toBeDefined();
      expect(foundS1?.title).toBe('Session One');
      expect(foundS1?.checkpointCount).toBe(2);
      expect(foundS1?.cwd).toBe('/proj1');
      expect(foundS1?.createdAt).toBeDefined();

      const foundS2 = sessions.find((s) => s.id === 'sess_2');
      expect(foundS2).toBeDefined();
      expect(foundS2?.title).toBe('Session Two');
      expect(foundS2?.checkpointCount).toBe(1);

      // Check limit
      const limited = store.listSessions(1);
      expect(limited).toHaveLength(1);

      store.close();
    });
  });

  describe('forkSession', () => {
    it('duplicates checkpoints and memory records under new branch ID', () => {
      const store = new MemoryStore(':memory:');
      const parentId = store.createSession('/workspace', 'sess_parent', 'Base Session');

      // Add checkpoints
      store.saveCheckpoint(parentId, 'Step 1: Scaffolding', 150);
      store.saveCheckpoint(parentId, 'Step 2: Database migration', 350);

      // Add memory records
      store.addEntry({
        projectId: parentId,
        category: 'decision',
        content: 'Use SQLite WAL mode',
        importance: 0.9,
      });
      store.addEntry({
        projectId: parentId,
        category: 'fact',
        content: 'Port 8080 is reserved',
        importance: 0.7,
      });

      // Fork session
      const forked = store.forkSession(parentId, 'sess_child', 'Experimental Branch');

      expect(forked.id).toBe('sess_child');
      expect(forked.parentId).toBe('sess_parent');
      expect(forked.title).toBe('Experimental Branch');
      expect(forked.checkpointCount).toBe(2);
      expect(forked.cwd).toBe('/workspace');

      // Check duplicated checkpoints
      const childCheckpoints = store.getAllCheckpointsBySession('sess_child');
      expect(childCheckpoints).toHaveLength(2);
      expect(childCheckpoints[0].summary).toBe('Step 1: Scaffolding');
      expect(childCheckpoints[0].tokenUsageAtCheckpoint).toBe(150);
      expect(childCheckpoints[1].summary).toBe('Step 2: Database migration');
      expect(childCheckpoints[1].tokenUsageAtCheckpoint).toBe(350);

      // Check latest checkpoint retrieval
      const latestCp = store.getCheckpointBySession('sess_child');
      expect(latestCp?.summary).toBe('Step 2: Database migration');

      // Check duplicated memory entries
      const childEntries = store.getAll('sess_child');
      expect(childEntries).toHaveLength(2);
      const decision = childEntries.find((e) => e.category === 'decision');
      expect(decision?.content).toBe('Use SQLite WAL mode');
      expect(decision?.importance).toBe(0.9);
      const fact = childEntries.find((e) => e.category === 'fact');
      expect(fact?.content).toBe('Port 8080 is reserved');

      // Add checkpoint to forked session and ensure parent is unaffected
      store.saveCheckpoint('sess_child', 'Step 3: Child unique step', 500);
      expect(store.getAllCheckpointsBySession('sess_child')).toHaveLength(3);
      expect(store.getAllCheckpointsBySession(parentId)).toHaveLength(2);

      store.close();
    });

    it('generates auto ID and default title when not provided', () => {
      const store = new MemoryStore(':memory:');
      const parentId = store.createSession('/workspace', 'sess_parent_2', 'Main Feature');
      store.saveCheckpoint(parentId, 'Initial commit', 100);

      const forked = store.forkSession(parentId);
      expect(forked.id).toMatch(/^sess_/);
      expect(forked.id).not.toBe(parentId);
      expect(forked.parentId).toBe(parentId);
      expect(forked.title).toBe('Fork of Main Feature');
      expect(forked.checkpointCount).toBe(1);

      store.close();
    });

    it('uses default fallback title when parent has no title', () => {
      const store = new MemoryStore(':memory:');
      const parentId = store.createSession('/workspace', 'sess_untitled');

      const forked = store.forkSession(parentId);
      expect(forked.title).toBe('Fork of sess_untitled');

      store.close();
    });

    it('throws error when source session does not exist', () => {
      const store = new MemoryStore(':memory:');
      expect(() => {
        store.forkSession('non_existent_session');
      }).toThrow('Session not found: non_existent_session');
      store.close();
    });

    it('throws error when newSessionId already exists', () => {
      const store = new MemoryStore(':memory:');
      const p1 = store.createSession('/dir', 'sess_orig');
      store.createSession('/dir', 'sess_target_conflict');

      expect(() => {
        store.forkSession(p1, 'sess_target_conflict');
      }).toThrow('Session already exists: sess_target_conflict');
      store.close();
    });
  });
});

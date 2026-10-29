import { describe, it, expect } from 'vitest';
import { MemoryStore } from '../memory-store.js';
import { CheckpointWriter } from '../checkpoint-writer.js';

describe('Session registry (T3.3): create -> list -> resume reads back the checkpoint', () => {
  it('registers a session, lists it, and resumes its checkpoint', async () => {
    const store = new MemoryStore(':memory:');
    const writer = new CheckpointWriter(store, '/tmp/test-project');

    // create
    const sessionId = store.createSession('/tmp/test-project');
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
});

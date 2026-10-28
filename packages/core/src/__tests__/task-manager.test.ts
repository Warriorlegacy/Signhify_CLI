import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TaskManager } from '../task-manager.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

describe('TaskManager', () => {
  let tmpDir: string;
  let manager: TaskManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'signhify-task-'));
    manager = new TaskManager(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should generate hierarchical task IDs (T1, T1.1, T2)', async () => {
    const t1 = await manager.createTask('Root Task 1');
    expect(t1).toBe('T1');

    const t1_1 = await manager.createTask('Subtask 1.1', t1);
    expect(t1_1).toBe('T1.1');

    const t1_2 = await manager.createTask('Subtask 1.2', t1);
    expect(t1_2).toBe('T1.2');

    const t2 = await manager.createTask('Root Task 2');
    expect(t2).toBe('T2');
  });

  it('should track active task and hierarchical task tree correctly', async () => {
    const t1 = await manager.createTask('Root Task 1');
    const t1_1 = await manager.createTask('Subtask 1.1', t1);

    expect(manager.getActiveTask()?.id).toBe('T1');

    await manager.startTask(t1_1);
    expect(manager.getActiveTask()?.id).toBe('T1.1');

    await manager.completeTask(t1_1);
    const tree = manager.getTaskTree();
    expect(tree).toHaveLength(2);
    expect(tree[0].id).toBe('T1');
    expect(tree[1].id).toBe('T1.1');
    expect(tree[1].status).toBe('done');
  });
});


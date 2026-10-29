import { describe, it, expect } from 'vitest';
import { parsePlanSteps, buildTaskNodes } from '../planner.js';

describe('parsePlanSteps T3.2', () => {
  it('parses a clean JSON plan', () => {
    const steps = parsePlanSteps('[{"id":"T1","title":"Scope","subagent":"file-picker"}]');
    expect(steps).toEqual([{ id: 'T1', title: 'Scope', subagent: 'file-picker' }]);
  });

  it('parses a plan wrapped in prose or a json fence', () => {
    const text =
      'Here is the plan:\n```json\n[{"id":"A1","title":"Find files","subagent":"file-picker"},{"id":"A1.1","title":"Edit","subagent":"editor"}]\n```';
    const steps = parsePlanSteps(text);
    expect(steps).toHaveLength(2);
    expect(steps?.[1]).toEqual({ id: 'A1.1', title: 'Edit', subagent: 'editor' });
  });

  it('rejects unknown subagent roles, non-arrays, and garbage', () => {
    expect(parsePlanSteps('[{"id":"T1","title":"x","subagent":"nope"}]')).toBeNull();
    expect(parsePlanSteps('[]')).toBeNull();
    expect(parsePlanSteps('')).toBeNull();
    expect(parsePlanSteps('random chatter without json')).toBeNull();
  });

  it('buildTaskNodes parents every step after the first onto the root id', () => {
    const nodes = buildTaskNodes([
      { id: 'T1', title: 'root', subagent: 'file-picker' },
      { id: 'T1.1', title: 'child', subagent: 'editor' },
    ]);
    expect(nodes[0].parentId).toBeUndefined();
    expect(nodes[1].parentId).toBe('T1');
  });
});

import { describe, it, expect, vi } from 'vitest';
import { AgentLoop, ToolHandler } from '../agent-loop.js';
import { SignhifyConfig } from '../types.js';

const mockConfig: SignhifyConfig = {
  provider: {
    agent: { vendor: 'openai', model: 'gpt-4', apiKey: 'test-key' },
  },
  memory: { tokenBudget: 4000, checkpointThresholdPct: 80 },
};

describe('AgentLoop', () => {
  it('should initialize with default modes', () => {
    const loop = new AgentLoop({
      config: mockConfig,
      workingDirectory: '/tmp/test',
    });

    const modeManager = loop.getModeManager();
    expect(modeManager.getAvailableModes()).toContain('build');
    expect(modeManager.getAvailableModes()).toContain('plan');
  });

  it('should register and use tools', async () => {
    const loop = new AgentLoop({
      config: mockConfig,
      workingDirectory: '/tmp/test',
    });

    const mockTool: ToolHandler = {
      name: 'mock-tool',
      description: 'A mock tool for testing',
      parameters: {},
      execute: async () => 'mock result',
    };

    loop.registerTool(mockTool);
    expect(loop.getToolDefinitions()).toHaveLength(1);
    expect(loop.getToolDefinitions()[0].name).toBe('mock-tool');
  });

  it('should deny tools not in current mode', async () => {
    const loop = new AgentLoop({
      config: mockConfig,
      workingDirectory: '/tmp/test',
    });

    loop.getModeManager().setMode('plan');
    const permission = loop.getPermissionEngine().canUseTool('file-write');
    expect(permission.allowed).toBe(false);
  });

  it('should allow tools in build mode', async () => {
    const loop = new AgentLoop({
      config: mockConfig,
      workingDirectory: '/tmp/test',
    });

    loop.getModeManager().setMode('build');
    const permission = loop.getPermissionEngine().canUseTool('file-write');
    expect(permission.allowed).toBe(true);
  });

  it('should track goal state', () => {
    const loop = new AgentLoop({
      config: mockConfig,
      workingDirectory: '/tmp/test',
      goal: { statement: 'All tests pass', maxIterations: 5 },
    });

    const verdict = loop.checkGoal();
    expect(verdict).resolves.toBeNull();
  });
});

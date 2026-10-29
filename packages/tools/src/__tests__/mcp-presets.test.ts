import { describe, it, expect } from 'vitest';
import { mcpClientTool, BUILT_IN_MCP_PRESETS } from '../mcp-client.js';

describe('MCP Client Presets', () => {
  it('should list all built-in presets', async () => {
    const res = await mcpClientTool.execute(
      { action: 'list-presets', serverName: '' },
      { workingDirectory: process.cwd() }
    );
    const parsed = JSON.parse(res);
    expect(parsed).toHaveProperty('presets');
    const names = parsed.presets.map((p: { preset: string }) => p.preset);
    expect(names).toEqual(['rea']);
  });

  it('pins the REA package and uses its MCP entry point', () => {
    expect(BUILT_IN_MCP_PRESETS.rea.command).toBe('npx');
    expect(BUILT_IN_MCP_PRESETS.rea.args).toEqual(['-y', 'rea-agents@6.8.0', 'mcp']);
  });
});


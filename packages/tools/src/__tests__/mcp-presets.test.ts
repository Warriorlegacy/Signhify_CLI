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
    expect(names).toContain('rea');
    expect(names).toContain('cloudflare');
    expect(names).toContain('supabase');
    expect(names).toContain('openseo');
  });

  it('should have rea preset configured with official package', () => {
    expect(BUILT_IN_MCP_PRESETS.rea.command).toBe('npx');
    expect(BUILT_IN_MCP_PRESETS.rea.args).toContain('rea-agents@latest');
  });
});


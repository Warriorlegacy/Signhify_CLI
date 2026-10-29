import { describe, it, expect } from 'vitest';
import { connectMcpServers, getMcpStatuses } from '../mcp-client.js';

// These tests only assert the *honesty* contract: a server that cannot start
// is never reported as connected. No real MCP server is required.
describe('MCP connection status', () => {
  it('reports a server with no command as failed, never connected', async () => {
    const statuses = await connectMcpServers(
      [{ name: 'no-command-server' }],
      process.cwd()
    );
    const entry = statuses.find((s) => s.name === 'no-command-server');
    expect(entry?.status).toBe('failed');
    expect(entry?.error).toContain('no command');
  });

  it('reports a server whose command does not exist as failed with a reason', async () => {
    const statuses = await connectMcpServers(
      [{ name: 'missing-binary', command: 'signhify-definitely-not-a-real-binary-xyz', args: [] }],
      process.cwd(),
      async () => true
    );
    const entry = statuses.find((s) => s.name === 'missing-binary');
    expect(entry).toBeDefined();
    expect(entry?.status).toBe('failed');
    expect(entry?.error).toBeTruthy();
  }, 45_000);

  it('never invents servers that were not configured', async () => {
    const before = getMcpStatuses().map((s) => s.name);
    await connectMcpServers([], process.cwd());
    const after = getMcpStatuses().map((s) => s.name);
    expect(after).toEqual(before);
    expect(after).not.toContain('rea');
    expect(after).not.toContain('supabase');
  });
});

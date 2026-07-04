import { describe, it, expect } from 'vitest';
import { ModeManager, BUILT_IN_MODES } from '../modes.js';

describe('ModeManager', () => {
  it('should initialize with build mode', () => {
    const mm = new ModeManager();
    expect(mm.getCurrentMode().name).toBe('build');
  });

  it('should list available modes', () => {
    const mm = new ModeManager();
    const modes = mm.getAvailableModes();
    expect(modes).toContain('build');
    expect(modes).toContain('plan');
    expect(modes).toContain('debug');
    expect(modes).toContain('compose');
  });

  it('should switch modes', () => {
    const mm = new ModeManager();
    mm.setMode('plan');
    expect(mm.getCurrentMode().name).toBe('plan');
  });

  it('should throw on unknown mode', () => {
    const mm = new ModeManager();
    expect(() => mm.setMode('unknown')).toThrow('Unknown mode: unknown');
  });

  it('should check tool permissions per mode', () => {
    const mm = new ModeManager();
    expect(mm.isToolAllowed('file-write', 'build')).toBe(true);
    expect(mm.isToolAllowed('file-write', 'plan')).toBe(false);
  });

  it('should support custom modes', () => {
    const mm = new ModeManager([
      { name: 'reviewer', prompt: 'Review code', allowedTools: ['file-read', 'search'] },
    ]);
    expect(mm.getAvailableModes()).toContain('reviewer');
    mm.setMode('reviewer');
    expect(mm.isToolAllowed('file-read')).toBe(true);
    expect(mm.isToolAllowed('file-write')).toBe(false);
  });
});

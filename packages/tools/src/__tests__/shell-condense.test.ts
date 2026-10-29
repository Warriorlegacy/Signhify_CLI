import { describe, it, expect } from 'vitest';
import { condenseShellOutput } from '../shell-exec.js';

describe('condenseShellOutput', () => {
  it('passes ordinary output through unchanged', () => {
    const text = 'Compiling 12 modules\nBuild finished in 1.2s\n';
    expect(condenseShellOutput(text)).toBe(text);
  });

  it('strips ANSI escape sequences (colors, OSC titles, cursor moves)', () => {
    const text = '\x1b[32m✓\x1b[0m tests passed\x07';
    expect(condenseShellOutput(text)).toBe('✓ tests passed');
    expect(condenseShellOutput('\x1b]0;title\x1b\\body\n')).toBe('body\n');
    expect(condenseShellOutput('\x1b[2K\x1b[1G progress\n')).toBe(' progress\n');
  });

  it('folds carriage-return progress lines to their final state', () => {
    const text = 'Downloading 10%\rDownloading 50%\rDownloading 100%\nDone\n';
    expect(condenseShellOutput(text)).toBe('Downloading 100%\nDone\n');
  });

  it('redacts unambiguous secret shapes but keeps surrounding text', () => {
    const text =
      'OPENAI sk-abcdef1234567890abcdef12 in env; GITHUB ghp_0123456789abcdef0123456789abcdef01234567; ' +
      'AWS AKIA0123456789ABCDEF; Slack xoxb-0123456789abcdef; password=hunter2';
    const out = condenseShellOutput(text);
    expect(out).toContain('<redacted>');
    expect(out).not.toContain('sk-abcdef');
    expect(out).not.toContain('ghp_0123');
    expect(out).not.toContain('AKIA0123');
    expect(out).not.toContain('xoxb-0123');
    // Low-specificity strings are deliberately left intact.
    expect(out).toContain('password=hunter2');
  });

  it('elides pathological single lines', () => {
    const long = 'x'.repeat(3_000);
    const out = condenseShellOutput(`head\n${long}\ntail`);
    expect(out).toContain('head');
    expect(out).toContain('tail');
    expect(out).toContain('line elided');
    expect(out.length).toBeLessThan(2300);
  });

  it('caps huge output preserving head and tail with an omission marker', () => {
    // Lines stay under the elision threshold so the cap path actually fires.
    const body = Array.from({ length: 8 }, () => 'b'.repeat(1_900)).join('\n');
    const text = `HEAD-START\n${body}\nTAIL-END`;
    const out = condenseShellOutput(text, 10_000);
    expect(out).toContain('HEAD-START');
    expect(out).toContain('TAIL-END');
    expect(out).toContain('chars omitted');
    expect(out).toContain('re-run with a narrower command');
    expect(out.length).toBeLessThanOrEqual(10_500);
  });
});

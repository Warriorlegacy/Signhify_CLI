import { describe, it, expect } from 'vitest';
import { generateTerminalPreviewMarkup, MOCK_SESSION_FIXTURE } from '../components/TerminalPreview.js';

// The fixture is a real transcript captured from the mock provider:
//   SIGNHIFY_MOCK_PROVIDER=1 node packages/cli/dist/index.js \
//     run "Does <script>& x>y pipeline work?" --output json
const fixture = MOCK_SESSION_FIXTURE;

describe('generateTerminalPreviewMarkup', () => {
  it('renders every fixture transcript line', () => {
    const markup = generateTerminalPreviewMarkup({ transcript: fixture });

    // Fixture content is escaped in output, so compare against the escaped form.
    const escape = (value: string) =>
      value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

    for (const line of fixture) {
      expect(markup).toContain(escape(line.content));
    }
    expect(markup).toContain('data-role="user"');
    expect(markup).toContain('data-role="assistant"');
  });

  it('escapes <, >, & in transcript content (no injection)', () => {
    const markup = generateTerminalPreviewMarkup({ transcript: fixture });

    // Hostile chars from the real prompt must be escaped, not raw.
    expect(markup).not.toContain('<script>');
    expect(markup).toContain('&lt;script&gt;');
    expect(markup).toContain('&amp;');
    expect(markup).toContain('&gt;');
  });

  it('bar content rides on trusted props, not transcript input', () => {
    const markup = generateTerminalPreviewMarkup({
      mode: 'plan',
      activeRouter: 'groq-cloud (fallback)',
      contextUsagePct: 41,
      transcript: [],
    });

    expect(markup).toContain('PLAN');
    expect(markup).toContain('groq-cloud (fallback)');
    expect(markup).toContain('Context: 41%');
  });
});

export interface TerminalTranscriptLine {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface TerminalPreviewProps {
  title?: string;
  mode?: 'build' | 'plan';
  activeRouter?: string;
  contextUsagePct?: number;
  transcript?: TerminalTranscriptLine[];
}

// Fixture transcript from a real capture:
//   SIGNHIFY_MOCK_PROVIDER=1 node packages/cli/dist/index.js \
//     run "Does <script>& x>y pipeline work?" --output json
// The user line is the CLI-reported task; the assistant line is the mock
// adapter's fixed response (packages/providers/src/adapter.ts). The hostile
// characters come straight from the user prompt, which is why the escaping
// below is testable against real input rather than a synthetic string.
export const MOCK_SESSION_FIXTURE: TerminalTranscriptLine[] = [
  { role: 'user', content: 'Does <script>& x>y pipeline work?' },
  { role: 'assistant', content: 'Task completed successfully by mock provider.' },
];

// Attribute context only — never interpolates raw content into tags.
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')  // ampersand first so entities survive
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function generateTerminalPreviewMarkup(props?: TerminalPreviewProps): string {
  const mode = props?.mode ?? 'build';
  const router = props?.activeRouter ?? '9router (port 20128)';
  const usage = props?.contextUsagePct ?? 62;
  const transcript = props?.transcript ?? [];

  const transcriptMarkup = transcript
    .map((line) => {
      const attrs = `data-role="${escapeHtml(line.role)}"`;
      return `  <div class="tp-line" ${attrs}>${escapeHtml(line.content)}</div>`;
    })
    .join('\n');

  return `
<div class="terminal-preview" data-mode="${mode}" data-router="${router}">
  <div class="terminal-bar">
    <span class="badge ${mode}">${mode.toUpperCase()}</span>
    <span class="router-info">${router}</span>
    <span class="context-meter">Context: ${usage}%</span>
  </div>
  <div class="terminal-transcript">
${transcriptMarkup}
  </div>
</div>
  `.trim();
}

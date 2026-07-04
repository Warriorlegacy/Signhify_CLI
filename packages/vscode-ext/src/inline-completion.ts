import * as vscode from 'vscode';
import { createAdapter } from '@signhify/providers';

export class SignhifyInlineCompletionProvider
  implements vscode.InlineCompletionItemProvider
{
  private lastTriggerTime = 0;
  private readonly minIntervalMs = 200;
  private currentRequest?: {
    document: vscode.TextDocument;
    position: vscode.Position;
    token: vscode.CancellationToken;
    resolve: (items: vscode.InlineCompletionItem[] | undefined, done: boolean) => void;
  };
  private activeAbort?: AbortController;

  provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.InlineCompletionItem[]> {
    const now = Date.now();
    if (now - this.lastTriggerTime < this.minIntervalMs) {
      return [];
    }
    this.lastTriggerTime = now;

    if (this.currentRequest) {
      this.activeAbort?.abort();
    }

    return new Promise((resolve) => {
      let settled = false;

      const done = (items: vscode.InlineCompletionItem[] | undefined) => {
        if (settled) return;
        settled = true;
        this.currentRequest = undefined;
        this.activeAbort = undefined;
        resolve(items);
      };

      token.onCancellationRequested(() => {
        this.activeAbort?.abort();
        done([]);
      });

      const lineText = document.lineAt(position).text;
      const textBeforeCursor = lineText.substring(0, position.character);

      if (textBeforeCursor.trim().length === 0) {
        done([]);
        return;
      }

      const startLine = Math.max(0, position.line - 20);
      const endLine = Math.min(document.lineCount - 1, position.line + 5);
      const surrounding = document.getText(new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length));

      this.currentRequest = { document, position, token, resolve: done };
      this.activeAbort = new AbortController();

      this.fetchCompletion(surrounding, textBeforeCursor, token).then((items) => {
        if (!token.isCancellationRequested) {
          done(items);
        }
      }).catch(() => {
        if (!settled) done([]);
      });
    });
  }

  private async fetchCompletion(
    context: string,
    textBeforeCursor: string,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[]> {
    if (!this.currentRequest) return [];

    const config = vscode.workspace.getConfiguration('signhify');

    const vendor = config.get<string>('provider.autocomplete.vendor')
      ?? config.get<string>('provider.agent.vendor', 'openai-compatible');
    const model = config.get<string>('provider.autocomplete.model')
      ?? config.get<string>('provider.agent.model', 'gpt-4');
    const apiKey = config.get<string>('provider.autocomplete.apiKey')
      ?? config.get<string>('provider.agent.apiKey', '');
    const baseUrl = config.get<string>('provider.autocomplete.baseUrl')
      ?? config.get<string>('provider.agent.baseUrl', '');

    if (!apiKey && !baseUrl) {
      return [];
    }

    const adapter = await createAdapter({
      vendor: vendor as 'anthropic' | 'google' | 'openai' | 'openai-compatible',
      model,
      apiKey,
      baseUrl: baseUrl || undefined,
    });

    const prompt = `Complete the following code snippet. Only return the completion text, no explanations or markdown.\n\n\`\`\`\n${context}\n\`\`\`\n\nCursor position after: "${textBeforeCursor.slice(-40)}"\nCompletion:`;

    let completionText = '';
    try {
      const stream = adapter.streamChat({
        messages: [{ role: 'user', content: prompt }],
        tools: [],
        model,
        maxTokens: 128,
      });

      for await (const chunk of stream) {
        if (token.isCancellationRequested) return [];
        if (chunk.type === 'text' && chunk.content) {
          completionText += chunk.content;
        }
      }
    } catch {
      return [];
    }

    const trimmed = completionText.trim();
    if (!trimmed) return [];

    return [new vscode.InlineCompletionItem(trimmed)];
  }
}

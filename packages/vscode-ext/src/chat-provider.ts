import * as vscode from 'vscode';
import { AgentLoop, SignhifyConfig } from '@signhify/core';
import { createAdapter } from '@signhify/providers';
import { fileIoTool, shellExecTool, gitTool, searchTool } from '@signhify/tools';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  fileEdits?: FileEdit[];
}

interface FileEdit {
  id: string;
  filePath: string;
  content: string;
  accepted?: boolean;
}

export class SignhifyChatProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'signhify.chat';
  private _view?: vscode.WebviewView;
  private messages: ChatMessage[] = [];
  private currentMode = 'build';
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtml();

    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message.type === 'sendMessage') {
        await this.handleMessage(message.text);
      }
      if (message.type === 'setMode') {
        this.currentMode = message.mode;
      }
      if (message.type === 'acceptEdit' || message.type === 'rejectEdit') {
        const editId = message.editId as string;
        for (const msg of this.messages) {
          if (msg.fileEdits) {
            const edit = msg.fileEdits.find((e) => e.id === editId);
            if (edit) {
              edit.accepted = message.type === 'acceptEdit';
              break;
            }
          }
        }
        this.postMessages();
      }
    });
  }

  async handleMessage(text: string): Promise<void> {
    this.messages.push({ role: 'user', content: text, timestamp: Date.now() });
    this.postMessages();

    let taskSummary: string | undefined;
    try {
      const config = this.getConfig();
      const workspaceFolder =
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

      const adapter = createAdapter(config.provider.agent);
      const loop = new AgentLoop({
        config,
        workingDirectory: workspaceFolder,
        provider: adapter,
        autoMode: false,
      });

      loop.registerTool(fileIoTool);
      loop.registerTool(shellExecTool);
      loop.registerTool(gitTool);
      loop.registerTool(searchTool);
      loop.getModeManager().setMode(this.currentMode as 'build' | 'plan' | 'debug' | 'compose');

      const result = await loop.run(text);
      const lastAssistant = result.messages
        .filter((m) => m.role === 'assistant')
        .pop();

      const fileEdits = this.extractFileEdits(result.toolCalls);

      this.messages.push({
        role: 'assistant',
        content: lastAssistant?.content ?? 'No response generated.',
        timestamp: Date.now(),
        fileEdits: fileEdits.length > 0 ? fileEdits : undefined,
      });

      taskSummary = lastAssistant?.content?.slice(0, 80) ?? 'No response generated.';
    } catch (error) {
      this.messages.push({
        role: 'assistant',
        content: `Error: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: Date.now(),
      });
    }

    this.postMessages();

    if (taskSummary) {
      vscode.window.showInformationMessage(`Task complete: ${taskSummary}`);
    }
  }

  newTask(): void {
    this.messages = [];
    this.postMessages();
  }

  private extractFileEdits(
    toolCalls: Array<{ call: { name: string; arguments: Record<string, unknown> }; result: string }>
  ): FileEdit[] {
    const edits: FileEdit[] = [];
    for (const tc of toolCalls) {
      if (tc.call.name === 'file-io' && tc.call.arguments.action === 'write') {
        const filePath = tc.call.arguments.path as string;
        const content = tc.call.arguments.content as string;
        if (filePath && content) {
          edits.push({
            id: `edit_${Date.now()}_${edits.length}`,
            filePath,
            content,
          });
        }
      }
    }
    return edits;
  }

  setMode(mode: string): void {
    this.currentMode = mode;
    this._view?.webview.postMessage({ type: 'modeChanged', mode });
  }

  private postMessages(): void {
    this._view?.webview.postMessage({
      type: 'messages',
      messages: this.messages,
      mode: this.currentMode,
    });
  }

  private getConfig(): SignhifyConfig {
    const config = vscode.workspace.getConfiguration('signhify');
    return {
      provider: {
        agent: {
          vendor: config.get<string>('provider.vendor', 'openai'),
          model: config.get<string>('provider.model', 'gpt-4'),
          apiKey: config.get<string>('provider.apiKey', ''),
          baseUrl: config.get<string>('provider.baseUrl', ''),
        },
      },
      memory: { tokenBudget: 4000, checkpointThresholdPct: 80 },
    };
  }

  private getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Signhify Chat</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      padding: 12px;
      display: flex;
      flex-direction: column;
      height: 100vh;
    }
    #mode-indicator {
      font-size: 0.8em;
      padding: 4px 8px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      border-radius: 4px;
      display: inline-block;
      align-self: flex-start;
      margin-bottom: 8px;
    }
    #messages {
      flex: 1;
      overflow-y: auto;
      margin-bottom: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .message {
      padding: 8px 10px;
      border-radius: 6px;
      line-height: 1.5;
      word-wrap: break-word;
      white-space: pre-wrap;
    }
    .user {
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border);
      align-self: flex-end;
      max-width: 85%;
    }
    .assistant {
      background: var(--vscode-textBlockQuote-background);
      border-left: 3px solid var(--vscode-textLink-foreground);
      align-self: flex-start;
      max-width: 90%;
    }
    .system {
      background: var(--vscode-editor-selectionBackground);
      align-self: center;
      max-width: 90%;
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }
    .role {
      font-weight: bold;
      font-size: 0.8em;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 4px;
    }
    .content {
      font-size: var(--vscode-font-size);
    }
    .input-row {
      display: flex;
      gap: 8px;
    }
    #input {
      flex: 1;
      padding: 8px 10px;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 4px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      resize: none;
      min-height: 36px;
      max-height: 120px;
    }
    #input:focus {
      outline: 1px solid var(--vscode-focusBorder);
    }
    #send-btn {
      padding: 8px 16px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      white-space: nowrap;
    }
    #send-btn:hover:not(:disabled) {
      background: var(--vscode-button-hoverBackground);
    }
    #send-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .loading {
      color: var(--vscode-descriptionForeground);
      font-style: italic;
      padding: 8px;
    }
    .diff-container {
      margin-top: 8px;
      border: 1px solid var(--vscode-input-border);
      border-radius: 6px;
      overflow: hidden;
    }
    .diff-header {
      background: var(--vscode-editorGroupHeader-tabsBackground);
      padding: 6px 10px;
      font-size: 0.85em;
      font-family: var(--vscode-editor-font-family, monospace);
      color: var(--vscode-foreground);
      border-bottom: 1px solid var(--vscode-input-border);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .diff-header .file-path {
      flex: 1;
      font-weight: bold;
    }
    .diff-header .badge {
      font-size: 0.75em;
      padding: 1px 6px;
      border-radius: 3px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
    }
    .diff-body {
      max-height: 300px;
      overflow-y: auto;
    }
    .diff-body pre {
      margin: 0;
      padding: 8px 10px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: var(--vscode-editor-font-size);
      line-height: 1.5;
      white-space: pre;
      color: var(--vscode-foreground);
    }
    .diff-actions {
      display: flex;
      gap: 6px;
      padding: 6px 10px;
      border-top: 1px solid var(--vscode-input-border);
      background: var(--vscode-editorGroupHeader-tabsBackground);
    }
    .diff-actions button {
      padding: 3px 12px;
      border-radius: 4px;
      border: 1px solid var(--vscode-input-border);
      cursor: pointer;
      font-family: var(--vscode-font-family);
      font-size: 0.85em;
    }
    .accept-btn {
      background: var(--vscode-testing-iconPassed);
      color: #fff;
      border-color: var(--vscode-testing-iconPassed) !important;
    }
    .reject-btn {
      background: var(--vscode-testing-iconFailed);
      color: #fff;
      border-color: var(--vscode-testing-iconFailed) !important;
    }
    .diff-actions button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .edit-status {
      font-size: 0.8em;
      padding: 2px 8px;
      border-radius: 3px;
    }
    .edit-accepted {
      background: var(--vscode-testing-iconPassed);
      color: #fff;
    }
    .edit-rejected {
      background: var(--vscode-testing-iconFailed);
      color: #fff;
    }
  </style>
</head>
<body>
  <div id="mode-indicator">Mode: build</div>
  <div id="messages"></div>
  <div class="input-row">
    <input id="input" type="text" placeholder="Describe a task..." />
    <button id="send-btn">Send</button>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const input = document.getElementById('input');
    const sendBtn = document.getElementById('send-btn');
    const messagesEl = document.getElementById('messages');
    const modeIndicator = document.getElementById('mode-indicator');
    let awaitingResponse = false;

    sendBtn.addEventListener('click', send);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });

    function send() {
      if (awaitingResponse) return;
      const text = input.value.trim();
      if (!text) return;
      awaitingResponse = true;
      sendBtn.disabled = true;
      vscode.postMessage({ type: 'sendMessage', text });
      input.value = '';
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;

      if (msg.type === 'messages') {
        if (msg.messages.length === 0) {
          messagesEl.innerHTML = '';
        } else {
          messagesEl.innerHTML = msg.messages.map(function(m) {
            var label = m.role === 'user' ? 'You' : m.role === 'system' ? 'System' : 'Signhify';
            var escaped = escapeHtml(m.content);
            var diffHtml = '';
            if (m.fileEdits && m.fileEdits.length > 0) {
              diffHtml = m.fileEdits.map(function(edit) {
                var statusBadge = '';
                var btnDisabled = '';
                if (edit.accepted === true) {
                  statusBadge = '<span class="edit-status edit-accepted">Applied</span>';
                  btnDisabled = ' disabled';
                } else if (edit.accepted === false) {
                  statusBadge = '<span class="edit-status edit-rejected">Rejected</span>';
                  btnDisabled = ' disabled';
                }
                var contentLines = edit.content.split('\\n');
                var numberedLines = contentLines.map(function(line, i) {
                  return '<span style="color:var(--vscode-editorLineNumberForeground);user-select:none;display:inline-block;width:3ch;text-align:right;margin-right:1ch">' + (i + 1) + '</span>' +
                    '<span style="color:#4ec9b0">' + escapeHtml(line) + '</span>';
                }).join('\\n');
                return '<div class="diff-container">' +
                  '<div class="diff-header">' +
                    '<span class="file-path">' + escapeHtml(edit.filePath) + '</span>' +
                    '<span class="badge">NEW</span>' +
                    statusBadge +
                  '</div>' +
                  '<div class="diff-body"><pre>' + numberedLines + '</pre></div>' +
                  '<div class="diff-actions">' +
                    '<button class="accept-btn" data-edit-id="' + edit.id + '"' + btnDisabled + '>Accept</button>' +
                    '<button class="reject-btn" data-edit-id="' + edit.id + '"' + btnDisabled + '>Reject</button>' +
                  '</div>' +
                '</div>';
              }).join('');
            }
            return '<div class="message ' + m.role + '">' +
              '<div class="role">' + label + '</div>' +
              '<div class="content">' + escaped + '</div>' +
              diffHtml +
            '</div>';
          }).join('');
        }
        modeIndicator.textContent = 'Mode: ' + msg.mode;
        messagesEl.scrollTop = messagesEl.scrollHeight;
        awaitingResponse = false;
        sendBtn.disabled = false;
        input.focus();
      }

      if (msg.type === 'modeChanged') {
        modeIndicator.textContent = 'Mode: ' + msg.mode;
      }
    });

    function escapeHtml(text) {
      var div = document.createElement('div');
      div.appendChild(document.createTextNode(text));
      return div.innerHTML;
    }

    messagesEl.addEventListener('click', function(e) {
      var target = e.target;
      if (!target.dataset || !target.dataset.editId) return;
      var editId = target.dataset.editId;
      var type = target.classList.contains('accept-btn') ? 'acceptEdit' : 'rejectEdit';
      vscode.postMessage({ type: type, editId: editId });
    });
  </script>
</body>
</html>`;
  }
}

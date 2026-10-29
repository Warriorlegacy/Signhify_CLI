import * as vscode from "vscode";
import * as path from 'node:path';
import { SignhifyChatProvider } from './chat-provider.js';
import { SignhifyInlineCompletionProvider } from './inline-completion.js';
import { deleteCredential, migrateLegacyApiKeys, storeCredential } from './secret-storage.js';

export function activate(context: vscode.ExtensionContext): void {
  void migrateLegacyApiKeys(context).catch(() => {
    vscode.window.showWarningMessage('Signhify could not move an API key into VS Code Secret Storage. Use Signhify: Set API Key to configure it securely.');
  });
  const chatProvider = new SignhifyChatProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SignhifyChatProvider.viewType, chatProvider)
  );

  const inlineProvider = new SignhifyInlineCompletionProvider(context);
  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, inlineProvider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('signhify.newTask', () => chatProvider.newTask())
  );

  for (const [command, name, title] of [
    ['signhify.setApiKey', 'provider.apiKey', 'agent'],
    ['signhify.setAutocompleteApiKey', 'provider.autocomplete.apiKey', 'autocomplete'],
  ] as const) {
    context.subscriptions.push(vscode.commands.registerCommand(command, async (providedKey?: string) => {
      const value = typeof providedKey === 'string'
        ? providedKey
        : await vscode.window.showInputBox({
            password: true,
            ignoreFocusOut: true,
            prompt: `Enter the ${title} provider API key. Leave empty to clear it.`,
          });
      if (value === undefined) return;
      if (value) await storeCredential(context, name, value);
      else await deleteCredential(context, name);
      vscode.window.showInformationMessage(value ? `Signhify ${title} key saved in VS Code Secret Storage.` : `Signhify ${title} key removed.`);
    }));
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('signhify.clearApiKey', async (keyName?: string) => {
      const target = typeof keyName === 'string' ? keyName : 'provider.apiKey';
      await deleteCredential(context, target);
      vscode.window.showInformationMessage(`Signhify ${target} key removed from VS Code Secret Storage.`);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('signhify.openSettings', async () => {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'signhify');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('signhify.switchMode', async () => {
      const modes = ['build', 'plan', 'debug', 'compose'];
      const selected = await vscode.window.showQuickPick(modes, { placeHolder: 'Select Signhify mode' });
      if (selected) {
        chatProvider.setMode(selected);
        vscode.window.showInformationMessage(`Signhify mode: ${selected}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('signhify.openMemory', async () => {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '.';
      const memoryPath = path.join(workspaceFolder, '.signhify', 'MEMORY.md');
      const uri = vscode.Uri.file(memoryPath);
      try {
        await vscode.commands.executeCommand('vscode.open', uri);
      } catch {
        vscode.window.showInformationMessage('No MEMORY.md found. It will be created on first run.');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('signhify.triggerInlineCompletion', () => {
      vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
    })
  );
}

export function deactivate(): void {
}

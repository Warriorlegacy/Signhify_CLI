import * as vscode from "vscode";
import { SignhifyChatProvider } from './chat-provider.js';
import { SignhifyInlineCompletionProvider } from './inline-completion.js';
import { createAdapter } from '@signhify/providers';
import { AgentLoop } from '@signhify/core';
import { fileIoTool, shellExecTool, gitTool, searchTool } from '@signhify/tools';

export function activate(context: vscode.ExtensionContext): void {
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
      const memoryPath = require('path').join(workspaceFolder, '.signhify', 'MEMORY.md');
      const uri = vscode.Uri.file(memoryPath);
      try {
        await vscode.commands.executeCommand('vscode.open', uri);
      } catch {
        vscode.window.showInformationMessage('No MEMORY.md found. It will be created on first run.');
      }
    })
  );
}

export function deactivate(): void {
  // noop
}

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MockWorkspaceConfiguration,
  createMockExtensionContext,
  createMockUri,
} from './mock-vscode.js';

const registeredCommands = new Map<string, (...args: any[]) => any>();
const executedCommands: { command: string; args: any[] }[] = [];
const informationMessages: string[] = [];
const warningMessages: string[] = [];
let inputBoxResult: string | undefined = undefined;
let quickPickResult: string | undefined = undefined;
let registeredWebviewProvider: any = undefined;
let registeredInlineProvider: any = undefined;

vi.mock('vscode', () => {
  return {
    ConfigurationTarget: {
      Global: 1,
      Workspace: 2,
      WorkspaceFolder: 3,
    },
    Uri: {
      file: (pathStr: string) => createMockUri(pathStr),
      parse: (str: string) => createMockUri(str),
    },
    workspace: {
      workspaceFolders: [
        {
          uri: createMockUri('/test/workspace'),
          name: 'test-workspace',
          index: 0,
        },
      ],
      workspaceFile: undefined,
      getConfiguration: vi.fn(() => new MockWorkspaceConfiguration()),
      onDidChangeConfiguration: vi.fn(),
    },
    commands: {
      registerCommand: vi.fn((command: string, callback: (...args: any[]) => any) => {
        registeredCommands.set(command, callback);
        return {
          dispose: () => registeredCommands.delete(command),
        };
      }),
      executeCommand: vi.fn(async (command: string, ...args: any[]) => {
        executedCommands.push({ command, args });
        const handler = registeredCommands.get(command);
        if (handler) {
          return await handler(...args);
        }
        return undefined;
      }),
    },
    window: {
      showInputBox: vi.fn(async () => inputBoxResult),
      showInformationMessage: vi.fn(async (msg: string) => {
        informationMessages.push(msg);
        return undefined;
      }),
      showWarningMessage: vi.fn(async (msg: string) => {
        warningMessages.push(msg);
        return undefined;
      }),
      showErrorMessage: vi.fn(),
      showQuickPick: vi.fn(async () => quickPickResult),
      registerWebviewViewProvider: vi.fn((viewType: string, provider: any) => {
        registeredWebviewProvider = { viewType, provider };
        return { dispose: vi.fn() };
      }),
    },
    languages: {
      registerInlineCompletionItemProvider: vi.fn((selector: any, provider: any) => {
        registeredInlineProvider = { selector, provider };
        return { dispose: vi.fn() };
      }),
    },
  };
});

import * as vscode from 'vscode';
import { activate, deactivate } from '../extension.js';
import { credentialSecretKey } from '../secret-storage.js';

describe('Extension Command Coverage & SecretStorage Integration', () => {
  let context: ReturnType<typeof createMockExtensionContext>;

  beforeEach(() => {
    registeredCommands.clear();
    executedCommands.length = 0;
    informationMessages.length = 0;
    warningMessages.length = 0;
    inputBoxResult = undefined;
    quickPickResult = undefined;
    registeredWebviewProvider = undefined;
    registeredInlineProvider = undefined;
    context = createMockExtensionContext();
    activate(context);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Command Registration Verification', () => {
    it('registers signhify.setApiKey command', () => {
      expect(registeredCommands.has('signhify.setApiKey')).toBe(true);
    });

    it('registers signhify.clearApiKey command', () => {
      expect(registeredCommands.has('signhify.clearApiKey')).toBe(true);
    });

    it('registers signhify.openSettings command', () => {
      expect(registeredCommands.has('signhify.openSettings')).toBe(true);
    });

    it('registers signhify.setAutocompleteApiKey command', () => {
      expect(registeredCommands.has('signhify.setAutocompleteApiKey')).toBe(true);
    });

    it('registers signhify.newTask command', () => {
      expect(registeredCommands.has('signhify.newTask')).toBe(true);
    });

    it('registers signhify.switchMode command', () => {
      expect(registeredCommands.has('signhify.switchMode')).toBe(true);
    });

    it('registers signhify.openMemory command', () => {
      expect(registeredCommands.has('signhify.openMemory')).toBe(true);
    });

    it('registers signhify.triggerInlineCompletion command', () => {
      expect(registeredCommands.has('signhify.triggerInlineCompletion')).toBe(true);
    });

    it('registers providers and pushes disposables to subscriptions', () => {
      expect(registeredWebviewProvider).toBeDefined();
      expect(registeredWebviewProvider.viewType).toBe('signhify.chat');
      expect(registeredInlineProvider).toBeDefined();
      expect(context.subscriptions.length).toBeGreaterThanOrEqual(8);
    });
  });

  describe('signhify.setApiKey invocation and SecretStorage', () => {
    it('prompts via showInputBox and stores key in SecretStorage', async () => {
      inputBoxResult = 'sk-agent-new-api-key';

      await vscode.commands.executeCommand('signhify.setApiKey');

      expect(vscode.window.showInputBox).toHaveBeenCalledWith(
        expect.objectContaining({
          password: true,
          ignoreFocusOut: true,
        })
      );

      const secretKey = credentialSecretKey('provider.apiKey');
      expect(await context.secrets.get(secretKey)).toBe('sk-agent-new-api-key');
      expect(informationMessages).toContain('Signhify agent key saved in VS Code Secret Storage.');
    });

    it('stores key directly in SecretStorage when passed as argument', async () => {
      await vscode.commands.executeCommand('signhify.setApiKey', 'sk-direct-arg-key');

      expect(vscode.window.showInputBox).not.toHaveBeenCalled();
      const secretKey = credentialSecretKey('provider.apiKey');
      expect(await context.secrets.get(secretKey)).toBe('sk-direct-arg-key');
      expect(informationMessages).toContain('Signhify agent key saved in VS Code Secret Storage.');
    });

    it('clears key from SecretStorage when empty string entered in prompt', async () => {
      // First seed a secret
      const secretKey = credentialSecretKey('provider.apiKey');
      await context.secrets.store(secretKey, 'sk-old-key');

      inputBoxResult = '';
      await vscode.commands.executeCommand('signhify.setApiKey');

      expect(await context.secrets.get(secretKey)).toBeUndefined();
      expect(informationMessages).toContain('Signhify agent key removed.');
    });

    it('does nothing when input box is cancelled (undefined)', async () => {
      const secretKey = credentialSecretKey('provider.apiKey');
      await context.secrets.store(secretKey, 'sk-existing-key');

      inputBoxResult = undefined;
      await vscode.commands.executeCommand('signhify.setApiKey');

      expect(await context.secrets.get(secretKey)).toBe('sk-existing-key');
      expect(informationMessages).toHaveLength(0);
    });
  });

  describe('signhify.setAutocompleteApiKey invocation and SecretStorage', () => {
    it('stores autocomplete API key in SecretStorage', async () => {
      inputBoxResult = 'sk-autocomplete-123';
      await vscode.commands.executeCommand('signhify.setAutocompleteApiKey');

      const secretKey = credentialSecretKey('provider.autocomplete.apiKey');
      expect(await context.secrets.get(secretKey)).toBe('sk-autocomplete-123');
      expect(informationMessages).toContain('Signhify autocomplete key saved in VS Code Secret Storage.');
    });
  });

  describe('signhify.clearApiKey invocation and SecretStorage', () => {
    it('removes provider.apiKey from SecretStorage by default', async () => {
      const secretKey = credentialSecretKey('provider.apiKey');
      await context.secrets.store(secretKey, 'sk-to-be-removed');

      await vscode.commands.executeCommand('signhify.clearApiKey');

      expect(await context.secrets.get(secretKey)).toBeUndefined();
      expect(informationMessages).toContain('Signhify provider.apiKey key removed from VS Code Secret Storage.');
    });

    it('removes specified key from SecretStorage when argument provided', async () => {
      const autoKey = credentialSecretKey('provider.autocomplete.apiKey');
      await context.secrets.store(autoKey, 'sk-auto-remove');

      await vscode.commands.executeCommand('signhify.clearApiKey', 'provider.autocomplete.apiKey');

      expect(await context.secrets.get(autoKey)).toBeUndefined();
      expect(informationMessages).toContain('Signhify provider.autocomplete.apiKey key removed from VS Code Secret Storage.');
    });
  });

  describe('signhify.openSettings invocation', () => {
    it('executes workbench.action.openSettings with signhify', async () => {
      await vscode.commands.executeCommand('signhify.openSettings');

      const openSettingsCall = executedCommands.find(
        (c) => c.command === 'workbench.action.openSettings'
      );
      expect(openSettingsCall).toBeDefined();
      expect(openSettingsCall?.args).toEqual(['signhify']);
    });
  });

  describe('Other Extension Commands', () => {
    it('signhify.switchMode presents quickpick and sets mode', async () => {
      quickPickResult = 'plan';
      await vscode.commands.executeCommand('signhify.switchMode');

      expect(vscode.window.showQuickPick).toHaveBeenCalledWith(
        ['build', 'plan', 'debug', 'compose'],
        expect.objectContaining({ placeHolder: 'Select Signhify mode' })
      );
      expect(informationMessages).toContain('Signhify mode: plan');
    });

    it('signhify.switchMode does nothing when cancelled', async () => {
      quickPickResult = undefined;
      await vscode.commands.executeCommand('signhify.switchMode');
      expect(informationMessages).toHaveLength(0);
    });

    it('signhify.openMemory attempts to open MEMORY.md', async () => {
      await vscode.commands.executeCommand('signhify.openMemory');

      const openCall = executedCommands.find((c) => c.command === 'vscode.open');
      expect(openCall).toBeDefined();
    });

    it('signhify.triggerInlineCompletion triggers inline suggest', async () => {
      await vscode.commands.executeCommand('signhify.triggerInlineCompletion');

      const triggerCall = executedCommands.find(
        (c) => c.command === 'editor.action.inlineSuggest.trigger'
      );
      expect(triggerCall).toBeDefined();
    });

    it('deactivate cleanly finishes', () => {
      expect(() => deactivate()).not.toThrow();
    });
  });
});

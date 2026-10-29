import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MockWorkspaceConfiguration,
  createMockExtensionContext,
  createMockUri,
} from './mock-vscode.js';

// Setup shared workspace mocks for vscode
const globalConfig = new MockWorkspaceConfiguration();
const folderConfigs = new Map<string, MockWorkspaceConfiguration>();
let mockWorkspaceFolders: any[] | undefined;
let mockWorkspaceFile: any | undefined;

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
      get workspaceFolders() {
        return mockWorkspaceFolders;
      },
      get workspaceFile() {
        return mockWorkspaceFile;
      },
      getConfiguration: vi.fn((section?: string, scope?: any) => {
        if (section === 'signhify') {
          if (scope && scope.toString) {
            const uriStr = scope.toString();
            if (!folderConfigs.has(uriStr)) {
              folderConfigs.set(uriStr, new MockWorkspaceConfiguration());
            }
            return folderConfigs.get(uriStr)!;
          }
          return globalConfig;
        }
        return new MockWorkspaceConfiguration();
      }),
      onDidChangeConfiguration: vi.fn(),
    },
    commands: {
      registerCommand: vi.fn(),
      executeCommand: vi.fn(),
    },
    window: {
      showInputBox: vi.fn(),
      showInformationMessage: vi.fn(),
      showWarningMessage: vi.fn(),
      showErrorMessage: vi.fn(),
      showQuickPick: vi.fn(),
    },
  };
});

import {
  credentialSecretKey,
  globalCredentialSecretKey,
  getCredential,
  storeCredential,
  deleteCredential,
  migrateLegacyApiKeys,
} from '../secret-storage.js';

describe('SecretStorage Key Management', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    globalConfig.clear();
    folderConfigs.clear();
    mockWorkspaceFolders = undefined;
    mockWorkspaceFile = undefined;
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe('Key derivation & scoping', () => {
    it('generates consistent hash-scoped keys for global scope', () => {
      const key1 = globalCredentialSecretKey('provider.apiKey');
      const key2 = globalCredentialSecretKey('provider.apiKey');
      expect(key1).toBe(key2);
      expect(key1).toMatch(/^signhify:[a-f0-9]{64}:provider\.apiKey$/);
    });

    it('uses workspace folder URI when available', () => {
      mockWorkspaceFolders = [{ uri: createMockUri('file:///workspace/project-a'), name: 'project-a', index: 0 }];
      const key = credentialSecretKey('provider.apiKey');
      expect(key).toMatch(/^signhify:[a-f0-9]{64}:provider\.apiKey$/);
      // Different from global key
      expect(key).not.toBe(globalCredentialSecretKey('provider.apiKey'));
    });

    it('uses workspace file URI when no workspace folders are set', () => {
      mockWorkspaceFolders = undefined;
      mockWorkspaceFile = createMockUri('file:///workspace/workspace.code-workspace');
      const key = credentialSecretKey('provider.apiKey');
      expect(key).toMatch(/^signhify:[a-f0-9]{64}:provider\.apiKey$/);
      expect(key).not.toBe(globalCredentialSecretKey('provider.apiKey'));
    });

    it('falls back to global scope when neither folder nor workspace file exists', () => {
      mockWorkspaceFolders = undefined;
      mockWorkspaceFile = undefined;
      const key = credentialSecretKey('provider.apiKey');
      expect(key).toBe(globalCredentialSecretKey('provider.apiKey'));
    });

    it('respects explicit scope parameter when provided', () => {
      const explicitScopeKey = credentialSecretKey('provider.apiKey', 'custom-scope-xyz');
      expect(explicitScopeKey).toMatch(/^signhify:[a-f0-9]{64}:provider\.apiKey$/);
      expect(explicitScopeKey).not.toBe(globalCredentialSecretKey('provider.apiKey'));
    });
  });

  describe('Storing, retrieving, and deleting using mocked SecretStorage', () => {
    it('stores and retrieves an API key in SecretStorage', async () => {
      const context = createMockExtensionContext();
      await storeCredential(context, 'provider.apiKey', 'sk-secret-12345');

      const retrieved = await getCredential(context, 'provider.apiKey');
      expect(retrieved).toBe('sk-secret-12345');
    });

    it('stores key with explicit scope and retrieves within same workspace', async () => {
      const folderUri = 'file:///workspace/my-app';
      mockWorkspaceFolders = [{ uri: createMockUri(folderUri), name: 'my-app', index: 0 }];
      const context = createMockExtensionContext();

      await storeCredential(context, 'provider.apiKey', 'sk-scoped-999', folderUri);
      const retrieved = await getCredential(context, 'provider.apiKey');
      expect(retrieved).toBe('sk-scoped-999');
    });

    it('deletes an API key from SecretStorage', async () => {
      const context = createMockExtensionContext();
      await storeCredential(context, 'provider.apiKey', 'sk-to-delete');

      let current = await getCredential(context, 'provider.apiKey');
      expect(current).toBe('sk-to-delete');

      await deleteCredential(context, 'provider.apiKey');
      current = await getCredential(context, 'provider.apiKey');
      expect(current).toBeUndefined();
    });

    it('prefers workspace-scoped secret over global secret', async () => {
      const folderUri = 'file:///workspace/preferred';
      mockWorkspaceFolders = [{ uri: createMockUri(folderUri), name: 'preferred', index: 0 }];
      const context = createMockExtensionContext();

      // Store global key
      await storeCredential(context, 'provider.apiKey', 'sk-global-value', 'global');
      // Store workspace-scoped key
      await storeCredential(context, 'provider.apiKey', 'sk-workspace-value', folderUri);

      const resolved = await getCredential(context, 'provider.apiKey');
      expect(resolved).toBe('sk-workspace-value');
    });

    it('falls back to global SecretStorage when workspace secret is not present', async () => {
      mockWorkspaceFolders = [{ uri: createMockUri('file:///workspace/other'), name: 'other', index: 0 }];
      const context = createMockExtensionContext();

      // Store only in global
      await storeCredential(context, 'provider.apiKey', 'sk-only-global', 'global');

      const resolved = await getCredential(context, 'provider.apiKey');
      expect(resolved).toBe('sk-only-global');
    });
  });

  describe('Memento integration (workspaceState and globalState)', () => {
    it('retrieves API key from workspaceState if SecretStorage is empty', async () => {
      const context = createMockExtensionContext();
      await context.workspaceState.update('provider.apiKey', 'sk-memento-workspace');

      const result = await getCredential(context, 'provider.apiKey');
      expect(result).toBe('sk-memento-workspace');
    });

    it('retrieves API key from globalState if SecretStorage and workspaceState are empty', async () => {
      const context = createMockExtensionContext();
      await context.globalState.update('provider.apiKey', 'sk-memento-global');

      const result = await getCredential(context, 'provider.apiKey');
      expect(result).toBe('sk-memento-global');
    });

    it('prefers SecretStorage over Memento values', async () => {
      const context = createMockExtensionContext();
      await context.globalState.update('provider.apiKey', 'sk-memento-old');
      await storeCredential(context, 'provider.apiKey', 'sk-secret-new');

      const result = await getCredential(context, 'provider.apiKey');
      expect(result).toBe('sk-secret-new');
    });

    it('cleans up Memento values when deleteCredential is called', async () => {
      const context = createMockExtensionContext();
      await storeCredential(context, 'provider.apiKey', 'sk-secret-val');
      await context.workspaceState.update('provider.apiKey', 'sk-workspace-leftover');
      await context.globalState.update('provider.apiKey', 'sk-global-leftover');

      await deleteCredential(context, 'provider.apiKey');

      expect(await getCredential(context, 'provider.apiKey')).toBeUndefined();
      expect(context.workspaceState.get('provider.apiKey')).toBeUndefined();
      expect(context.globalState.get('provider.apiKey')).toBeUndefined();
    });
  });

  describe('Fallback to process.env', () => {
    it('falls back to SIGNHIFY_API_KEY for provider.apiKey', async () => {
      const context = createMockExtensionContext();
      process.env.SIGNHIFY_API_KEY = 'sk-signhify-env';

      const key = await getCredential(context, 'provider.apiKey');
      expect(key).toBe('sk-signhify-env');
    });

    it('falls back to OPENAI_API_KEY when SIGNHIFY_API_KEY is not set', async () => {
      const context = createMockExtensionContext();
      delete process.env.SIGNHIFY_API_KEY;
      process.env.OPENAI_API_KEY = 'sk-openai-env';

      const key = await getCredential(context, 'provider.apiKey');
      expect(key).toBe('sk-openai-env');
    });

    it('falls back to ANTHROPIC_API_KEY when earlier envs are absent', async () => {
      const context = createMockExtensionContext();
      delete process.env.SIGNHIFY_API_KEY;
      delete process.env.OPENAI_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'sk-anthropic-env';

      const key = await getCredential(context, 'provider.apiKey');
      expect(key).toBe('sk-anthropic-env');
    });

    it('falls back to SIGNHIFY_AUTOCOMPLETE_API_KEY for autocomplete', async () => {
      const context = createMockExtensionContext();
      process.env.SIGNHIFY_AUTOCOMPLETE_API_KEY = 'sk-auto-env';

      const key = await getCredential(context, 'provider.autocomplete.apiKey');
      expect(key).toBe('sk-auto-env');
    });

    it('falls back to SIGNHIFY_API_KEY for autocomplete when specific key is unset', async () => {
      const context = createMockExtensionContext();
      delete process.env.SIGNHIFY_AUTOCOMPLETE_API_KEY;
      process.env.SIGNHIFY_API_KEY = 'sk-shared-key';

      const key = await getCredential(context, 'provider.autocomplete.apiKey');
      expect(key).toBe('sk-shared-key');
    });

    it('falls back to normalized env var name for arbitrary secret', async () => {
      const context = createMockExtensionContext();
      process.env.CUSTOM_KEY = 'custom-val';

      const key = await getCredential(context, 'custom_key');
      expect(key).toBe('custom-val');
    });

    it('SecretStorage takes precedence over process.env', async () => {
      const context = createMockExtensionContext();
      process.env.SIGNHIFY_API_KEY = 'sk-env-ignored';
      await storeCredential(context, 'provider.apiKey', 'sk-secret-preferred');

      const key = await getCredential(context, 'provider.apiKey');
      expect(key).toBe('sk-secret-preferred');
    });

    it('returns undefined when neither storage, memento, nor env var exists', async () => {
      const context = createMockExtensionContext();
      delete process.env.SIGNHIFY_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;

      const key = await getCredential(context, 'provider.apiKey');
      expect(key).toBeUndefined();
    });
  });

  describe('Migration from legacy plaintext settings to SecretStorage', () => {
    it('migrates global plaintext setting to SecretStorage and clears the plaintext config', async () => {
      const context = createMockExtensionContext();
      globalConfig.setInspect('provider.apiKey', {
        globalValue: 'legacy-plaintext-key-global',
      });

      await migrateLegacyApiKeys(context);

      // Secret should now be in SecretStorage
      const secret = await getCredential(context, 'provider.apiKey');
      expect(secret).toBe('legacy-plaintext-key-global');

      // Legacy inspect should have been wiped
      expect(globalConfig.inspect('provider.apiKey')?.globalValue).toBeUndefined();
    });

    it('migrates workspace plaintext setting to SecretStorage under workspace scope', async () => {
      mockWorkspaceFolders = [{ uri: createMockUri('file:///workspace/project-legacy'), name: 'project-legacy', index: 0 }];
      const context = createMockExtensionContext();

      globalConfig.setInspect('provider.apiKey', {
        workspaceValue: 'legacy-workspace-key',
      });

      await migrateLegacyApiKeys(context);

      const secret = await getCredential(context, 'provider.apiKey');
      expect(secret).toBe('legacy-workspace-key');
      expect(globalConfig.inspect('provider.apiKey')?.workspaceValue).toBeUndefined();
    });

    it('migrates workspaceFolder settings to SecretStorage and clears them', async () => {
      const folderUriStr = 'file:///workspace/multi-root-folder';
      const folderUri = createMockUri(folderUriStr);
      mockWorkspaceFolders = [{ uri: folderUri, name: 'multi-root-folder', index: 0 }];

      const folderConfig = new MockWorkspaceConfiguration();
      folderConfig.setInspect('provider.apiKey', {
        workspaceFolderValue: 'legacy-folder-key-abc',
      });
      folderConfigs.set(folderUriStr, folderConfig);

      const context = createMockExtensionContext();
      await migrateLegacyApiKeys(context);

      const secret = await getCredential(context, 'provider.apiKey');
      expect(secret).toBe('legacy-folder-key-abc');
      expect(folderConfig.inspect('provider.apiKey')?.workspaceFolderValue).toBeUndefined();
    });

    it('migrates autocomplete legacy API keys', async () => {
      const context = createMockExtensionContext();
      globalConfig.setInspect('provider.autocomplete.apiKey', {
        globalValue: 'legacy-autocomplete-key',
      });

      await migrateLegacyApiKeys(context);

      const secret = await getCredential(context, 'provider.autocomplete.apiKey');
      expect(secret).toBe('legacy-autocomplete-key');
      expect(globalConfig.inspect('provider.autocomplete.apiKey')?.globalValue).toBeUndefined();
    });

    it('does not overwrite existing SecretStorage value during migration, but still clears plaintext', async () => {
      const context = createMockExtensionContext();
      // Secret already stored securely
      await storeCredential(context, 'provider.apiKey', 'already-secure-key', 'global');

      // Stale plaintext setting left behind in config
      globalConfig.setInspect('provider.apiKey', {
        globalValue: 'old-stale-plaintext-key',
      });

      await migrateLegacyApiKeys(context);

      // Existing secret remains untouched
      const secret = await getCredential(context, 'provider.apiKey');
      expect(secret).toBe('already-secure-key');

      // Stale plaintext is still cleaned up to prevent plaintext leakage
      expect(globalConfig.inspect('provider.apiKey')?.globalValue).toBeUndefined();
    });

    it('migrates legacy Memento globalState and workspaceState to SecretStorage', async () => {
      const context = createMockExtensionContext();
      await context.globalState.update('provider.apiKey', 'legacy-memento-global-key');
      await context.workspaceState.update('provider.autocomplete.apiKey', 'legacy-memento-ws-key');

      await migrateLegacyApiKeys(context);

      // Should be migrated into SecretStorage
      const globalSecret = await getCredential(context, 'provider.apiKey');
      const wsSecret = await getCredential(context, 'provider.autocomplete.apiKey');

      expect(globalSecret).toBe('legacy-memento-global-key');
      expect(wsSecret).toBe('legacy-memento-ws-key');

      // And removed from Memento
      expect(context.globalState.get('provider.apiKey')).toBeUndefined();
      expect(context.workspaceState.get('provider.autocomplete.apiKey')).toBeUndefined();
    });

    it('handles clean configuration without crashing', async () => {
      const context = createMockExtensionContext();
      await expect(migrateLegacyApiKeys(context)).resolves.not.toThrow();
    });
  });
});

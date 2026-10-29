import * as vscode from 'vscode';
import { createHash } from 'node:crypto';

const legacySettings = ['provider.apiKey', 'provider.autocomplete.apiKey'] as const;

function scopedSecretKey(name: string, scope: string): string {
  const scopeHash = createHash('sha256').update(scope).digest('hex');
  return `signhify:${scopeHash}:${name}`;
}

export function credentialSecretKey(name: string, scope?: string): string {
  const target = scope
    ?? vscode.workspace.workspaceFolders?.[0]?.uri.toString()
    ?? vscode.workspace.workspaceFile?.toString()
    ?? 'global';
  return scopedSecretKey(name, target);
}

export function globalCredentialSecretKey(name: string): string {
  return scopedSecretKey(name, 'global');
}

function resolveEnvFallback(name: string): string | undefined {
  if (process.env[name]) {
    return process.env[name];
  }

  if (name === 'provider.apiKey') {
    return process.env.SIGNHIFY_API_KEY
      ?? process.env.OPENAI_API_KEY
      ?? process.env.ANTHROPIC_API_KEY;
  }

  if (name === 'provider.autocomplete.apiKey') {
    return process.env.SIGNHIFY_AUTOCOMPLETE_API_KEY
      ?? process.env.SIGNHIFY_API_KEY
      ?? process.env.OPENAI_API_KEY;
  }

  const normalized = name.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();
  return process.env[`SIGNHIFY_${normalized}`] ?? process.env[normalized];
}

export async function storeCredential(
  context: vscode.ExtensionContext,
  name: string,
  value: string,
  scope?: string,
): Promise<void> {
  const secretKey = credentialSecretKey(name, scope);
  await context.secrets.store(secretKey, value);
}

export async function deleteCredential(
  context: vscode.ExtensionContext,
  name: string,
  scope?: string,
): Promise<void> {
  const secretKey = credentialSecretKey(name, scope);
  await context.secrets.delete(secretKey);
  await context.workspaceState?.update(name, undefined);
  await context.globalState?.update(name, undefined);
}

export async function getCredential(context: vscode.ExtensionContext, name: string): Promise<string | undefined> {
  const scopes = [
    ...(vscode.workspace.workspaceFolders?.slice(0, 1).map((folder) => folder.uri.toString()) ?? []),
    vscode.workspace.workspaceFile?.toString(),
    'global',
  ];
  for (const scope of new Set(scopes.filter((value): value is string => Boolean(value)))) {
    const value = await context.secrets.get(scopedSecretKey(name, scope));
    if (value !== undefined) return value;
  }

  const workspaceMemento = context.workspaceState?.get<string>(name);
  if (workspaceMemento !== undefined) return workspaceMemento;

  const globalMemento = context.globalState?.get<string>(name);
  if (globalMemento !== undefined) return globalMemento;

  return resolveEnvFallback(name);
}

export async function migrateLegacyApiKeys(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration('signhify');
  const workspaceScope = vscode.workspace.workspaceFile?.toString()
    ?? vscode.workspace.workspaceFolders?.[0]?.uri.toString()
    ?? 'global';

  for (const setting of legacySettings) {
    const inspect = config.inspect<string>(setting);

    const migrate = async (
      targetConfig: vscode.WorkspaceConfiguration,
      value: unknown,
      target: vscode.ConfigurationTarget,
      secretKey: string,
    ) => {
      if (typeof value !== 'string') return;
      if (value && !(await context.secrets.get(secretKey))) await context.secrets.store(secretKey, value);
      await targetConfig.update(setting, undefined, target);
    };

    if (inspect) {
      await migrate(config, inspect.globalValue, vscode.ConfigurationTarget.Global, globalCredentialSecretKey(setting));
      await migrate(config, inspect.workspaceValue, vscode.ConfigurationTarget.Workspace, credentialSecretKey(setting, workspaceScope));
    }

    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const folderConfig = vscode.workspace.getConfiguration('signhify', folder.uri);
      const folderValue = folderConfig.inspect<string>(setting)?.workspaceFolderValue;
      await migrate(folderConfig, folderValue, vscode.ConfigurationTarget.WorkspaceFolder, credentialSecretKey(setting, folder.uri.toString()));
    }
  }

  if (context.globalState) {
    for (const setting of legacySettings) {
      const val = context.globalState.get<string>(setting);
      if (val && typeof val === 'string') {
        const secretKey = globalCredentialSecretKey(setting);
        if (!(await context.secrets.get(secretKey))) {
          await context.secrets.store(secretKey, val);
        }
        await context.globalState.update(setting, undefined);
      }
    }
  }

  if (context.workspaceState) {
    for (const setting of legacySettings) {
      const val = context.workspaceState.get<string>(setting);
      if (val && typeof val === 'string') {
        const secretKey = credentialSecretKey(setting, workspaceScope);
        if (!(await context.secrets.get(secretKey))) {
          await context.secrets.store(secretKey, val);
        }
        await context.workspaceState.update(setting, undefined);
      }
    }
  }
}

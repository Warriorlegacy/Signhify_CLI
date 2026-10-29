import { vi } from 'vitest';
import type * as vscode from 'vscode';

export class MockSecretStorage implements vscode.SecretStorage {
  private secrets = new Map<string, string>();
  public readonly onDidChange = vi.fn();

  async keys(): Promise<string[]> {
    return Array.from(this.secrets.keys());
  }

  async get(key: string): Promise<string | undefined> {
    return this.secrets.get(key);
  }

  async store(key: string, value: string): Promise<void> {
    this.secrets.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.secrets.delete(key);
  }

  dump(): Map<string, string> {
    return new Map(this.secrets);
  }

  clear(): void {
    this.secrets.clear();
  }
}

export class MockMemento implements vscode.Memento {
  private storage = new Map<string, any>();

  keys(): readonly string[] {
    return Array.from(this.storage.keys());
  }

  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  get<T>(key: string, defaultValue?: T): T | undefined {
    return this.storage.has(key) ? (this.storage.get(key) as T) : defaultValue;
  }

  async update(key: string, value: any): Promise<void> {
    if (value === undefined) {
      this.storage.delete(key);
    } else {
      this.storage.set(key, value);
    }
  }

  setKeysForSync(_keys: readonly string[]): void {}

  clear(): void {
    this.storage.clear();
  }

  dump(): Map<string, any> {
    return new Map(this.storage);
  }
}

export interface InspectData<T> {
  key: string;
  defaultValue?: T;
  globalValue?: T;
  workspaceValue?: T;
  workspaceFolderValue?: T;
}

export class MockWorkspaceConfiguration implements vscode.WorkspaceConfiguration {
  private values = new Map<string, any>();
  private inspectRecords = new Map<string, InspectData<any>>();

  readonly [key: string]: any;

  get<T>(section: string, defaultValue?: T): T {
    if (this.values.has(section)) {
      return this.values.get(section);
    }
    const inspect = this.inspectRecords.get(section);
    if (inspect) {
      const val = inspect.workspaceFolderValue ?? inspect.workspaceValue ?? inspect.globalValue ?? inspect.defaultValue;
      if (val !== undefined) return val as T;
    }
    return defaultValue as T;
  }

  has(section: string): boolean {
    return this.values.has(section) || this.inspectRecords.has(section);
  }

  inspect<T>(section: string): InspectData<T> | undefined {
    return this.inspectRecords.get(section);
  }

  async update(section: string, value: any, configurationTarget?: vscode.ConfigurationTarget): Promise<void> {
    if (value === undefined) {
      this.values.delete(section);
    } else {
      this.values.set(section, value);
    }

    const current = this.inspectRecords.get(section) ?? { key: section };
    if (configurationTarget === 1 /* Global */) {
      current.globalValue = value;
    } else if (configurationTarget === 2 /* Workspace */) {
      current.workspaceValue = value;
    } else if (configurationTarget === 3 /* WorkspaceFolder */) {
      current.workspaceFolderValue = value;
    }
    this.inspectRecords.set(section, current);
  }

  setInspect<T>(section: string, data: Partial<InspectData<T>>): void {
    this.inspectRecords.set(section, { key: section, ...data });
    const resolved = data.workspaceFolderValue ?? data.workspaceValue ?? data.globalValue ?? data.defaultValue;
    if (resolved !== undefined) {
      this.values.set(section, resolved);
    }
  }

  setValue(section: string, value: any): void {
    this.values.set(section, value);
  }

  clear(): void {
    this.values.clear();
    this.inspectRecords.clear();
  }
}

export function createMockUri(uriString: string): vscode.Uri {
  const isFile = uriString.startsWith('file://');
  const pathPart = isFile ? uriString.replace('file://', '') : uriString;
  return {
    scheme: isFile ? 'file' : 'untitled',
    authority: '',
    path: pathPart,
    query: '',
    fragment: '',
    fsPath: pathPart.replace(/\//g, '\\'),
    with: vi.fn(),
    toString: () => (uriString.startsWith('file://') ? uriString : `file://${uriString}`),
    toJSON: () => ({ scheme: 'file', path: pathPart }),
  } as unknown as vscode.Uri;
}

export function createMockExtensionContext(options?: {
  secrets?: MockSecretStorage;
  workspaceState?: MockMemento;
  globalState?: MockMemento;
}): vscode.ExtensionContext & {
  mockSecrets: MockSecretStorage;
  mockWorkspaceState: MockMemento;
  mockGlobalState: MockMemento;
} {
  const secrets = options?.secrets ?? new MockSecretStorage();
  const workspaceState = options?.workspaceState ?? new MockMemento();
  const globalState = options?.globalState ?? new MockMemento();
  const subscriptions: { dispose: () => any }[] = [];

  const context: any = {
    subscriptions,
    workspaceState,
    globalState,
    secrets,
    extensionUri: { fsPath: '/mock/ext', toString: () => 'file:///mock/ext' },
    extensionPath: '/mock/ext',
    storageUri: { fsPath: '/mock/storage', toString: () => 'file:///mock/storage' },
    storagePath: '/mock/storage',
    globalStorageUri: { fsPath: '/mock/globalStorage', toString: () => 'file:///mock/globalStorage' },
    globalStoragePath: '/mock/globalStorage',
    logUri: { fsPath: '/mock/log', toString: () => 'file:///mock/log' },
    logPath: '/mock/log',
    extensionMode: 1,
    environmentVariableCollection: {
      persistent: true,
      replace: vi.fn(),
      append: vi.fn(),
      prepend: vi.fn(),
      get: vi.fn(),
      forEach: vi.fn(),
      delete: vi.fn(),
      clear: vi.fn(),
      [Symbol.iterator]: vi.fn(),
    },
    asAbsolutePath: (rel: string) => `/mock/ext/${rel}`,
    extension: {
      id: 'signhify.signhify',
      extensionUri: { fsPath: '/mock/ext', toString: () => 'file:///mock/ext' },
      extensionPath: '/mock/ext',
      isActive: true,
      packageJSON: {},
      exports: undefined,
      activate: vi.fn(),
      extensionKind: 1,
    },
    mockSecrets: secrets,
    mockWorkspaceState: workspaceState,
    mockGlobalState: globalState,
  };

  return context;
}

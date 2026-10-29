export interface ToolHandler {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  requiresConsent?: boolean | ((args: Record<string, unknown>) => boolean);
  preview?(args: Record<string, unknown>, context: { workingDirectory: string; projectDir?: string; autoMode?: boolean }): Promise<string>;
  execute(args: Record<string, unknown>, context: {
    workingDirectory: string;
    projectDir?: string;
    autoMode?: boolean;
    confirm?: (message: string) => Promise<boolean>;
    consentGranted?: boolean;
    approvedPreview?: string;
    signal?: AbortSignal;
    invokeTool?: (name: 'file-io' | 'shell-exec', args: Record<string, unknown>) => Promise<{ content: string; isError?: boolean }>;
  }): Promise<string>;
}

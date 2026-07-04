export interface ToolHandler {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  requiresConsent?: boolean;
  execute(args: Record<string, unknown>, context: { workingDirectory: string; projectDir?: string; autoMode?: boolean }): Promise<string>;
}

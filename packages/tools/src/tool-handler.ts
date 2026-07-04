export interface ToolHandler {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>, context: { workingDirectory: string }): Promise<string>;
}

export type PackageManager = 'curl' | 'powershell' | 'npm' | 'pnpm' | 'bun';

export const INSTALL_COMMANDS: Record<PackageManager, string> = {
  curl: 'curl -fsSL https://signhify-cli.vercel.app/install.sh | bash',
  powershell: 'irm https://signhify-cli.vercel.app/install.ps1 | iex',
  npm: 'npm install -g @signhify/cli',
  pnpm: 'pnpm add -g @signhify/cli',
  bun: 'bun add -g @signhify/cli',
};

export function getInstallCommand(pm: PackageManager): string {
  return INSTALL_COMMANDS[pm] || INSTALL_COMMANDS.curl;
}


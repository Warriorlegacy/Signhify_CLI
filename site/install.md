# Install Signhify

<p align="center">
  <img src="/assets/logos/signhify-logo.png" alt="Signhify" width="320">
</p>

## Prerequisites

- Node.js 20+
- npm 9+

## npm (global)

```bash
npm install -g @signhify/cli
signhify wizard
```

## npm (on demand)

```bash
npx signhify run "explain this codebase" --mode plan
```

## Windows (PowerShell)

```powershell
irm https://signhify-cli.vercel.app/install.ps1 | iex
```

## macOS / Linux (curl)

```bash
curl -fsSL https://signhify-cli.vercel.app/install.sh | bash
```

## From source

```bash
git clone https://github.com/Warriorlegacy/Signhify_CLI.git
cd Signhify_CLI
npm install
npm run build
```

# Install Signhify

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
irm https://signhify.dpdns.org/install.ps1 | iex
```

## macOS / Linux (curl)

```bash
curl -fsSL https://signhify.dpdns.org/install.sh | bash
```

## From source

```bash
git clone https://github.com/Warriorlegacy/Signhify_CLI.git
cd Signhify_CLI
npm install
npm run build
```

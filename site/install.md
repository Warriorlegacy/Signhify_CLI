# Install Signhify

<p align="center">
  <img src="/assets/logos/signhify-logo.png" alt="Signhify" width="320">
</p>

## Universal Single Installation Command (All OS)

The recommended, zero-friction install across **macOS, Linux, and Windows**:

```bash
npm install -g @signhify/cli
```

Once installed, start the interactive onboarding wizard:

```bash
signhify wizard
```

### Instant Execution (Zero Install)

Run Signhify on demand without a global installation on any OS:

```bash
npx @signhify/cli
```

---

## Prerequisites

- Node.js 20+
- npm 9+

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

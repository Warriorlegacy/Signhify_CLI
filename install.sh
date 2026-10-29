#!/usr/bin/env bash
# Signhify Install Script (macOS / Linux)
# Usage: curl -fsSL https://signhify-cli.vercel.app/install.sh | bash

set -euo pipefail

REPO="Warriorlegacy/Signhify_CLI"
PACKAGE="@signhify/cli"
VERSION="${1:-latest}"

echo "┌─────────────────────────────────────────────┐"
echo "│           Signhify Installer                 │"
echo "└─────────────────────────────────────────────┘"

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "✗ Node.js is required. Install from https://nodejs.org (v20+)"
    exit 1
fi

echo "✓ Node.js detected: $(node --version)"
NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [[ "$NODE_MAJOR" -lt 20 ]]; then
    echo "✗ Node.js 20 or newer is required (found $(node --version))." >&2
    exit 1
fi

# Install via npm
echo "Installing ${PACKAGE}@${VERSION} ..."
if [ "$VERSION" = "latest" ]; then
    npm install -g "${PACKAGE}" || { echo "✗ Installation failed. Check npm output and try again." >&2; exit 1; }
else
    npm install -g "${PACKAGE}@${VERSION}" || { echo "✗ Installation failed. Check npm output and try again." >&2; exit 1; }
fi

echo "✓ Installation complete!"
echo ""
echo "Run 'signhify --help' to get started."
echo "Run 'signhify wizard' for first-time setup."

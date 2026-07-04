#!/usr/bin/env bash
# Signhify Install Script (macOS / Linux)
# Usage: curl -fsSL https://signhify.dev/install.sh | bash

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

# Install via npm
echo "Installing ${PACKAGE}@${VERSION} ..."
if [ "$VERSION" = "latest" ]; then
    npm install -g "${PACKAGE}"
else
    npm install -g "${PACKAGE}@${VERSION}"
fi

echo "✓ Installation complete!"
echo ""
echo "Run 'signhify --help' to get started."
echo "Run 'signhify wizard' for first-time setup."

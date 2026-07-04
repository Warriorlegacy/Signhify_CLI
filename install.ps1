#!/usr/bin/env pwsh
# Signhify Install Script (Windows)
# Usage: irm https://signhify.dev/install.ps1 | iex

$ErrorActionPreference = "Stop"

$Repo = "Warriorlegacy/Signhify_CLI"
$Package = "@signhify/cli"

Write-Host "┌─────────────────────────────────────────────┐"
Write-Host "│           Signhify Installer (Windows)       │"
Write-Host "└─────────────────────────────────────────────┘"

# Check Node.js
try {
    $nodeVersion = node --version
    Write-Host "✓ Node.js detected: $nodeVersion"
} catch {
    Write-Host "✗ Node.js is required. Install from https://nodejs.org (v20+)"
    exit 1
}

# Parse version from package.json
if ($args[0]) {
    $Version = $args[0]
    Write-Host "Installing version: $Version"
} else {
    $Version = "latest"
    Write-Host "Installing latest version"
}

# Install via npm
Write-Host "Installing $Package@$Version ..."
try {
    npm install -g "$Package@$Version"
    Write-Host "✓ Installation complete!"
    Write-Host ""
    Write-Host "Run 'signhify --help' to get started."
    Write-Host "Run 'signhify wizard' for first-time setup."
} catch {
    Write-Host "✗ Installation failed: $_"
    exit 1
}

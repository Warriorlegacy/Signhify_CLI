import React from "react";
import { Box, Text } from "ink";
import { execSync } from "node:child_process";
import * as path from "node:path";
import { createRequire } from "node:module";
import { type Theme, getTheme } from "./theme.js";

let CLI_VERSION = "0.3.2";
try {
  const req = createRequire(import.meta.url);
  const pkg = req("../../package.json") as { version?: string };
  if (pkg?.version) {
    CLI_VERSION = pkg.version;
  }
} catch {
  // Safe fallback if package.json cannot be read via require in bundler
}

/**
 * Returns the current git branch name using `git rev-parse --abbrev-ref HEAD`,
 * or null if not inside a git repository or git command is unavailable.
 */
export function getGitBranch(cwd: string = process.cwd()): string | null {
  try {
    const stdout = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
      timeout: 1000,
    });
    const branch = stdout.trim();
    return branch && branch !== "HEAD" ? branch : null;
  } catch {
    return null;
  }
}

/**
 * Returns the leaf folder name of the specified directory path.
 */
export function getLeafDirectory(cwd: string = process.cwd()): string {
  try {
    const normalized = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
    const leaf = path.posix.basename(normalized);
    return leaf || "workspace";
  } catch {
    return "workspace";
  }
}

/**
 * Returns the accent color for the given agent mode, adhering to theme tokens.
 */
export function getModeColor(mode: string = "build", theme?: Theme): string {
  const m = mode.trim().toLowerCase();
  if (theme?.modes) {
    if (m === "build") return theme.modes.build;
    if (m === "plan") return theme.modes.plan;
    if (m === "debug") return theme.modes.debug;
    if (m === "compose") return theme.modes.compose;
  }

  switch (m) {
    case "plan":
      return "yellow";
    case "debug":
      return "red";
    case "compose":
      return "magenta";
    case "build":
    default:
      return "green";
  }
}

export type HeaderMode = "build" | "plan" | "debug" | "compose" | string;

export const DEFAULT_BREADCRUMBS =
  "Tab: Mode | Ctrl+M: Model | Ctrl+P: Cmds | Ctrl+B: Sidebar | Esc: Cancel";

export interface HeaderProps {
  version?: string;
  mode?: HeaderMode;
  themeName?: string;
  theme?: Theme;
  modelName?: string;
  provider?: string;
  cwd?: string;
  branch?: string | null;
  breadcrumbs?: string;
  goal?: string;
}

/**
 * Glowing modern header component for Signhify CLI TUI.
 *
 * Left: Brand icon `✦ SIGNHIFY AI` bold white, version `v${CLI_VERSION}`,
 * active mode pill badge `[BUILD]`, directory leaf `📂 ${folder}`, and git branch `⎇ ${branch}`.
 * Right: Active model `● ${modelName}`, provider `[${provider}]`, and theme tag `🎨 ${themeName}`.
 * Subtitle: Hotkey breadcrumbs.
 */
export function Header({
  version = CLI_VERSION,
  mode = "build",
  cwd = process.cwd(),
  branch,
  modelName = "claude-3-5-sonnet",
  provider = "anthropic",
  themeName = "signhify-dark",
  theme,
  breadcrumbs = DEFAULT_BREADCRUMBS,
  goal,
}: HeaderProps): React.ReactElement {
  const resolvedTheme = theme ?? getTheme(themeName);
  const activeBranch = branch !== undefined ? branch : getGitBranch(cwd);
  const leafDir = getLeafDirectory(cwd);
  const modeColor = getModeColor(mode, resolvedTheme);

  return React.createElement(
    Box,
    { flexDirection: "column", marginBottom: 1 },
    // Top Row: Brand & Status on Left, Model & Theme on Right
    React.createElement(
      Box,
      { flexDirection: "row", justifyContent: "space-between" },
      // Left Cluster
      React.createElement(
        Box,
        { flexDirection: "row" },
        React.createElement(Text, { bold: true, color: "white" }, "✦ SIGNHIFY AI"),
        React.createElement(Text, { color: resolvedTheme.muted }, ` v${version}`),
        React.createElement(Text, { bold: true, color: modeColor }, ` [${mode.toUpperCase()}]`),
        React.createElement(
          Text,
          { color: resolvedTheme.primary },
          ` 📂 ${leafDir}`
        ),
        activeBranch
          ? React.createElement(
              Text,
              { color: resolvedTheme.secondary },
              ` ⎇ ${activeBranch}`
            )
          : null,
        goal
          ? React.createElement(
              Text,
              { color: resolvedTheme.modes.plan, bold: true },
              ` 🎯 "${goal}"`
            )
          : null
      ),
      // Right Cluster
      React.createElement(
        Box,
        { flexDirection: "row" },
        React.createElement(
          Text,
          { bold: true, color: resolvedTheme.primary },
          `● ${modelName}`
        ),
        React.createElement(
          Text,
          { color: resolvedTheme.muted },
          ` [${provider}]`
        ),
        React.createElement(
          Text,
          { color: resolvedTheme.modes.plan },
          ` 🎨 ${resolvedTheme.name}`
        )
      )
    ),
    // Subtitle / Hotkey Breadcrumbs
    React.createElement(
      Box,
      { marginTop: 0 },
      React.createElement(Text, { color: resolvedTheme.muted }, breadcrumbs)
    )
  );
}

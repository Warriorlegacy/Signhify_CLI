import React from "react";
import type { ReactElement } from "react";
import { Box, Text } from "ink";

export type ToolStatus = "running" | "completed" | "failed";

export interface ToolCardProps {
  toolName: string;
  args?: Record<string, any> | string;
  status: ToolStatus;
  output?: string;
  error?: string;
  diff?: string;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

/**
 * Returns a recognizable icon for common tools (like Cline and Antigravity).
 */
export function getToolIcon(toolName: string): string {
  const name = toolName.toLowerCase();
  if (name.includes("read") || name.includes("file_io")) return "⚡";
  if (name.includes("shell") || name.includes("exec") || name.includes("terminal") || name.includes("bash")) return "💻";
  if (name.includes("search") || name.includes("grep") || name.includes("find")) return "🔍";
  if (name.includes("write") || name.includes("patch") || name.includes("create")) return "📁";
  if (name.includes("git")) return "◈";
  if (name.includes("browser") || name.includes("web") || name.includes("fetch")) return "🌐";
  if (name.includes("subagent") || name.includes("agent") || name.includes("delegate")) return "🤖";
  return "⚡";
}

/**
 * Formats tool arguments into a concise single-line summary.
 */
export function formatToolArgs(
  toolName: string,
  args?: Record<string, any> | string,
): string {
  if (!args) return "";

  let obj: Record<string, any> = {};
  if (typeof args === "string") {
    try {
      obj = JSON.parse(args);
    } catch {
      return args.length > 50 ? args.slice(0, 47) + "…" : args;
    }
  } else if (typeof args === "object" && args !== null) {
    obj = args;
  }

  const name = toolName.toLowerCase();
  let summary = "";

  if (
    name.includes("read") ||
    name.includes("write") ||
    name.includes("patch") ||
    name.includes("file")
  ) {
    const file =
      obj.path || obj.file_path || obj.filePath || obj.file || obj.target;
    if (file) summary = `path: ${file}`;
  } else if (
    name.includes("shell") ||
    name.includes("exec") ||
    name.includes("bash") ||
    name.includes("terminal")
  ) {
    const cmd = obj.command || obj.cmd || obj.script;
    if (cmd) summary = `command: ${cmd}`;
  } else if (
    name.includes("search") ||
    name.includes("grep") ||
    name.includes("find")
  ) {
    const pat = obj.pattern || obj.query || obj.regex;
    if (pat) summary = `pattern: ${pat}`;
  } else if (name.includes("git")) {
    const action = obj.action || obj.subcommand || obj.command || "";
    summary = action ? `action: ${action}` : "";
  } else if (name.includes("browser") || name.includes("web")) {
    const url = obj.url || obj.link || obj.query;
    if (url) summary = `url: ${url}`;
  } else if (name.includes("subagent") || name.includes("agent")) {
    const task = obj.task || obj.role || obj.prompt;
    if (task) summary = `task: ${task}`;
  }

  if (!summary) {
    const parts = Object.entries(obj).map(([k, v]) => {
      const valStr = typeof v === "object" ? JSON.stringify(v) : String(v);
      return `${k}: ${valStr}`;
    });
    summary = parts.join(", ");
  }

  return summary.length > 50 ? summary.slice(0, 47) + "…" : summary;
}

/**
 * Status badge formatting helper.
 */
export function getToolStatusBadge(
  status: ToolStatus,
  error?: string,
): { label: string; color: "yellow" | "green" | "red"; icon: string } {
  switch (status) {
    case "running":
      return { icon: "⠋", label: "Running...", color: "yellow" };
    case "completed":
      return { icon: "✓", label: "Completed", color: "green" };
    case "failed":
      return {
        icon: "✗",
        label: error ? `Failed: ${error}` : "Failed",
        color: "red",
      };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Unified Diff Viewer
// ─────────────────────────────────────────────────────────────────────────────

export interface DiffLine {
  type: "add" | "delete" | "context" | "header" | "hunk";
  content: string;
  oldLine?: number;
  newLine?: number;
}

/**
 * Parses unified diff text into structured lines with line numbering.
 */
export function parseDiff(diffText: string): DiffLine[] {
  if (!diffText) return [];
  const lines = diffText.split(/\r?\n/);
  const result: DiffLine[] = [];
  let oldCursor = 1;
  let newCursor = 1;

  for (const line of lines) {
    // Header lines: ---, +++, diff --git, index
    if (
      line.startsWith("---") ||
      line.startsWith("+++") ||
      line.startsWith("diff --git") ||
      line.startsWith("index ")
    ) {
      result.push({ type: "header", content: line });
      continue;
    }

    // Hunk headers: @@ -1,5 +1,6 @@
    const hunkMatch = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@(.*)$/);
    if (hunkMatch) {
      oldCursor = parseInt(hunkMatch[1], 10);
      newCursor = parseInt(hunkMatch[2], 10);
      result.push({ type: "hunk", content: line });
      continue;
    }

    // Added line
    if (line.startsWith("+")) {
      result.push({
        type: "add",
        content: line.slice(1),
        newLine: newCursor++,
      });
      continue;
    }

    // Deleted line
    if (line.startsWith("-")) {
      result.push({
        type: "delete",
        content: line.slice(1),
        oldLine: oldCursor++,
      });
      continue;
    }

    // Context line
    result.push({
      type: "context",
      content: line.startsWith(" ") ? line.slice(1) : line,
      oldLine: oldCursor++,
      newLine: newCursor++,
    });
  }

  return result;
}

export interface DiffViewerProps {
  diff: string;
  maxLines?: number;
  filePath?: string;
}

/**
 * Renders unified diffs with line numbers in gray, additions in green, and deletions in red.
 */
export function DiffViewer({
  diff,
  maxLines = 100,
  filePath,
}: DiffViewerProps): ReactElement {
  const parsed = parseDiff(diff);
  const displayLines = parsed.slice(0, maxLines);

  return React.createElement(
    Box,
    {
      flexDirection: "column",
      borderStyle: "round",
      borderColor: "gray",
      paddingX: 1,
      marginY: 1,
    },
    React.createElement(
      Box,
      { marginBottom: 0, justifyContent: "space-between" },
      React.createElement(
        Text,
        { color: "gray", dimColor: true },
        filePath ? `Diff: ${filePath}` : "Unified Diff",
      ),
      parsed.length > maxLines
        ? React.createElement(
            Text,
            { color: "yellow", dimColor: true },
            `+${parsed.length - maxLines} lines hidden`,
          )
        : null,
    ),
    displayLines.map((line, idx) => {
      switch (line.type) {
        case "header":
          return React.createElement(
            Box,
            { key: idx },
            React.createElement(
              Text,
              { color: "gray", dimColor: true },
              line.content,
            ),
          );

        case "hunk":
          return React.createElement(
            Box,
            { key: idx },
            React.createElement(
              Text,
              { color: "cyan", dimColor: true },
              line.content,
            ),
          );

        case "add": {
          const numStr = String(line.newLine ?? "").padStart(4, " ");
          return React.createElement(
            Box,
            { key: idx },
            React.createElement(
              Text,
              { color: "gray", dimColor: true },
              `${numStr} │ `,
            ),
            React.createElement(Text, { color: "green" }, `+ ${line.content}`),
          );
        }

        case "delete": {
          const numStr = String(line.oldLine ?? "").padStart(4, " ");
          return React.createElement(
            Box,
            { key: idx },
            React.createElement(
              Text,
              { color: "gray", dimColor: true },
              `${numStr} │ `,
            ),
            React.createElement(Text, { color: "red" }, `- ${line.content}`),
          );
        }

        case "context":
        default: {
          const numStr = String(line.newLine ?? line.oldLine ?? "").padStart(
            4,
            " ",
          );
          return React.createElement(
            Box,
            { key: idx },
            React.createElement(
              Text,
              { color: "gray", dimColor: true },
              `${numStr} │ `,
            ),
            React.createElement(
              Text,
              { color: "white", dimColor: true },
              `  ${line.content}`,
            ),
          );
        }
      }
    }),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool Execution Card Component
// ─────────────────────────────────────────────────────────────────────────────

export function ToolCard({
  toolName,
  args,
  status,
  output,
  error,
  diff,
}: ToolCardProps): ReactElement {
  const icon = getToolIcon(toolName);
  const argsSummary = formatToolArgs(toolName, args);
  const badge = getToolStatusBadge(status, error);

  const borderColor =
    status === "failed" ? "red" : status === "running" ? "yellow" : "green";

  return React.createElement(
    Box,
    {
      flexDirection: "column",
      borderStyle: "round",
      borderColor,
      paddingX: 1,
      marginBottom: 1,
    },
    // Header Bar
    React.createElement(
      Box,
      { justifyContent: "space-between", marginBottom: 0 },
      React.createElement(
        Box,
        null,
        React.createElement(
          Text,
          { bold: true, color: "cyan" },
          `${icon} ${toolName}`,
        ),
        argsSummary
          ? React.createElement(
              Text,
              { color: "gray" },
              ` (${argsSummary})`,
            )
          : null,
      ),
      React.createElement(
        Text,
        { bold: true, color: badge.color },
        `${badge.icon} ${badge.label}`,
      ),
    ),
    // Failed Error Message
    status === "failed" && error
      ? React.createElement(
          Box,
          { marginTop: 0 },
          React.createElement(Text, { color: "red", bold: true }, `✗ ${error}`),
        )
      : null,
    // Unified Diff Viewer if diff is provided
    diff ? DiffViewer({ diff }) : null,
    // Output text if output provided and no diff
    output && !diff
      ? React.createElement(
          Box,
          {
            flexDirection: "column",
            borderStyle: "single",
            borderColor: "gray",
            paddingX: 1,
            marginTop: 0,
          },
          React.createElement(Text, { color: "gray" }, output),
        )
      : null,
  );
}

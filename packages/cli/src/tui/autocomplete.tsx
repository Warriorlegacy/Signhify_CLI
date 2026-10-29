import React from "react";
import { Box, Text } from "ink";
import { type Theme, getTheme } from "./theme.js";

export interface AutocompleteItem {
  name: string;
  description: string;
  icon: string;
  shortcut?: string;
  category?: string;
}

export const DEFAULT_AUTOCOMPLETE_COMMANDS: AutocompleteItem[] = [
  { name: "/clear", description: "Clear conversation history", icon: "🧹", shortcut: "Ctrl+L" },
  { name: "/mode", description: "Switch mode (build | plan | debug | compose)", icon: "🔀", shortcut: "Tab" },
  { name: "/model", description: "Select active AI model", icon: "🧠", shortcut: "Ctrl+M" },
  { name: "/context-limit", description: "Set context token budget", icon: "📏" },
  { name: "/usage", description: "Show session token usage & cost", icon: "📊" },
  { name: "/provider", description: "Show active provider and credentials", icon: "🔌" },
  { name: "/models", description: "Show provider chain and fallback models", icon: "📋" },
  { name: "/config", description: "Show configuration and masked keys", icon: "⚙️" },
  { name: "/history", description: "Search checkpoint history", icon: "📜" },
  { name: "/sidebar", description: "Toggle sidebar (or collapse <id>)", icon: "📐", shortcut: "Ctrl+B" },
  { name: "/goal", description: "Set the stop condition / objective", icon: "🎯" },
  { name: "/mcp", description: "Show MCP server status", icon: "🔌" },
  { name: "/sessions", description: "List recent sessions", icon: "💾" },
  { name: "/fork", description: "Branch current session with checkpoints", icon: "⎇" },
  { name: "/memory", description: "Show MEMORY.md content", icon: "🧠" },
  { name: "/dream", description: "Consolidate session notes", icon: "💭" },
  { name: "/distill", description: "Distill long-term notes", icon: "⚗️" },
  { name: "/theme", description: "Switch TUI color theme", icon: "🎨" },
  { name: "/help", description: "Show all commands & shortcuts", icon: "❓", shortcut: "Ctrl+P" },
  { name: "/exit", description: "Quit Signhify CLI", icon: "🚪", shortcut: "Ctrl+C" },
];

/**
 * Filter autocomplete items based on user input query.
 * Matches prefix, substring, and subsequence against command name and description.
 */
export function filterAutocomplete(
  items: AutocompleteItem[] = DEFAULT_AUTOCOMPLETE_COMMANDS,
  query: string = "",
  maxResults: number = 8
): AutocompleteItem[] {
  const q = query.trim().toLowerCase().replace(/^\//, "");
  if (!q) {
    return items.slice(0, maxResults);
  }

  const scored = items
    .map((item) => {
      const nameRaw = item.name.toLowerCase().replace(/^\//, "");
      const descRaw = item.description.toLowerCase();
      let score = -1;

      if (nameRaw === q) {
        score = 100;
      } else if (nameRaw.startsWith(q)) {
        score = 80 - (nameRaw.length - q.length);
      } else if (nameRaw.includes(q)) {
        score = 50;
      } else if (descRaw.includes(q)) {
        score = 35;
      } else {
        // Subsequence fuzzy match on command name
        let i = 0;
        for (const ch of nameRaw) {
          if (ch === q[i]) i++;
          if (i === q.length) break;
        }
        if (i === q.length) {
          score = 20;
        }
      }
      return { item, score };
    })
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item);

  return scored.slice(0, maxResults);
}

/**
 * Calculates the next selected index with wrap-around navigation.
 */
export function nextAutocompleteIndex(
  current: number,
  count: number,
  delta: -1 | 1
): number {
  if (count <= 0) return 0;
  return (current + delta + count) % count;
}

/**
 * Determines whether the autocomplete popup should be active for the given input.
 */
export function shouldShowAutocomplete(input: string): boolean {
  return typeof input === "string" && input.trimStart().startsWith("/");
}

export interface AutocompleteOverlayProps {
  query: string;
  items?: AutocompleteItem[];
  selectedIndex?: number;
  maxVisible?: number;
  themeName?: string;
  theme?: Theme;
}

/**
 * Inline popup overlay that renders above the input box when the user types `/`
 * or is matching commands. Shows command icons, names, shortcuts, and descriptions.
 */
export function AutocompleteOverlay({
  query,
  items = DEFAULT_AUTOCOMPLETE_COMMANDS,
  selectedIndex = 0,
  maxVisible = 8,
  themeName,
  theme,
}: AutocompleteOverlayProps): React.ReactElement {
  const resolvedTheme = theme ?? getTheme(themeName);
  const matches = filterAutocomplete(items, query, maxVisible);
  const activeIndex =
    matches.length > 0 ? Math.min(Math.max(0, selectedIndex), matches.length - 1) : 0;

  return React.createElement(
    Box,
    {
      flexDirection: "column",
      borderStyle: "round",
      borderColor: resolvedTheme.border,
      paddingX: 1,
      marginBottom: 1,
    },
    // Header
    React.createElement(
      Box,
      {
        flexDirection: "row",
        justifyContent: "space-between",
        marginBottom: 0,
      },
      React.createElement(
        Text,
        { bold: true, color: "white" },
        `🔍 Commands (${matches.length} matching)`
      ),
      React.createElement(
        Text,
        { color: resolvedTheme.muted },
        "↑↓ navigate · Enter to select · Esc to close"
      )
    ),
    // Match rows
    matches.length > 0
      ? matches.map((item, idx) => {
          const isSelected = idx === activeIndex;
          return React.createElement(
            Box,
            {
              key: item.name,
              flexDirection: "row",
              justifyContent: "space-between",
            },
            React.createElement(
              Box,
              { flexDirection: "row" },
              React.createElement(
                Text,
                {
                  color: isSelected ? resolvedTheme.primary : resolvedTheme.muted,
                  bold: isSelected,
                },
                isSelected ? "▸ " : "  "
              ),
              React.createElement(Text, null, `${item.icon} `),
              React.createElement(
                Text,
                {
                  bold: isSelected,
                  color: isSelected ? resolvedTheme.primary : resolvedTheme.fg,
                },
                item.name
              ),
              React.createElement(
                Text,
                { color: isSelected ? resolvedTheme.fg : resolvedTheme.muted },
                ` — ${item.description}`
              )
            ),
            item.shortcut
              ? React.createElement(
                  Text,
                  {
                    color: isSelected
                      ? resolvedTheme.modes.plan
                      : resolvedTheme.muted,
                    bold: isSelected,
                  },
                  `[${item.shortcut}]`
                )
              : null
          );
        })
      : React.createElement(
          Text,
          { color: resolvedTheme.muted },
          `No matching commands for "${query}"`
        )
  );
}

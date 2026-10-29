import React from "react";
import { Box, Text } from "ink";
import type { SidebarSection, SidebarState } from "./index.js";

function renderProgressBar(percentage: number, length = 12): string {
  const clamped = Math.max(0, Math.min(100, percentage));
  const filled = Math.round((clamped / 100) * length);
  const empty = length - filled;
  return `[${"█".repeat(filled)}${"░".repeat(empty)}] ${clamped.toFixed(0)}%`;
}

export function createContextSection(): SidebarSection {
  return {
    id: "context",
    title: "Context & Memory",
    collapsible: true,
    isVisible: () => true,
    render(state: SidebarState) {
      if (!this.isVisible(state) || state.collapsed.includes("context")) {
        return React.createElement(
          Text,
          { bold: true, color: "cyan" },
          "▸ Context & Memory",
        );
      }
      return React.createElement(
        Box,
        { flexDirection: "column", marginBottom: 1 },
        React.createElement(Text, { bold: true, color: "cyan" }, "Context & Memory"),
        React.createElement(Text, { color: "gray" }, "─────────────────────────"),
        React.createElement(
          Box,
          { flexDirection: "column" },
          React.createElement(Text, {}, `Tokens: ${state.tokenUsage.used} / ${state.tokenUsage.limit}`),
          React.createElement(
            Text,
            { color: state.usagePct > 80 ? "red" : "green" },
            renderProgressBar(state.usagePct),
          ),
          React.createElement(Text, { color: "gray" }, "Auto-compact at 80%"),
        ),
      );
    },
  };
}

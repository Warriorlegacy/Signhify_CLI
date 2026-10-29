import React from "react";
import { Box, Text } from "ink";
import type { SidebarSection, SidebarState } from "./index.js";
import { formatTokenSpeed } from "../../tokens.js";

export function createRouterSection(): SidebarSection {
  return {
    id: "router",
    title: "Active Router",
    collapsible: true,
    isVisible: () => true,
    render(state: SidebarState) {
      if (!this.isVisible(state) || state.collapsed.includes("router")) {
        return React.createElement(Text, { bold: true, color: "yellow" }, "▸ Active Router");
      }
      return React.createElement(
        Box,
        { flexDirection: "column", marginBottom: 1 },
        React.createElement(Text, { bold: true, color: "yellow" }, "Active Router"),
        React.createElement(Text, { color: "gray" }, "─────────────────────────"),
        React.createElement(
          Box,
          null,
          React.createElement(Text, { color: "green" }, "● "),
          React.createElement(Text, {}, state.activeRouterInfo),
        ),
        React.createElement(
          Text,
          { color: "gray" },
          `Output speed: ${formatTokenSpeed(state.tokensPerSecond)}`,
        ),
      );
    },
  };
}

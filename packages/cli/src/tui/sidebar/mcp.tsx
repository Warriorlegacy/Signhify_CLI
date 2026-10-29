import React from "react";
import { Box, Text } from "ink";
import type { SidebarSection, SidebarState } from "./index.js";

export function createMcpSection(): SidebarSection {
  return {
    id: "mcp",
    title: "MCP Servers",
    collapsible: true,
    isVisible: (state) => state.mcpStatuses.length > 0,
    render(state: SidebarState) {
      if (!this.isVisible(state)) return null;
      if (state.collapsed.includes("mcp")) {
        return React.createElement(Text, { bold: true, color: "magenta" }, "▸ MCP Servers");
      }
      return React.createElement(
        Box,
        { flexDirection: "column", marginBottom: 1 },
        React.createElement(Text, { bold: true, color: "magenta" }, "MCP Servers"),
        React.createElement(Text, { color: "gray" }, "─────────────────────────"),
        React.createElement(
          Box,
          { flexDirection: "column" },
          state.mcpStatuses.map((s, idx) =>
            React.createElement(
              Box,
              { key: idx },
              React.createElement(
                Text,
                {
                  color:
                    s.status === "connected"
                      ? "green"
                      : s.status === "failed"
                        ? "red"
                        : "gray",
                },
                "● ",
              ),
              React.createElement(Text, {}, s.name),
              s.status === "failed" && s.error
                ? React.createElement(Text, { color: "red" }, ` ${s.error.slice(0, 24)}`)
                : null,
            ),
          ),
        ),
      );
    },
  };
}

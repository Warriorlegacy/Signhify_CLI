import React from "react";
import { Box, Text } from "ink";
import type { SidebarSection, SidebarState } from "./index.js";

export function createTodoSection(): SidebarSection {
  return {
    id: "todo",
    title: "Task Tree (T1 -> T1.1)",
    collapsible: true,
    isVisible: (state) => state.taskTree.length > 0,
    render(state: SidebarState) {
      if (!this.isVisible(state)) return null;
      if (state.collapsed.includes("todo")) {
        return React.createElement(Text, { bold: true, color: "blue" }, "▸ Task Tree");
      }
      return React.createElement(
        Box,
        { flexDirection: "column" },
        React.createElement(Text, { bold: true, color: "blue" }, "Task Tree (T1 -> T1.1)"),
        React.createElement(Text, { color: "gray" }, "─────────────────────────"),
        state.taskTree.map((task) =>
          React.createElement(
            Box,
            { key: task.id },
            React.createElement(
              Text,
              {
                color:
                  task.status === "done"
                    ? "green"
                    : task.status === "in_progress"
                      ? "yellow"
                      : task.status === "blocked"
                        ? "red"
                        : "gray",
              },
              `${task.parentId ? "  └─ " : ""}${task.id} [${task.status}] `,
            ),
            React.createElement(
              Text,
              {},
              task.title.length > 14 ? task.title.slice(0, 14) + "…" : task.title,
            ),
          ),
        ),
      );
    },
  };
}

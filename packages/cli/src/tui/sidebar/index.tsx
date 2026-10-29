import React from "react";
import type { ReactElement } from "react";
import type { TaskNode } from "@signhify/core";
import { createContextSection } from "./context.js";
import { createRouterSection } from "./router.js";
import { createMcpSection } from "./mcp.js";
import { createTodoSection } from "./todo.js";

export interface McpStatusLike {
  name: string;
  status: "connected" | "failed" | "disabled";
  error?: string;
}

export interface SidebarState {
  tokenUsage: { used: number; limit: number };
  usagePct: number;
  tokensPerSecond: number | null;
  activeRouterInfo: string;
  mcpStatuses: McpStatusLike[];
  taskTree: TaskNode[];
  /** Ids of individually collapsed sections. */
  collapsed: string[];
}

export interface SidebarSection {
  id: string;
  title: string;
  collapsible: boolean;
  isVisible(state: SidebarState): boolean;
  render(state: SidebarState): ReactElement | null;
}

/**
 * Plain array of sidebar sections — deliberately not a plugin slot system.
 * A third-party plugin story does not exist; add one only if it appears.
 */
export function buildSidebarSections(): SidebarSection[] {
  return [
    createContextSection(),
    createRouterSection(),
    createMcpSection(),
    createTodoSection(),
  ];
}

/** Toggle one section's collapsed state (id present = collapsed). */
export function toggleSidebarSection(collapsed: string[], id: string): string[] {
  return collapsed.includes(id)
    ? collapsed.filter((c) => c !== id)
    : [...collapsed, id];
}

export function renderSidebar(
  state: SidebarState,
): Array<ReactElement | null> {
  return buildSidebarSections().map((section) => section.render(state));
}

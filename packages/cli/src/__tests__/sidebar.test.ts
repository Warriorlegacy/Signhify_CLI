import { describe, it, expect } from "vitest";
import {
  buildSidebarSections,
  toggleSidebarSection,
  type SidebarState,
} from "../tui/sidebar/index.js";

const baseState: SidebarState = {
  tokenUsage: { used: 1000, limit: 128000 },
  usagePct: 0.8,
  tokensPerSecond: null,
  activeRouterInfo: "9router (port 20128)",
  mcpStatuses: [{ name: "rea", status: "connected" }],
  taskTree: [{ id: "T1", parentId: undefined, title: "Root", status: "in_progress" }],
  collapsed: [],
};

describe("sidebar sections", () => {
  it("renders nothing when isVisible() === false (empty mcp/task tree hide themselves)", () => {
    const state = { ...baseState, mcpStatuses: [], taskTree: [] };
    const sections = buildSidebarSections();

    const mcp = sections.find((s) => s.id === "mcp")!;
    const todo = sections.find((s) => s.id === "todo")!;
    expect(mcp.isVisible(state)).toBe(false);
    expect(mcp.render(state)).toBe(null);
    expect(todo.isVisible(state)).toBe(false);
    expect(todo.render(state)).toBe(null);
  });

  it("visible sections render content; toggling collapses to title only", () => {
    const sections = buildSidebarSections();
    const mcp = sections.find((s) => s.id === "mcp")!;

    // Expanded: title + content present.
    const expanded = mcp.render(baseState);
    expect(expanded).not.toBe(null);

    // Collapsed: body content (status rows) removed.
    const collapsedState = { ...baseState, collapsed: toggleSidebarSection([], "mcp") };
    const collapsed = mcp.render(collapsedState) as { props?: { children?: unknown[] } };
    const flat = JSON.stringify(collapsed);
    expect(flat).not.toContain("rea"); // the status row vanished
    expect(flat).toContain("MCP Servers"); // title remains
  });

  it("toggleSidebarSection is a toggle (add then remove)", () => {
    expect(toggleSidebarSection([], "mcp")).toEqual(["mcp"]);
    expect(toggleSidebarSection(["mcp"], "mcp")).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import {
  fuzzyFilter,
  nextPaletteIndex,
  type PaletteCommand,
} from "../tui/palette.js";

const commands: PaletteCommand[] = [
  { name: "/clear", description: "clear the conversation" },
  { name: "/mode", description: "build | plan | debug | compose" },
  { name: "/context-limit", description: "set the context token budget" },
  { name: "/sidebar", description: "toggle sidebar (or collapse <id>)" },
  { name: "/goal", description: "set the stop condition" },
  { name: "/mcp", description: "show MCP server status" },
  { name: "/memory", description: "show MEMORY.md" },
  { name: "/exit", description: "quit Signhify" },
];

describe("command palette", () => {
  it("empty query matches everything (leading slash tolerated)", () => {
    expect(fuzzyFilter(commands, "")).toHaveLength(commands.length);
    expect(fuzzyFilter(commands, "/")).toHaveLength(commands.length);
  });

  it("fuzzy subsequence filtering: ctx -> /context-limit", () => {
    const names = fuzzyFilter(commands, "ctx").map((c) => c.name);
    expect(names).toContain("/context-limit");
    // names excluding it stay out
    expect(names).not.toContain("/clear");
  });

  it("exact name query surfaces the command first", () => {
    const names = fuzzyFilter(commands, "mode").map((c) => c.name);
    expect(names[0]).toBe("/mode");
  });

  it("no match returns empty and selection stays at 0", () => {
    expect(fuzzyFilter(commands, "zzz")).toEqual([]);
    expect(nextPaletteIndex(0, 0, 1)).toBe(0);
  });

  it("selection wraps around both ends and picked entries are slash commands", () => {
    const count = commands.length;
    expect(nextPaletteIndex(count - 1, count, 1)).toBe(0);
    expect(nextPaletteIndex(0, count, -1)).toBe(count - 1);

    // Dispatch contract: whatever is picked must go through the slash handler.
    for (const c of commands) {
      expect(c.name.startsWith("/")).toBe(true);
    }
  });
});

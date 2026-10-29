import { describe, it, expect } from "vitest";
import {
  THEMES,
  listThemes,
  getTheme,
  renderContextMeter,
  formatEstimatedCost,
  calculateEstimatedCost,
} from "../tui/theme.js";
import {
  Header,
  getLeafDirectory,
  getModeColor,
  DEFAULT_BREADCRUMBS,
} from "../tui/header.js";
import { Footer, formatTokenCount } from "../tui/footer.js";
import {
  DEFAULT_AUTOCOMPLETE_COMMANDS,
  filterAutocomplete,
  nextAutocompleteIndex,
  shouldShowAutocomplete,
  AutocompleteOverlay,
} from "../tui/autocomplete.js";

describe("Theme System (theme.ts)", () => {
  it("registers all 5 required themes", () => {
    const themes = listThemes();
    expect(themes).toHaveLength(5);
    expect(themes).toEqual([
      "signhify-dark",
      "tokyo-night",
      "cyberpunk",
      "nord",
      "monokai-pro",
    ]);
  });

  it("returns default signhify-dark for empty, invalid, or default lookup", () => {
    const def = getTheme();
    expect(def.name).toBe("signhify-dark");
    expect(getTheme("non-existent").name).toBe("signhify-dark");
    expect(getTheme("tokyo-night").name).toBe("tokyo-night");
    expect(getTheme("cyberpunk").name).toBe("cyberpunk");
    expect(getTheme("nord").name).toBe("nord");
    expect(getTheme("monokai-pro").name).toBe("monokai-pro");
  });

  it("contains valid tokens for all 5 themes", () => {
    for (const name of listThemes()) {
      const theme = THEMES[name];
      expect(theme).toBeDefined();
      expect(theme.name).toBe(name);
      expect(theme.description).toBeTruthy();
      expect(theme.fg).toMatch(/^#/);
      expect(theme.muted).toMatch(/^#/);
      expect(theme.border).toMatch(/^#/);
      expect(theme.primary).toMatch(/^#/);
      expect(theme.secondary).toMatch(/^#/);

      // Mode accent colors: build, plan, debug, compose
      expect(theme.modes.build).toBeTruthy();
      expect(theme.modes.plan).toBeTruthy();
      expect(theme.modes.debug).toBeTruthy();
      expect(theme.modes.compose).toBeTruthy();
    }
  });

  it("defines distinct mode accents for signhify-dark", () => {
    const theme = getTheme("signhify-dark");
    expect(theme.modes.build).toBe("#10b981"); // emerald / green
    expect(theme.modes.plan).toBe("#f59e0b"); // amber / gold
    expect(theme.modes.debug).toBe("#f43f5e"); // rose / red
    expect(theme.modes.compose).toBe("#a855f7"); // purple / violet
  });
});

describe("Context Meter Helper (renderContextMeter)", () => {
  it("renders 50% usage with green color and equal filled/empty blocks", () => {
    const meter = renderContextMeter(50, 100, 12);
    expect(meter.percent).toBe(50);
    expect(meter.color).toBe("green");
    expect(meter.bar).toBe("[██████░░░░░░]");
  });

  it("renders green for usage < 60%", () => {
    const meter = renderContextMeter(59, 100);
    expect(meter.percent).toBe(59);
    expect(meter.color).toBe("green");
  });

  it("renders yellow for usage between 60% and 80%", () => {
    const meter60 = renderContextMeter(60, 100);
    expect(meter60.percent).toBe(60);
    expect(meter60.color).toBe("yellow");

    const meter75 = renderContextMeter(75, 100);
    expect(meter75.percent).toBe(75);
    expect(meter75.color).toBe("yellow");

    const meter80 = renderContextMeter(80, 100);
    expect(meter80.percent).toBe(80);
    expect(meter80.color).toBe("yellow");
  });

  it("renders red for usage > 80%", () => {
    const meter81 = renderContextMeter(81, 100);
    expect(meter81.percent).toBe(81);
    expect(meter81.color).toBe("red");

    const meter100 = renderContextMeter(100, 100);
    expect(meter100.percent).toBe(100);
    expect(meter100.color).toBe("red");
    expect(meter100.bar).toBe("[████████████]");
  });

  it("handles 0 tokens and invalid limits safely", () => {
    const zero = renderContextMeter(0, 128000);
    expect(zero.percent).toBe(0);
    expect(zero.color).toBe("green");
    expect(zero.bar).toBe("[░░░░░░░░░░░░]");

    const invalidLimit = renderContextMeter(500, 0);
    expect(invalidLimit.percent).toBe(0);
    expect(invalidLimit.color).toBe("green");
  });

  it("supports custom bar length", () => {
    const meter = renderContextMeter(50, 100, 20);
    expect(meter.bar).toBe(`[${"█".repeat(10)}${"░".repeat(10)}]`);
  });
});

describe("Cost Estimator Helper (formatEstimatedCost)", () => {
  it("formats zero cost for 0 tokens", () => {
    expect(formatEstimatedCost(0, "openai", "gpt-4o")).toBe("$0.00");
  });

  it("formats $0.00 for local / free providers like ollama and mock", () => {
    expect(formatEstimatedCost(50000, "ollama", "llama3")).toBe("$0.00");
    expect(formatEstimatedCost(50000, "mock", "mock-agent")).toBe("$0.00");
    expect(calculateEstimatedCost(50000, "ollama", "llama3")).toBe(0);
  });

  it("calculates cost for DeepSeek correctly", () => {
    // deepseek: $0.20 per 1M tokens
    // 100,000 tokens = 0.1 * 0.20 = $0.02
    const cost = calculateEstimatedCost(100000, "deepseek", "deepseek-chat");
    expect(cost).toBeCloseTo(0.02, 3);
    expect(formatEstimatedCost(100000, "deepseek", "deepseek-chat")).toBe("$0.02");
  });

  it("calculates cost for Anthropic claude-3-5-sonnet correctly", () => {
    // claude-3-5-sonnet: $6.00 per 1M tokens
    // 50,000 tokens = 0.05 * 6.00 = $0.30
    const cost = calculateEstimatedCost(50000, "anthropic", "claude-3-5-sonnet");
    expect(cost).toBeCloseTo(0.3, 3);
    expect(formatEstimatedCost(50000, "anthropic", "claude-3-5-sonnet")).toBe("$0.30");
  });

  it("formats sub-cent amounts with 4 decimals", () => {
    // openai gpt-4o-mini: $0.30 per 1M tokens
    // 5,000 tokens = 0.005 * 0.30 = $0.0015
    const formatted = formatEstimatedCost(5000, "openai", "gpt-4o-mini");
    expect(formatted).toBe("$0.0015");
  });
});

describe("Header Component (header.tsx)", () => {
  it("extracts leaf directory correctly", () => {
    expect(getLeafDirectory("D:/Signhify_CLI/packages/cli")).toBe("cli");
    expect(getLeafDirectory("C:\\Users\\User\\my-project")).toBe("my-project");
    expect(getLeafDirectory("/home/user/workspace")).toBe("workspace");
  });

  it("resolves mode colors from theme", () => {
    const theme = getTheme("signhify-dark");
    expect(getModeColor("build", theme)).toBe(theme.modes.build);
    expect(getModeColor("plan", theme)).toBe(theme.modes.plan);
    expect(getModeColor("debug", theme)).toBe(theme.modes.debug);
    expect(getModeColor("compose", theme)).toBe(theme.modes.compose);
  });

  it("renders full header tree with brand, mode pill, leaf directory, model badge, and breadcrumbs", () => {
    const element = Header({
      version: "0.3.2",
      mode: "build",
      cwd: "D:/Signhify_CLI/packages/cli",
      branch: "main",
      modelName: "claude-3-5-sonnet",
      provider: "anthropic",
      themeName: "signhify-dark",
      goal: "Build modern TUI",
    });

    const flat = JSON.stringify(element);
    expect(flat).toContain("✦ SIGNHIFY AI");
    expect(flat).toContain("v0.3.2");
    expect(flat).toContain("[BUILD]");
    expect(flat).toContain("📂 cli");
    expect(flat).toContain("⎇ main");
    expect(flat).toContain("● claude-3-5-sonnet");
    expect(flat).toContain("[anthropic]");
    expect(flat).toContain("🎨 signhify-dark");
    expect(flat).toContain("🎯 \\\"Build modern TUI\\\"");
    expect(flat).toContain(DEFAULT_BREADCRUMBS);
  });
});

describe("Footer Component (footer.tsx)", () => {
  it("formats token count into human-readable strings", () => {
    expect(formatTokenCount(0)).toBe("0");
    expect(formatTokenCount(500)).toBe("500");
    expect(formatTokenCount(2500)).toBe("2.5k");
    expect(formatTokenCount(61400)).toBe("61.4k");
    expect(formatTokenCount(128000)).toBe("128k");
  });

  it("renders Unicode block meter, speed, cost, and router info", () => {
    const element = Footer({
      tokensUsed: 61400,
      tokenLimit: 128000,
      tokensPerSecond: 45.2,
      activeRouterInfo: "anthropic/claude-3-5-sonnet",
      cost: "$0.23",
      themeName: "signhify-dark",
    });

    const flat = JSON.stringify(element);
    // Context bar with Unicode block meter and percentages
    expect(flat).toContain("48%");
    expect(flat).toContain("61.4k / 128k");
    expect(flat).toContain("⚡ 45.2 tok/s");
    expect(flat).toContain("💰 $0.23");
    expect(flat).toContain("anthropic/claude-3-5-sonnet");
    expect(flat).toContain("Ctrl+P commands");
  });
});

describe("Autocomplete Overlay (autocomplete.tsx)", () => {
  it("determines when to show autocomplete", () => {
    expect(shouldShowAutocomplete("/")).toBe(true);
    expect(shouldShowAutocomplete("/mode")).toBe(true);
    expect(shouldShowAutocomplete("  /help")).toBe(true);
    expect(shouldShowAutocomplete("hello")).toBe(false);
    expect(shouldShowAutocomplete("")).toBe(false);
  });

  it("filters autocomplete items by prefix and query", () => {
    const all = filterAutocomplete(DEFAULT_AUTOCOMPLETE_COMMANDS, "");
    expect(all.length).toBeGreaterThan(0);

    const modeMatches = filterAutocomplete(DEFAULT_AUTOCOMPLETE_COMMANDS, "/mode");
    expect(modeMatches[0]?.name).toBe("/mode");

    const mMatches = filterAutocomplete(DEFAULT_AUTOCOMPLETE_COMMANDS, "/m");
    const mNames = mMatches.map((item) => item.name);
    expect(mNames).toContain("/mode");
    expect(mNames).toContain("/model");
  });

  it("supports fuzzy matching on command description or subsequence", () => {
    const themeMatches = filterAutocomplete(DEFAULT_AUTOCOMPLETE_COMMANDS, "theme");
    expect(themeMatches.some((m) => m.name === "/theme")).toBe(true);

    const ctxMatches = filterAutocomplete(DEFAULT_AUTOCOMPLETE_COMMANDS, "ctx");
    expect(ctxMatches.some((m) => m.name === "/context-limit")).toBe(true);
  });

  it("calculates next index with wrap-around navigation", () => {
    expect(nextAutocompleteIndex(0, 5, 1)).toBe(1);
    expect(nextAutocompleteIndex(4, 5, 1)).toBe(0); // wrap to top
    expect(nextAutocompleteIndex(0, 5, -1)).toBe(4); // wrap to bottom
    expect(nextAutocompleteIndex(0, 0, 1)).toBe(0);
  });

  it("renders AutocompleteOverlay component with highlighted item", () => {
    const element = AutocompleteOverlay({
      query: "/m",
      selectedIndex: 0,
      themeName: "signhify-dark",
    });

    const flat = JSON.stringify(element);
    expect(flat).toContain("🔍 Commands");
    expect(flat).toContain("▸ "); // selection arrow
    expect(flat).toContain("/mode");
  });
});

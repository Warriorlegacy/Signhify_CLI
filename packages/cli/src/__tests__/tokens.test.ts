import { describe, it, expect } from "vitest";
import {
  calculateTokenSpeed,
  formatTokenSpeed,
  formatSessionSummary,
  TokenSpeedMeter,
} from "../tokens.js";
import { Footer } from "../tui/footer.js";

describe("calculateTokenSpeed", () => {
  it("calculates accurate tokens per second when given completion tokens and elapsed ms", () => {
    // 50 tokens in 1000ms = 50.0 tok/s
    const speed = calculateTokenSpeed(50, 1000);
    expect(speed).toBeCloseTo(50.0, 5);

    // 120 tokens in 2500ms = 48.0 tok/s
    const speed2 = calculateTokenSpeed(120, 2500);
    expect(speed2).toBeCloseTo(48.0, 5);

    // 1 token in 20ms = 50.0 tok/s
    const speed3 = calculateTokenSpeed(1, 20);
    expect(speed3).toBeCloseTo(50.0, 5);
  });

  it("calculates tokens per second using start and end timestamps", () => {
    const start = 1000;
    const end = 3000; // 2000ms elapsed
    const tokens = 80;
    const speed = calculateTokenSpeed(tokens, start, end);
    expect(speed).toBeCloseTo(40.0, 5);
  });

  it("returns null when tokens are missing, zero, or negative", () => {
    expect(calculateTokenSpeed(undefined, 1000)).toBeNull();
    expect(calculateTokenSpeed(null, 1000)).toBeNull();
    expect(calculateTokenSpeed(0, 1000)).toBeNull();
    expect(calculateTokenSpeed(-10, 1000)).toBeNull();
  });

  it("returns null when elapsed duration is zero or negative", () => {
    expect(calculateTokenSpeed(50, 0)).toBeNull();
    expect(calculateTokenSpeed(50, -500)).toBeNull();
    expect(calculateTokenSpeed(50, 2000, 1000)).toBeNull();
    expect(calculateTokenSpeed(50, null)).toBeNull();
    expect(calculateTokenSpeed(50, undefined)).toBeNull();
  });
});

describe("formatTokenSpeed", () => {
  it("formats positive numbers with one decimal digit and unit", () => {
    expect(formatTokenSpeed(42)).toBe("42.0 tok/s");
    expect(formatTokenSpeed(37.489)).toBe("37.5 tok/s");
    expect(formatTokenSpeed(0.5)).toBe("0.5 tok/s");
  });

  it("returns 'unavailable' for null, undefined, negative or non-finite values", () => {
    expect(formatTokenSpeed(null)).toBe("unavailable");
    expect(formatTokenSpeed(undefined)).toBe("unavailable");
    expect(formatTokenSpeed(-5)).toBe("unavailable");
    expect(formatTokenSpeed(NaN)).toBe("unavailable");
    expect(formatTokenSpeed(Infinity)).toBe("unavailable");
  });
});

describe("formatSessionSummary", () => {
  it("formats session tokens, percentage, speed, and mode", () => {
    const summary = formatSessionSummary({
      usedTokens: 1500,
      limitTokens: 10000,
      activeRouterInfo: "openai/gpt-4o",
      tokensPerSecond: 64.32,
      mode: "build",
    });

    expect(summary).toBe(
      "Session usage: 1,500 / 10,000 tokens (15.0%). Endpoint: openai/gpt-4o. Output speed: 64.3 tok/s. Mode: build."
    );
  });

  it("handles missing speed gracefully in summary", () => {
    const summary = formatSessionSummary({
      usedTokens: 250,
      limitTokens: 8000,
      activeRouterInfo: "anthropic/claude-3-5-sonnet",
      tokensPerSecond: null,
      mode: "plan",
    });

    expect(summary).toContain("Output speed: unavailable");
    expect(summary).toContain("Session usage: 250 / 8,000 tokens (3.1%)");
    expect(summary).toContain("Mode: plan.");
  });
});

describe("TokenSpeedMeter", () => {
  it("records first token timestamp and computes speed on completion", () => {
    const meter = new TokenSpeedMeter();
    expect(meter.isTracking()).toBe(false);

    meter.trackFirstToken(10000);
    expect(meter.isTracking()).toBe(true);
    expect(meter.getStartTimestamp()).toBe(10000);

    // Subsequent stream chunks do not overwrite start timestamp
    meter.trackFirstToken(10500);
    expect(meter.getStartTimestamp()).toBe(10000);

    // Stream completes after 2 seconds with 60 tokens
    const speed = meter.recordCompletion(60, 12000);
    expect(speed).toBeCloseTo(30.0, 5);
    expect(meter.getSpeed()).toBeCloseTo(30.0, 5);
    expect(meter.isTracking()).toBe(false);
  });

  it("returns null if completion is recorded without tracking first token", () => {
    const meter = new TokenSpeedMeter();
    const speed = meter.recordCompletion(100, 5000);
    expect(speed).toBeNull();
    expect(meter.getSpeed()).toBeNull();
  });

  it("resets state completely", () => {
    const meter = new TokenSpeedMeter();
    meter.trackFirstToken(1000);
    meter.recordCompletion(50, 2000);
    expect(meter.getSpeed()).toBeCloseTo(50.0, 5);

    meter.reset();
    expect(meter.isTracking()).toBe(false);
    expect(meter.getSpeed()).toBeNull();
    expect(meter.getStartTimestamp()).toBeNull();
  });
});

describe("Footer component", () => {
  it("renders token usage, percentage, token speed, and router info", () => {
    const element = Footer({
      tokensUsed: 2500,
      tokenLimit: 10000,
      tokensPerSecond: 52.8,
      activeRouterInfo: "gemini/gemini-1.5-pro",
    });

    const flat = JSON.stringify(element);
    expect(flat).toContain("2,500 tokens (25.0%)");
    expect(flat).toContain("52.8 tok/s");
    expect(flat).toContain("gemini/gemini-1.5-pro");
    expect(flat).toContain("ctrl+p commands");
  });

  it("renders unavailable when tokensPerSecond is null", () => {
    const element = Footer({
      tokensUsed: 0,
      tokenLimit: 5000,
      tokensPerSecond: null,
      activeRouterInfo: "ollama/llama3",
    });

    const flat = JSON.stringify(element);
    expect(flat).toContain("unavailable");
    expect(flat).toContain("0 tokens (0.0%)");
    expect(flat).toContain("ollama/llama3");
  });
});

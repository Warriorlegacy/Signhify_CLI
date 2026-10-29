/**
 * Modern TUI Theme tokens, context meter, and cost estimator helpers for Signhify CLI.
 */

export interface ThemeModeAccents {
  build: string;
  plan: string;
  debug: string;
  compose: string;
}

export interface Theme {
  name: string;
  description: string;
  bg?: string;
  fg: string;
  muted: string;
  border: string;
  primary: string;
  secondary: string;
  modes: ThemeModeAccents;
}

export const THEMES: Record<string, Theme> = {
  "signhify-dark": {
    name: "signhify-dark",
    description: "Modern dark theme with emerald & cyan accents (default)",
    bg: "#0b0f19",
    fg: "#f8fafc",
    muted: "#64748b",
    border: "#334155",
    primary: "#38bdf8",
    secondary: "#818cf8",
    modes: {
      build: "#10b981", // emerald / green
      plan: "#f59e0b", // amber / gold
      debug: "#f43f5e", // red / rose
      compose: "#a855f7", // purple / violet
    },
  },
  "tokyo-night": {
    name: "tokyo-night",
    description: "Deep midnight blue and vibrant neon pastel highlights",
    bg: "#1a1b26",
    fg: "#c0caf5",
    muted: "#565f89",
    border: "#292e42",
    primary: "#7aa2f7",
    secondary: "#bb9af7",
    modes: {
      build: "#9ece6a", // green
      plan: "#e0af68", // gold / amber
      debug: "#f7768e", // red / rose
      compose: "#bb9af7", // purple / violet
    },
  },
  cyberpunk: {
    name: "cyberpunk",
    description: "High-contrast neon cyberpunk with hot pink & electric cyan",
    bg: "#0d0221",
    fg: "#00ff9f",
    muted: "#711c91",
    border: "#ff007f",
    primary: "#00f0ff",
    secondary: "#ff007f",
    modes: {
      build: "#00ff9f", // neon green
      plan: "#ffe600", // neon yellow
      debug: "#ff0055", // neon red
      compose: "#d600ff", // neon violet
    },
  },
  nord: {
    name: "nord",
    description: "Arctic, north-bluish clean minimalist palette",
    bg: "#2e3440",
    fg: "#eceff4",
    muted: "#4c566a",
    border: "#434c5e",
    primary: "#88c0d0",
    secondary: "#81a1c1",
    modes: {
      build: "#a3be8c", // nord green
      plan: "#ebcb8b", // nord yellow
      debug: "#bf616a", // nord red
      compose: "#b48ead", // nord purple
    },
  },
  "monokai-pro": {
    name: "monokai-pro",
    description: "Refined Monokai Pro with spectrum color accents",
    bg: "#2d2a2e",
    fg: "#fcfcfa",
    muted: "#727072",
    border: "#403e41",
    primary: "#ffd866",
    secondary: "#78dce8",
    modes: {
      build: "#a9dc76", // monokai green
      plan: "#ffd866", // monokai gold / amber
      debug: "#ff6188", // monokai red
      compose: "#ab9df2", // monokai violet
    },
  },
};

export const DEFAULT_THEME_NAME = "signhify-dark";

/**
 * Returns a list of all registered theme identifiers.
 */
export function listThemes(): string[] {
  return Object.keys(THEMES);
}

/**
 * Retrieves a theme by name, defaulting to 'signhify-dark' if unknown.
 */
export function getTheme(name?: string): Theme {
  if (!name) return THEMES[DEFAULT_THEME_NAME];
  const normalized = name.trim().toLowerCase();
  return THEMES[normalized] ?? THEMES[DEFAULT_THEME_NAME];
}

export interface ContextMeterResult {
  bar: string;
  percent: number;
  color: "green" | "yellow" | "red";
  text: string;
  used: number;
  limit: number;
  toString(): string;
}

/**
 * Custom String wrapper for ContextMeterResult that allows the returned value
 * to be treated either as a formatted string (e.g. `[████████░░░░] 50%`)
 * or as a structured object with `.color`, `.bar`, `.percent`, and `.text`.
 */
class ContextMeterValue extends String implements ContextMeterResult {
  public readonly bar: string;
  public readonly percent: number;
  public readonly color: "green" | "yellow" | "red";
  public readonly text: string;
  public readonly used: number;
  public readonly limit: number;

  constructor(
    bar: string,
    percent: number,
    color: "green" | "yellow" | "red",
    text: string,
    used: number,
    limit: number
  ) {
    super(text);
    this.bar = bar;
    this.percent = percent;
    this.color = color;
    this.text = text;
    this.used = used;
    this.limit = limit;
  }
}

/**
 * Renders a Unicode block progress bar meter `[████████░░░░] 50%`
 * with dynamic color coding:
 * - green: < 60%
 * - yellow: 60% - 80%
 * - red: > 80%
 */
export function renderContextMeter(
  used: number,
  limit: number,
  length: number = 12
): ContextMeterValue {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 0;
  const safeUsed = Number.isFinite(used) && used > 0 ? used : 0;
  const safeLength = Number.isFinite(length) && length > 0 ? Math.floor(length) : 12;

  const rawPercent = safeLimit > 0 ? (safeUsed / safeLimit) * 100 : 0;
  const percent = Math.min(100, Math.max(0, Math.round(rawPercent)));

  const filledCount = Math.min(
    safeLength,
    Math.max(0, Math.round((percent / 100) * safeLength))
  );
  const emptyCount = Math.max(0, safeLength - filledCount);

  const bar = `[${"█".repeat(filledCount)}${"░".repeat(emptyCount)}]`;
  const text = `${bar} ${percent}%`;

  let color: "green" | "yellow" | "red";
  if (percent > 80) {
    color = "red";
  } else if (percent >= 60) {
    color = "yellow";
  } else {
    color = "green";
  }

  return new ContextMeterValue(bar, percent, color, text, safeUsed, safeLimit);
}

/**
 * Representative blended pricing table per 1,000,000 tokens (USD).
 */
const MODEL_PRICING_PER_MILLION: Record<string, number> = {
  // OpenAI
  "gpt-4o-mini": 0.3,
  "gpt-4o": 5.0,
  "o1": 30.0,
  "o1-preview": 30.0,
  "o1-mini": 3.0,
  "o3-mini": 2.2,
  "gpt-4-turbo": 20.0,
  "gpt-4": 20.0,
  "gpt-3.5-turbo": 1.0,

  // Anthropic
  "claude-3-5-sonnet": 6.0,
  "claude-3-7-sonnet": 6.0,
  "claude-3-5-haiku": 1.5,
  "claude-3-haiku": 0.75,
  "claude-3-opus": 30.0,

  // DeepSeek
  "deepseek-chat": 0.2,
  "deepseek-v3": 0.2,
  "deepseek-reasoner": 1.0,
  "deepseek-r1": 1.0,
  "r1": 1.0,

  // Groq / Meta
  "llama-3.3-70b": 0.65,
  "llama-3-70b": 0.65,
  "llama-3.1-8b": 0.08,
  "llama-3-8b": 0.08,

  // Google Gemini
  "gemini-2.0-flash": 0.15,
  "gemini-1.5-flash": 0.15,
  "gemini-1.5-pro": 2.5,
};

const PROVIDER_DEFAULT_PRICING: Record<string, number> = {
  ollama: 0,
  mock: 0,
  test: 0,
  local: 0,
  deepseek: 0.25,
  groq: 0.5,
  google: 0.5,
  gemini: 0.5,
  openrouter: 1.0,
  openai: 2.5,
  anthropic: 4.0,
};

/**
 * Calculates raw estimated USD cost for a given number of tokens used.
 */
export function calculateEstimatedCost(
  tokensUsed: number,
  providerId: string,
  modelId: string
): number {
  if (!Number.isFinite(tokensUsed) || tokensUsed <= 0) {
    return 0;
  }

  const p = (providerId || "").trim().toLowerCase();
  const m = (modelId || "").trim().toLowerCase();

  // Zero cost / local inference
  if (
    p === "ollama" ||
    p === "mock" ||
    p === "test" ||
    p === "local" ||
    m.includes("ollama") ||
    m.includes("free") ||
    m.includes("local")
  ) {
    return 0;
  }

  // Look for exact or partial model pricing match
  let ratePerMillion: number | undefined;

  for (const [key, rate] of Object.entries(MODEL_PRICING_PER_MILLION)) {
    if (m === key || m.includes(key)) {
      ratePerMillion = rate;
      break;
    }
  }

  // If not matched by model name, fallback to provider default
  if (ratePerMillion === undefined) {
    for (const [key, rate] of Object.entries(PROVIDER_DEFAULT_PRICING)) {
      if (p === key || p.includes(key)) {
        ratePerMillion = rate;
        break;
      }
    }
  }

  // Fallback blended default rate ($1.00 per 1M tokens)
  if (ratePerMillion === undefined) {
    ratePerMillion = 1.0;
  }

  return (tokensUsed / 1_000_000) * ratePerMillion;
}

/**
 * Formats estimated cost as currency string (e.g. "$0.00", "$0.0012", "$0.37").
 */
export function formatEstimatedCost(
  tokensUsed: number,
  providerId: string,
  modelId: string
): string {
  const cost = calculateEstimatedCost(tokensUsed, providerId, modelId);
  if (cost === 0) {
    return "$0.00";
  }
  if (cost < 0.01) {
    const formatted = `$${cost.toFixed(4)}`;
    return formatted === "$0.0000" ? "$0.0001" : formatted;
  }
  return `$${cost.toFixed(2)}`;
}

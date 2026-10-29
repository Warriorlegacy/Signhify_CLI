import React from "react";
import { Box, Text } from "ink";
import { formatTokenSpeed } from "../tokens.js";
import {
  renderContextMeter,
  formatEstimatedCost,
  getTheme,
  type Theme,
} from "./theme.js";

export interface FooterProps {
  tokensUsed: number;
  tokenLimit: number;
  tokensPerSecond: number | null;
  activeRouterInfo: string;
  providerId?: string;
  modelId?: string;
  cost?: string;
  themeName?: string;
  theme?: Theme;
}

/**
 * Formats token count into compact human-readable units (e.g. 500, 2.5k, 61.4k, 128k).
 */
export function formatTokenCount(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) {
    return "0";
  }
  if (tokens < 1000) {
    return `${Math.round(tokens)}`;
  }
  const k = tokens / 1000;
  return k % 1 === 0 ? `${k}k` : `${k.toFixed(1)}k`;
}

/**
 * Modern upgraded Footer component for Signhify CLI TUI.
 *
 * - Left: Unicode block context meter `[████████░░░░] 48% (61.4k / 128k)` with dynamic color coding.
 * - Middle: Generation speed `⚡ ${tok/s}` + Estimated Cost `💰 ${cost}`.
 * - Right: Active router chain info + `Ctrl+P commands`.
 */
export function Footer({
  tokensUsed,
  tokenLimit,
  tokensPerSecond,
  activeRouterInfo,
  providerId,
  modelId,
  cost,
  themeName,
  theme,
}: FooterProps): React.ReactElement {
  const resolvedTheme = theme ?? getTheme(themeName);
  const meter = renderContextMeter(tokensUsed, tokenLimit);
  const pct = tokenLimit > 0 ? (tokensUsed / tokenLimit) * 100 : 0;

  // Infer provider & model if not explicitly passed
  let inferredProvider = providerId;
  let inferredModel = modelId;
  if (!inferredProvider && activeRouterInfo) {
    const parts = activeRouterInfo.split("/");
    inferredProvider = parts[0]?.trim() || "";
    inferredModel = parts[1]?.trim() || "";
  }

  const estimatedCost =
    cost ??
    formatEstimatedCost(tokensUsed, inferredProvider ?? "", inferredModel ?? "");
  const speedText = formatTokenSpeed(tokensPerSecond);

  const usedShort = formatTokenCount(tokensUsed);
  const limitShort = formatTokenCount(tokenLimit);
  const contextBarText = `${meter.bar} ${meter.percent}% (${usedShort} / ${limitShort})`;

  return React.createElement(
    Box,
    {
      marginTop: 1,
      flexDirection: "row",
      justifyContent: "space-between",
      width: "100%",
    },
    // Left: Context bar with Unicode block meter and dynamic color
    React.createElement(
      Text,
      {
        key: `${tokensUsed.toLocaleString()} tokens (${pct.toFixed(1)}%)`,
        color: meter.color,
        bold: true,
      },
      contextBarText
    ),
    // Middle: Output speed + Estimated cost
    React.createElement(
      Text,
      { color: resolvedTheme.muted },
      `⚡ ${speedText} · 💰 ${estimatedCost}`
    ),
    // Right: Active router / model chain info + command shortcut hint
    React.createElement(
      Text,
      {
        key: "ctrl+p commands",
        color: resolvedTheme.muted,
      },
      `${activeRouterInfo} · Ctrl+P commands`
    )
  );
}

import React from "react";
import { Box, Text } from "ink";
import { formatTokenSpeed } from "../tokens.js";

export interface FooterProps {
  tokensUsed: number;
  tokenLimit: number;
  tokensPerSecond: number | null;
  activeRouterInfo: string;
}

export function Footer({
  tokensUsed,
  tokenLimit,
  tokensPerSecond,
  activeRouterInfo,
}: FooterProps): React.ReactElement {
  const pct = tokenLimit > 0 ? (tokensUsed / tokenLimit) * 100 : 0;
  return React.createElement(
    Box,
    { marginTop: 1, justifyContent: "space-between" },
    React.createElement(
      Text,
      { color: "gray" },
      `${tokensUsed.toLocaleString()} tokens (${pct.toFixed(1)}%) · ${formatTokenSpeed(tokensPerSecond)} · ${activeRouterInfo}`,
    ),
    React.createElement(
      Text,
      { color: "gray" },
      "ctrl+p commands",
    ),
  );
}

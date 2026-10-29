import React from "react";
import type { ReactElement } from "react";
import { Box, Text } from "ink";

export interface PaletteCommand {
  name: string; // "/mode"
  description: string;
}

/** Subsequence fuzzy match: "ctx" hits "/context-limit", "" matches everything. */
export function fuzzyFilter(
  commands: PaletteCommand[],
  query: string,
): PaletteCommand[] {
  const q = query.toLowerCase().replace(/^\//, "");
  if (!q) return commands;
  return commands.filter((c) => {
    const hay = `${c.name.toLowerCase()} ${c.description.toLowerCase()}`;
    let i = 0;
    for (const ch of hay) {
      if (ch === q[i]) i++;
      if (i === q.length) return true;
    }
    return false;
  });
}

/** Move selection with wrap-around so the last/first entries are reachable by arrows. */
export function nextPaletteIndex(
  index: number,
  count: number,
  delta: -1 | 1,
): number {
  if (count === 0) return 0;
  return (index + delta + count) % count;
}

export function PaletteOverlay(props: {
  query: string;
  matches: PaletteCommand[];
  index: number;
}): ReactElement {
  const { query, matches, index } = props;
  return React.createElement(
    Box,
    { flexDirection: "column", borderStyle: "round", borderColor: "gray" },
    React.createElement(Text, { bold: true }, `▸ command: ${query}▌`),
    matches
      .slice(0, 8)
      .map((c, i) =>
        React.createElement(
          Text,
          { key: c.name, color: i === index ? "cyan" : undefined },
          `${i === index ? "● " : "  "}${c.name} — ${c.description}`,
        ),
      ),
    matches.length === 0
      ? React.createElement(Text, { color: "gray" }, "no matching command")
      : null,
  );
}

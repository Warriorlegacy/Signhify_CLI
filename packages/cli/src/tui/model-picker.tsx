import React from "react";
import type { ReactElement } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";

/** A single selectable model entry. */
export interface ModelOption {
  /** Unique model id passed through to the LLM router. */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Provider badge shown next to the row. */
  provider: string;
  /** Right-aligned speed/capability hint (e.g. "No wait", "Reasoning", "Offline"). */
  hint: string;
}

/** Curated BYOK model catalog across every supported provider. */
export const MODEL_CATALOG: ModelOption[] = [
  { id: "claude-3-5-sonnet-latest", name: "Claude 3.5 Sonnet", provider: "Anthropic", hint: "No wait" },
  { id: "claude-3-opus-20240229", name: "Claude 3 Opus", provider: "Anthropic", hint: "Complex tasks" },
  { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku", provider: "Anthropic", hint: "Instant" },
  { id: "gpt-4o", name: "GPT-4o", provider: "OpenAI", hint: "Fast" },
  { id: "gpt-4o-mini", name: "GPT-4o Mini", provider: "OpenAI", hint: "No wait" },
  { id: "o1", name: "o1", provider: "OpenAI", hint: "Reasoning" },
  { id: "deepseek-chat", name: "DeepSeek Chat (V3)", provider: "DeepSeek", hint: "No wait" },
  { id: "deepseek-reasoner", name: "DeepSeek Reasoner (R1)", provider: "DeepSeek", hint: "Reasoning" },
  { id: "gemini-1.5-pro-latest", name: "Gemini 1.5 Pro", provider: "Gemini", hint: "2M Context" },
  { id: "gemini-1.5-flash-latest", name: "Gemini 1.5 Flash", provider: "Gemini", hint: "Instant" },
  { id: "openrouter/auto", name: "OpenRouter Auto", provider: "OpenRouter", hint: "Auto" },
  { id: "meta-llama/llama-3.3-70b-instruct", name: "Llama 3.3 70B Instruct", provider: "OpenRouter", hint: "Fast" },
  { id: "llama3.2", name: "Llama 3.2", provider: "Local", hint: "Offline" },
  { id: "qwen2.5-coder:7b", name: "Qwen 2.5 Coder 7B", provider: "Local", hint: "Offline" },
  { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B Versatile", provider: "Groq", hint: "500 tok/s" },
];

/** Subsequence fuzzy match over id, name, provider, and hint. */
export function fuzzyFilterModels(
  models: ModelOption[],
  query: string,
): ModelOption[] {
  const q = query.toLowerCase();
  if (!q) return models;
  return models.filter((m) => {
    const hay = `${m.id} ${m.name} ${m.provider} ${m.hint}`.toLowerCase();
    let i = 0;
    for (const ch of hay) {
      if (ch === q[i]) i++;
      if (i === q.length) return true;
    }
    return false;
  });
}

/** Wrap-around index movement over a filtered model list. */
export function nextModelIndex(
  index: number,
  count: number,
  delta: -1 | 1,
): number {
  if (count === 0) return 0;
  return (index + delta + count) % count;
}

export interface ModelPickerOverlayProps {
  activeModelId: string | undefined;
  onSelect: (modelId: string) => void;
  query?: string;
  focusIndex?: number;
  onQueryChange?: (query: string) => void;
}

/** Freebuff-style model & provider selector overlay. */
export function ModelPickerOverlay(props: ModelPickerOverlayProps): ReactElement {
  const {
    activeModelId,
    onSelect,
    query: controlledQuery,
    focusIndex: controlledIndex,
    onQueryChange,
  } = props;
  const [internalQuery, setInternalQuery] = React.useState("");
  const [internalFocusIndex, setInternalFocusIndex] = React.useState(0);

  const query = controlledQuery !== undefined ? controlledQuery : internalQuery;
  const focusIndex = controlledIndex !== undefined ? controlledIndex : internalFocusIndex;
  const setQuery = onQueryChange ?? setInternalQuery;

  const matches = fuzzyFilterModels(MODEL_CATALOG, query);
  const clampedIndex = matches.length === 0 ? 0 : Math.min(focusIndex, matches.length - 1);

  const activeIndicator = (m: ModelOption) =>
    m.id === activeModelId ? "● " : "○ ";
  const focusIndicator = (i: number) => (i === clampedIndex ? "› " : "  ");

  return React.createElement(
    Box,
    { flexDirection: "column", borderStyle: "round", borderColor: "cyan" },
    React.createElement(Text, { bold: true, color: "cyan" }, "▸ model:"),
    React.createElement(TextInput, {
      value: query,
      onChange: setQuery,
      placeholder: "Filter models / providers...",
    }),
    React.createElement(
      Text,
      { color: "gray" },
      ` ${matches.length} model${matches.length === 1 ? "" : "s"}`,
    ),
    matches.length === 0
      ? React.createElement(Text, { color: "gray" }, "no matching models")
      : matches.map((m, i) => {
          const focused = i === clampedIndex;
          return React.createElement(
            Box,
            {
              key: m.id,
              flexDirection: "row",
            },
            React.createElement(
              Text,
              {
                color: focused ? "cyan" : undefined,
                bold: focused,
              },
              `${focusIndicator(i)}${activeIndicator(m)}[${m.provider}] ${m.name}  ${m.hint}`,
            ),
          );
        }),
    React.createElement(
      Text,
      { color: "gray" },
      "↑/↓: move • Tab: jump • Enter: pick • Esc: close",
    ),
  );
}

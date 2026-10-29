import React from "react";
import type { ReactElement } from "react";
import { Box, Text } from "ink";

export type MessageRole = "user" | "assistant" | "system";
export type SystemMessageType = "info" | "warning" | "success" | "goal";

export interface ChatMessageProps {
  role: MessageRole;
  content: string;
  reasoning?: string;
  isStreamingReasoning?: boolean;
  isReasoningCollapsed?: boolean;
  timestamp?: string;
  tokenCount?: number;
  systemType?: SystemMessageType;
  onToggleReasoning?: () => void;
}

export interface SystemBadgeInfo {
  icon: string;
  label: string;
  color: "cyan" | "yellow" | "green" | "magenta";
}

/**
 * Returns icon, label, and color for a system message based on type or content keywords.
 */
export function getSystemIcon(
  systemType?: SystemMessageType,
  content?: string,
): SystemBadgeInfo {
  if (systemType) {
    switch (systemType) {
      case "warning":
        return { icon: "⚠", label: "Warning", color: "yellow" };
      case "success":
        return { icon: "✓", label: "Success", color: "green" };
      case "goal":
        return { icon: "🎯", label: "Goal", color: "magenta" };
      case "info":
      default:
        return { icon: "ℹ", label: "System", color: "cyan" };
    }
  }

  // Infer from content if not explicitly specified
  const text = (content || "").toLowerCase();
  if (text.includes("✓") || text.includes("success") || text.includes("complete") || text.includes("done")) {
    return { icon: "✓", label: "Success", color: "green" };
  }
  if (text.includes("⚠") || text.includes("warn") || text.includes("error") || text.includes("failed")) {
    return { icon: "⚠", label: "Warning", color: "yellow" };
  }
  if (text.includes("🎯") || text.includes("goal") || text.includes("objective")) {
    return { icon: "🎯", label: "Goal", color: "magenta" };
  }

  return { icon: "ℹ", label: "System", color: "cyan" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Markdown Parser & Formatter
// ─────────────────────────────────────────────────────────────────────────────

export type InlineToken =
  | { type: "text"; text: string }
  | { type: "bold"; text: string }
  | { type: "code"; text: string };

export type MarkdownBlock =
  | { type: "header"; level: 1 | 2 | 3; text: string }
  | { type: "code_block"; language: string; content: string }
  | { type: "bullet"; text: string; indent?: number }
  | { type: "numbered"; number: string; text: string; indent?: number }
  | { type: "paragraph"; text: string };

/**
 * Parses inline formatting: **bold** and `code`.
 */
export function parseInline(text: string): InlineToken[] {
  if (!text) return [];
  const tokens: InlineToken[] = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: "text", text: text.slice(lastIndex, match.index) });
    }
    const m = match[0];
    if (m.startsWith("**") && m.endsWith("**")) {
      tokens.push({ type: "bold", text: m.slice(2, -2) });
    } else if (m.startsWith("`") && m.endsWith("`")) {
      tokens.push({ type: "code", text: m.slice(1, -1) });
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    tokens.push({ type: "text", text: text.slice(lastIndex) });
  }
  return tokens;
}

/**
 * Parses markdown text into structured blocks (headers, code blocks, lists, paragraphs).
 */
export function parseMarkdown(markdown: string): MarkdownBlock[] {
  if (!markdown) return [];
  const blocks: MarkdownBlock[] = [];
  const lines = markdown.split(/\r?\n/);
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code blocks ```lang
    const codeMatch = line.trim().match(/^```([a-zA-Z0-9_-]*)/);
    if (codeMatch) {
      const language = codeMatch[1] || "";
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      blocks.push({
        type: "code_block",
        language,
        content: codeLines.join("\n"),
      });
      continue;
    }

    // Headers: # Heading 1, ## Heading 2, ### Heading 3
    const headerMatch = line.match(/^(#{1,3})\s+(.*)$/);
    if (headerMatch) {
      const level = headerMatch[1].length as 1 | 2 | 3;
      blocks.push({
        type: "header",
        level,
        text: headerMatch[2].trim(),
      });
      i++;
      continue;
    }

    // Bullet items: - item or * item
    const bulletMatch = line.match(/^(\s*)([-*])\s+(.*)$/);
    if (bulletMatch) {
      const indent = Math.floor(bulletMatch[1].length / 2);
      blocks.push({
        type: "bullet",
        text: bulletMatch[3],
        indent,
      });
      i++;
      continue;
    }

    // Numbered lists: 1. item, 2. item
    const numberedMatch = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
    if (numberedMatch) {
      const indent = Math.floor(numberedMatch[1].length / 2);
      blocks.push({
        type: "numbered",
        number: numberedMatch[2],
        text: numberedMatch[3],
        indent,
      });
      i++;
      continue;
    }

    // Empty lines
    if (line.trim().length === 0) {
      i++;
      continue;
    }

    // Paragraph block: collect consecutive lines
    const pLines: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim().length > 0 &&
      !lines[i].trim().startsWith("```") &&
      !lines[i].match(/^#{1,3}\s+/) &&
      !lines[i].match(/^\s*[-*]\s+/) &&
      !lines[i].match(/^\s*\d+\.\s+/)
    ) {
      pLines.push(lines[i]);
      i++;
    }
    blocks.push({
      type: "paragraph",
      text: pLines.join(" "),
    });
  }

  return blocks;
}

/**
 * Renders inline tokens into React Elements.
 */
function renderInlineTokens(tokens: InlineToken[]): ReactElement[] {
  return tokens.map((tok, idx) => {
    switch (tok.type) {
      case "bold":
        return React.createElement(Text, { key: idx, bold: true }, tok.text);
      case "code":
        return React.createElement(
          Text,
          { key: idx, color: "yellow" },
          `\`${tok.text}\``,
        );
      case "text":
      default:
        return React.createElement(Text, { key: idx }, tok.text);
    }
  });
}

/**
 * Renders markdown text into styled Ink elements.
 */
export function renderMarkdown(markdown: string): ReactElement {
  const blocks = parseMarkdown(markdown);

  return React.createElement(
    Box,
    { flexDirection: "column" },
    blocks.map((block, idx) => {
      switch (block.type) {
        case "header": {
          const color =
            block.level === 1 ? "cyan" : block.level === 2 ? "blue" : "magenta";
          const prefix = "#".repeat(block.level);
          return React.createElement(
            Box,
            { key: idx, marginTop: idx > 0 ? 1 : 0 },
            React.createElement(
              Text,
              { bold: true, color },
              `${prefix} ${block.text}`,
            ),
          );
        }

        case "code_block": {
          const codeLines = block.content.split("\n");
          return React.createElement(
            Box,
            {
              key: idx,
              flexDirection: "column",
              borderStyle: "round",
              borderColor: "gray",
              paddingX: 1,
              marginY: 1,
            },
            React.createElement(
              Box,
              { justifyContent: "space-between", marginBottom: 0 },
              React.createElement(
                Text,
                { color: "cyan", dimColor: true },
                `[${block.language || "code"}]`,
              ),
            ),
            codeLines.map((codeLine, lineIdx) =>
              React.createElement(
                Box,
                { key: lineIdx },
                React.createElement(
                  Text,
                  { color: "gray", dimColor: true },
                  `${String(lineIdx + 1).padStart(2, " ")} │ `,
                ),
                React.createElement(
                  Text,
                  { color: "white" },
                  codeLine || " ",
                ),
              ),
            ),
          );
        }

        case "bullet": {
          const indent = "  ".repeat(block.indent || 0);
          return React.createElement(
            Box,
            { key: idx, marginLeft: (block.indent || 0) * 2 },
            React.createElement(Text, { color: "cyan" }, `${indent}• `),
            React.createElement(
              Box,
              { flexWrap: "wrap" },
              renderInlineTokens(parseInline(block.text)),
            ),
          );
        }

        case "numbered": {
          const indent = "  ".repeat(block.indent || 0);
          return React.createElement(
            Box,
            { key: idx, marginLeft: (block.indent || 0) * 2 },
            React.createElement(
              Text,
              { color: "cyan" },
              `${indent}${block.number}. `,
            ),
            React.createElement(
              Box,
              { flexWrap: "wrap" },
              renderInlineTokens(parseInline(block.text)),
            ),
          );
        }

        case "paragraph":
        default:
          return React.createElement(
            Box,
            { key: idx, flexWrap: "wrap", marginBottom: 0 },
            renderInlineTokens(parseInline(block.text)),
          );
      }
    }),
  );
}

/**
 * MarkdownText component.
 */
export function MarkdownText(props: { text: string }): ReactElement {
  return renderMarkdown(props.text);
}

// ─────────────────────────────────────────────────────────────────────────────
// Collapsible Reasoning Block
// ─────────────────────────────────────────────────────────────────────────────

export interface ReasoningBlockProps {
  reasoning?: string;
  isStreaming?: boolean;
  isCollapsed?: boolean;
  onToggle?: () => void;
}

/**
 * Renders a collapsible thinking/reasoning stream block.
 */
export function ReasoningBlock({
  reasoning,
  isStreaming,
  isCollapsed = false,
}: ReasoningBlockProps): ReactElement | null {
  if (!reasoning && !isStreaming) {
    return null;
  }

  const lines = reasoning ? reasoning.trim().split(/\r?\n/) : [];

  if (isStreaming && lines.length === 0) {
    return React.createElement(
      Box,
      { marginY: 0 },
      React.createElement(Text, { color: "yellow" }, "⠋ Thinking..."),
    );
  }

  if (isCollapsed) {
    return React.createElement(
      Box,
      { marginY: 0 },
      React.createElement(
        Text,
        { color: "gray", italic: true, dimColor: true },
        `▶ Thinking: (${lines.length} lines hidden)`,
      ),
    );
  }

  return React.createElement(
    Box,
    { flexDirection: "column", marginY: 0 },
    React.createElement(
      Box,
      null,
      React.createElement(
        Text,
        { color: "gray", bold: true, dimColor: true },
        isStreaming ? "⠋ Thinking..." : "▼ Thinking:",
      ),
    ),
    React.createElement(
      Box,
      {
        flexDirection: "column",
        paddingLeft: 1,
        borderStyle: "single",
        borderColor: "gray",
      },
      lines.map((line, idx) =>
        React.createElement(
          Text,
          { key: idx, color: "gray", italic: true, dimColor: true },
          line || " ",
        ),
      ),
    ),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Chat Message Component
// ─────────────────────────────────────────────────────────────────────────────

export function ChatMessageBubble({
  role,
  content,
  reasoning,
  isStreamingReasoning,
  isReasoningCollapsed,
  timestamp,
  tokenCount,
  systemType,
  onToggleReasoning,
}: ChatMessageProps): ReactElement {
  // Format metadata tag (timestamp / tokens)
  const metaBadge = timestamp
    ? `${timestamp}${tokenCount !== undefined ? ` · ${tokenCount} tok` : ""}`
    : tokenCount !== undefined
      ? `${tokenCount} tok`
      : null;

  if (role === "user") {
    return React.createElement(
      Box,
      {
        flexDirection: "column",
        borderStyle: "round",
        borderColor: "cyan",
        paddingX: 1,
        marginBottom: 1,
      },
      React.createElement(
        Box,
        { justifyContent: "space-between", marginBottom: 0 },
        React.createElement(Text, { bold: true, color: "cyan" }, "❯ You"),
        metaBadge
          ? React.createElement(
              Text,
              { color: "gray", dimColor: true },
              metaBadge,
            )
          : null,
      ),
      React.createElement(Text, {}, content),
    );
  }

  if (role === "assistant") {
    return React.createElement(
      Box,
      {
        flexDirection: "column",
        borderStyle: "round",
        borderColor: "magenta",
        paddingX: 1,
        marginBottom: 1,
      },
      React.createElement(
        Box,
        { justifyContent: "space-between", marginBottom: 0 },
        React.createElement(
          Box,
          null,
          React.createElement(Text, { bold: true, color: "green" }, "✦ "),
          React.createElement(Text, { bold: true, color: "magenta" }, "Signhify"),
        ),
        metaBadge
          ? React.createElement(
              Text,
              { color: "gray", dimColor: true },
              metaBadge,
            )
          : null,
      ),
      reasoning || isStreamingReasoning
        ? ReasoningBlock({
            reasoning,
            isStreaming: isStreamingReasoning,
            isCollapsed: isReasoningCollapsed,
            onToggle: onToggleReasoning,
          })
        : null,
      renderMarkdown(content),
    );
  }

  // System / Event message
  const badge = getSystemIcon(systemType, content);
  return React.createElement(
    Box,
    {
      flexDirection: "column",
      borderStyle: "round",
      borderColor: badge.color,
      paddingX: 1,
      marginBottom: 1,
    },
    React.createElement(
      Box,
      { justifyContent: "space-between", marginBottom: 0 },
      React.createElement(
        Text,
        { bold: true, color: badge.color },
        `${badge.icon} ${badge.label}`,
      ),
      metaBadge
        ? React.createElement(Text, { color: "gray", dimColor: true }, metaBadge)
        : null,
    ),
    React.createElement(Text, {}, content),
  );
}

export { ChatMessageBubble as ChatMessage };

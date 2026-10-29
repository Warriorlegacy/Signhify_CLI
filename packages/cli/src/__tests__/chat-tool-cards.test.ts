import { describe, it, expect } from "vitest";
import {
  ChatMessageBubble,
  ReasoningBlock,
  renderMarkdown,
  parseMarkdown,
  parseInline,
  getSystemIcon,
} from "../tui/chat-message.js";
import {
  ToolCard,
  DiffViewer,
  parseDiff,
  getToolIcon,
  formatToolArgs,
  getToolStatusBadge,
} from "../tui/tool-card.js";

describe("TUI Chat Messages & Markdown Formatter", () => {
  describe("Role styling and badges", () => {
    it("renders user message with '❯ You' header, cyan border, and timestamp/token metadata", () => {
      const element = ChatMessageBubble({
        role: "user",
        content: "Please build the signhify feature",
        timestamp: "10:30 AM",
        tokenCount: 42,
      });

      const json = JSON.stringify(element);
      expect(json).toContain("❯ You");
      expect(json).toContain("10:30 AM · 42 tok");
      expect(json).toContain("Please build the signhify feature");
      expect(element.props.borderColor).toBe("cyan");
      expect(element.props.borderStyle).toBe("round");
    });

    it("renders assistant message with '✦ Signhify' avatar and magenta border", () => {
      const element = ChatMessageBubble({
        role: "assistant",
        content: "Here is your solution",
        tokenCount: 120,
      });

      const json = JSON.stringify(element);
      expect(json).toContain("✦ ");
      expect(json).toContain("Signhify");
      expect(json).toContain("120 tok");
      expect(json).toContain("Here is your solution");
      expect(element.props.borderColor).toBe("magenta");
      expect(element.props.borderStyle).toBe("round");
    });

    it("renders system messages with proper icons and color mappings", () => {
      // Info
      const infoBadge = getSystemIcon("info");
      expect(infoBadge.icon).toBe("ℹ");
      expect(infoBadge.label).toBe("System");
      expect(infoBadge.color).toBe("cyan");

      // Warning
      const warnBadge = getSystemIcon("warning");
      expect(warnBadge.icon).toBe("⚠");
      expect(warnBadge.label).toBe("Warning");
      expect(warnBadge.color).toBe("yellow");

      // Success
      const successBadge = getSystemIcon("success");
      expect(successBadge.icon).toBe("✓");
      expect(successBadge.label).toBe("Success");
      expect(successBadge.color).toBe("green");

      // Goal
      const goalBadge = getSystemIcon("goal");
      expect(goalBadge.icon).toBe("🎯");
      expect(goalBadge.label).toBe("Goal");
      expect(goalBadge.color).toBe("magenta");

      // Inferred from content
      expect(getSystemIcon(undefined, "Goal achieved!").icon).toBe("🎯");
      expect(getSystemIcon(undefined, "Task completed successfully").icon).toBe("✓");
      expect(getSystemIcon(undefined, "Warning: rate limit near").icon).toBe("⚠");

      const sysMsg = ChatMessageBubble({
        role: "system",
        content: "✓ All tests passing",
        systemType: "success",
      });
      const sysJson = JSON.stringify(sysMsg);
      expect(sysJson).toContain("✓ Success");
      expect(sysMsg.props.borderColor).toBe("green");
    });
  });

  describe("Reasoning block collapsible stream", () => {
    it("returns null if no reasoning and not streaming", () => {
      const element = ReasoningBlock({});
      expect(element).toBeNull();
    });

    it("renders '⠋ Thinking...' when streaming without text", () => {
      const element = ReasoningBlock({ isStreaming: true });
      expect(element).not.toBeNull();
      const json = JSON.stringify(element);
      expect(json).toContain("⠋ Thinking...");
    });

    it("renders collapsible indicator '▼ Thinking:' and dim/italic lines when expanded", () => {
      const element = ReasoningBlock({
        reasoning: "Step 1: Check existing components\nStep 2: Build card",
        isCollapsed: false,
      });
      expect(element).not.toBeNull();
      const json = JSON.stringify(element);
      expect(json).toContain("▼ Thinking:");
      expect(json).toContain("Step 1: Check existing components");
      expect(json).toContain("Step 2: Build card");
      expect(json).toContain('"italic":true');
      expect(json).toContain('"dimColor":true');
    });

    it("renders collapsed indicator '▶ Thinking:' when collapsed", () => {
      const element = ReasoningBlock({
        reasoning: "Line A\nLine B\nLine C",
        isCollapsed: true,
      });
      expect(element).not.toBeNull();
      const json = JSON.stringify(element);
      expect(json).toContain("▶ Thinking: (3 lines hidden)");
      expect(json).not.toContain("Line A");
    });
  });

  describe("Markdown parser and formatter", () => {
    it("parses inline bold and inline code correctly", () => {
      const tokens = parseInline("Run `npm test` to see **bold results** clearly.");
      expect(tokens).toEqual([
        { type: "text", text: "Run " },
        { type: "code", text: "npm test" },
        { type: "text", text: " to see " },
        { type: "bold", text: "bold results" },
        { type: "text", text: " clearly." },
      ]);
    });

    it("parses headers with distinct levels", () => {
      const md = "# Title 1\n## Section 2\n### Subsection 3";
      const blocks = parseMarkdown(md);
      expect(blocks).toEqual([
        { type: "header", level: 1, text: "Title 1" },
        { type: "header", level: 2, text: "Section 2" },
        { type: "header", level: 3, text: "Subsection 3" },
      ]);

      const rendered = renderMarkdown(md);
      const json = JSON.stringify(rendered);
      expect(json).toContain("# Title 1");
      expect(json).toContain("## Section 2");
      expect(json).toContain("### Subsection 3");
      expect(json).toContain('"color":"cyan"');
      expect(json).toContain('"color":"blue"');
      expect(json).toContain('"color":"magenta"');
    });

    it("parses and renders fenced code blocks with language badge and border box", () => {
      const md = "```ts\nconst greeting: string = 'hello';\nconsole.log(greeting);\n```";
      const blocks = parseMarkdown(md);
      expect(blocks).toEqual([
        {
          type: "code_block",
          language: "ts",
          content: "const greeting: string = 'hello';\nconsole.log(greeting);",
        },
      ]);

      const rendered = renderMarkdown(md);
      const json = JSON.stringify(rendered);
      expect(json).toContain("[ts]");
      expect(json).toContain("borderStyle");
      expect(json).toContain("const greeting: string = 'hello';");
      expect(json).toContain("console.log(greeting);");
    });

    it("parses and renders bullet lists and numbered lists with indentation", () => {
      const md = "- First bullet\n* Second bullet\n1. Number one\n2. Number two";
      const blocks = parseMarkdown(md);
      expect(blocks).toEqual([
        { type: "bullet", text: "First bullet", indent: 0 },
        { type: "bullet", text: "Second bullet", indent: 0 },
        { type: "numbered", number: "1", text: "Number one", indent: 0 },
        { type: "numbered", number: "2", text: "Number two", indent: 0 },
      ]);

      const rendered = renderMarkdown(md);
      const json = JSON.stringify(rendered);
      expect(json).toContain("• ");
      expect(json).toContain("First bullet");
      expect(json).toContain("Second bullet");
      expect(json).toContain("1. ");
      expect(json).toContain("Number one");
      expect(json).toContain("2. ");
      expect(json).toContain("Number two");
    });
  });
});

describe("TUI Tool Execution Cards & Diff Viewer", () => {
  describe("Tool Icons and Argument Formatting", () => {
    it("maps standard tools to Cline/Antigravity icons", () => {
      expect(getToolIcon("read_file")).toBe("⚡");
      expect(getToolIcon("file_io")).toBe("⚡");
      expect(getToolIcon("shell_exec")).toBe("💻");
      expect(getToolIcon("bash")).toBe("💻");
      expect(getToolIcon("terminal")).toBe("💻");
      expect(getToolIcon("search_files")).toBe("🔍");
      expect(getToolIcon("grep")).toBe("🔍");
      expect(getToolIcon("write_file")).toBe("📁");
      expect(getToolIcon("patch")).toBe("📁");
      expect(getToolIcon("git")).toBe("◈");
      expect(getToolIcon("browser")).toBe("🌐");
      expect(getToolIcon("subagent")).toBe("🤖");
    });

    it("formats tool arguments into a clean summary", () => {
      expect(formatToolArgs("read_file", { path: "src/index.ts" })).toBe("path: src/index.ts");
      expect(formatToolArgs("shell_exec", { command: "npm test" })).toBe("command: npm test");
      expect(formatToolArgs("search_files", { pattern: "ChatMessage" })).toBe("pattern: ChatMessage");
      expect(formatToolArgs("write_file", { path: "dist/bundle.js", content: "..." })).toBe("path: dist/bundle.js");
      expect(formatToolArgs("git", { action: "status" })).toBe("action: status");
      expect(formatToolArgs("browser", { url: "https://github.com" })).toBe("url: https://github.com");
      expect(formatToolArgs("subagent", { task: "code review" })).toBe("task: code review");
    });

    it("tolerates JSON strings as tool arguments", () => {
      expect(formatToolArgs("read_file", '{"path": "package.json"}')).toBe("path: package.json");
    });
  });

  describe("Tool Card States and Badges", () => {
    it("returns running status badge with yellow spinner", () => {
      const badge = getToolStatusBadge("running");
      expect(badge.icon).toBe("⠋");
      expect(badge.label).toBe("Running...");
      expect(badge.color).toBe("yellow");

      const card = ToolCard({
        toolName: "shell_exec",
        args: { command: "npm test" },
        status: "running",
      });
      const json = JSON.stringify(card);
      expect(json).toContain("💻 shell_exec");
      expect(json).toContain("command: npm test");
      expect(json).toContain("⠋ Running...");
      expect(card.props.borderColor).toBe("yellow");
    });

    it("returns completed status badge with green indicator", () => {
      const badge = getToolStatusBadge("completed");
      expect(badge.icon).toBe("✓");
      expect(badge.label).toBe("Completed");
      expect(badge.color).toBe("green");

      const card = ToolCard({
        toolName: "read_file",
        args: { path: "src/tui/footer.tsx" },
        status: "completed",
        output: "file content 123",
      });
      const json = JSON.stringify(card);
      expect(json).toContain("⚡ read_file");
      expect(json).toContain("✓ Completed");
      expect(json).toContain("file content 123");
      expect(card.props.borderColor).toBe("green");
    });

    it("returns failed status badge with red indicator and error text", () => {
      const badge = getToolStatusBadge("failed", "File not found");
      expect(badge.icon).toBe("✗");
      expect(badge.label).toBe("Failed: File not found");
      expect(badge.color).toBe("red");

      const card = ToolCard({
        toolName: "read_file",
        args: { path: "missing.ts" },
        status: "failed",
        error: "ENOENT: no such file or directory",
      });
      const json = JSON.stringify(card);
      expect(json).toContain("⚡ read_file");
      expect(json).toContain("✗ Failed: ENOENT: no such file or directory");
      expect(card.props.borderColor).toBe("red");
    });
  });

  describe("Unified Diff Viewer & Diff Line Parsing", () => {
    it("parses unified diff hunks, additions, deletions, and context lines", () => {
      const diffText = [
        "--- a/src/app.ts",
        "+++ b/src/app.ts",
        "@@ -10,4 +10,5 @@",
        " const initial = 1;",
        "-const obsolete = 2;",
        "+const updated = 3;",
        "+const bonus = 4;",
        " export default initial;",
      ].join("\n");

      const parsed = parseDiff(diffText);
      expect(parsed).toHaveLength(8);

      expect(parsed[0]).toEqual({ type: "header", content: "--- a/src/app.ts" });
      expect(parsed[1]).toEqual({ type: "header", content: "+++ b/src/app.ts" });
      expect(parsed[2]).toEqual({ type: "hunk", content: "@@ -10,4 +10,5 @@" });

      // Context line
      expect(parsed[3]).toEqual({
        type: "context",
        content: "const initial = 1;",
        oldLine: 10,
        newLine: 10,
      });

      // Deletion line
      expect(parsed[4]).toEqual({
        type: "delete",
        content: "const obsolete = 2;",
        oldLine: 11,
      });

      // Added lines
      expect(parsed[5]).toEqual({
        type: "add",
        content: "const updated = 3;",
        newLine: 11,
      });
      expect(parsed[6]).toEqual({
        type: "add",
        content: "const bonus = 4;",
        newLine: 12,
      });

      // Following context line
      expect(parsed[7]).toEqual({
        type: "context",
        content: "export default initial;",
        oldLine: 12,
        newLine: 13,
      });
    });

    it("renders DiffViewer with line numbers, green additions, and red deletions", () => {
      const diffText = [
        "@@ -1,2 +1,2 @@",
        "-const x = 'before';",
        "+const x = 'after';",
      ].join("\n");

      const element = DiffViewer({ diff: diffText });
      const json = JSON.stringify(element);

      expect(json).toContain("Unified Diff");
      expect(json).toContain("@@ -1,2 +1,2 @@");
      expect(json).toContain("- const x = 'before';");
      expect(json).toContain("+ const x = 'after';");
      expect(json).toContain('"color":"red"');
      expect(json).toContain('"color":"green"');
      expect(json).toContain('"color":"gray"');
    });

    it("renders ToolCard with embedded DiffViewer when diff prop is provided", () => {
      const diffText = [
        "@@ -5,1 +5,1 @@",
        "-let count = 0;",
        "+let count = 1;",
      ].join("\n");

      const card = ToolCard({
        toolName: "patch",
        args: { path: "src/counter.ts" },
        status: "completed",
        diff: diffText,
      });

      const json = JSON.stringify(card);
      expect(json).toContain("📁 patch");
      expect(json).toContain("path: src/counter.ts");
      expect(json).toContain("✓ Completed");
      expect(json).toContain("- let count = 0;");
      expect(json).toContain("+ let count = 1;");
    });
  });
});

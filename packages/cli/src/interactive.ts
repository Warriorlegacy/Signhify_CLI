import React, { useState, useCallback, useEffect, useRef } from "react";
import { render, Box, Text, useInput, useApp } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import { SignhifyConfig, AgentLoop, Goal, TaskNode } from "@signhify/core";
import { saveConfig, resolveApiKeyRef } from "./config.js";
import {
  buildSidebarSections,
  type SidebarState,
  toggleSidebarSection,
} from "./tui/sidebar/index.js";
import {
  fuzzyFilter,
  nextPaletteIndex,
  PaletteOverlay,
  type PaletteCommand,
} from "./tui/palette.js";
import {
  createAdapter,
  FallbackRouter,
  FallbackEvent,
  DEFAULT_ZERO_COST_CHAIN,
} from "@signhify/providers";
import {
  MemoryMdManager,
  MemoryStore,
  DreamDistillEngine,
  CheckpointWriter,
} from "@signhify/memory";
import {
  fileIoTool,
  shellExecTool,
  gitTool,
  searchTool,
  browserTool,
  mcpClientTool,
  subagentTool,
  configureSubagents,
  connectMcpServers,
} from "@signhify/tools";
import { createRequire } from "node:module";
import * as path from "node:path";

const require = createRequire(import.meta.url);
const { version: CLI_VERSION } = require("../package.json") as { version: string };

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

const MODE_CYCLE = ["build", "plan", "debug", "compose"] as const;

// Command palette registry — every entry dispatches a real handler below.
// /model and /compact stay out until they are implemented; a palette entry
// that dies on Enter would be a lie.
const PALETTE_COMMANDS: PaletteCommand[] = [
  { name: "/clear", description: "clear the conversation" },
  { name: "/mode", description: "build | plan | debug | compose" },
  { name: "/context-limit", description: "set the context token budget" },
  { name: "/sidebar", description: "toggle sidebar (or collapse <id>)" },
  { name: "/goal", description: "set the stop condition" },
  { name: "/mcp", description: "show MCP server status" },
  { name: "/sessions", description: "list recent sessions" },
  { name: "/memory", description: "show MEMORY.md" },
  { name: "/dream", description: "consolidate session notes" },
  { name: "/distill", description: "distill long-term notes" },
  { name: "/exit", description: "quit Signhify" },
];

function ChatApp({ config: initialConfig }: { config: SignhifyConfig }) {
  // Mutable copy so runtime settings (/context-limit) survive into the loop
  // that buildLoop constructs on each submit.
  const [config, setConfig] = useState<SignhifyConfig>(initialConfig);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<string>("build");
  const [goal, setGoal] = useState<Goal | undefined>();
  const [taskTree, setTaskTree] = useState<TaskNode[]>([]);
  const [memoryContent, setMemoryContent] = useState("");
  const [checkpointContent, setCheckpointContent] = useState("");
  const [taskProgress, setTaskProgress] = useState("");
  const [showSidebar, setShowSidebar] = useState(true);
  const [collapsedSections, setCollapsedSections] = useState<string[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [tokenUsage, setTokenUsage] = useState({
    used: 0,
    limit: config.memory?.contextLimit ?? 128000,
  });
  const [activeRouterInfo, setActiveRouterInfo] = useState<string>("not connected");
  const [runningTools, setRunningTools] = useState<number>(0);
  const [mcpStatuses, setMcpStatuses] = useState<
    Array<{ name: string; status: "connected" | "failed" | "disabled"; error?: string }>
  >([]);
  const { exit } = useApp();

  const cwd = process.cwd();
  const memoryMd = new MemoryMdManager(cwd);
  const memoryStore = new MemoryStore(path.join(cwd, ".signhify", "memory.db"));
  const checkpointWriter = new CheckpointWriter(memoryStore, cwd);
  const dreamDistill = new DreamDistillEngine(memoryStore, memoryMd);

  // Session registry: one row per interactive run; checkpoints link to this id.
  const [sessionId] = useState(() => memoryStore.createSession(cwd));
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;

  useEffect(() => {
    (async () => {
      const [mem, cp] = await Promise.all([
        memoryMd.readMemoryMd(),
        checkpointWriter.readLatestCheckpoint(),
      ]);
      if (mem) setMemoryContent(mem);
      if (cp) {
        const parts: string[] = [];
        if (cp.summary) parts.push(`## Previous Session Summary\n${cp.summary}`);
        if (cp.sections.decisions.length)
          parts.push(`## Decisions\n${cp.sections.decisions.map((d) => `- ${d}`).join("\n")}`);
        if (cp.sections.openIssues.length)
          parts.push(`## Open Issues\n${cp.sections.openIssues.map((i) => `- ${i}`).join("\n")}`);
        setCheckpointContent(parts.join("\n\n"));
        if (cp.sections.taskProgress) setTaskProgress(cp.sections.taskProgress);
      }
    })();

    // Real status only: a server that did not connect is never shown as connected.
    const configured = config.mcpServers ?? [];
    if (configured.length > 0) {
      connectMcpServers(configured, process.cwd())
        .then((statuses) => setMcpStatuses(statuses))
        .catch(() => {
          // connectMcpServers never throws; keep the sidebar empty rather than guess.
        });
    }
  }, [config]);

  const buildLoop = useCallback(async () => {
    let adapter;
    const rawChain =
      config.provider.fallbackChain && config.provider.fallbackChain.length > 0
        ? config.provider.fallbackChain
        : DEFAULT_ZERO_COST_CHAIN;
    // apiKeyRef (env:/literal) is the single source; resolve to the concrete
    // key the provider factory expects before routing.
    const fallbackChain = (await Promise.all(
      (rawChain as import("@signhify/providers").EndpointConfig[]).map(async (ep) => {
        const key = await resolveApiKeyRef(ep.apiKeyRef);
        return "apiKeyRef" in ep && key != null ? { ...ep, apiKey: key } : ep;
      }),
    )) as import("@signhify/providers").EndpointConfig[];

    if (process.env.SIGNHIFY_MOCK_PROVIDER === "1" || config.provider.agent.vendor === "mock") {
      adapter = await createAdapter({ vendor: "mock", model: "mock-model" });
      setActiveRouterInfo("mock");
    } else {
      const router = new FallbackRouter({
        endpoints: fallbackChain as import("@signhify/providers").EndpointConfig[],
        onFallback: (event: FallbackEvent) => {
          setActiveRouterInfo(`${event.toEndpoint} (fallback)`);
          setMessages((prev) => [
            ...prev,
            {
              role: "system",
              content: `[Fallback] ${event.fromEndpoint} -> ${event.toEndpoint} (${event.reason})`,
            },
          ]);
        },
        // The router only knows an endpoint answered once it streams; report
        // that rather than the configured-but-possibly-dead first entry.
        onEndpointSuccess: (endpointName: string) => {
          setActiveRouterInfo(endpointName);
        },
      });
      adapter = router;
      setActiveRouterInfo("connecting…");
    }

    // Subagents get whatever adapter this session routes through; the planner
    // also persists its task tree through the same SQLite store.
    configureSubagents({
      adapter,
      model: config.provider.agent.model,
      memory: memoryStore,
    });

    const loop = new AgentLoop({
      config,
      workingDirectory: process.cwd(),
      provider: adapter,
      sessionId,
      autoMode: false,
      goal,
      memoryContent,
      checkpointContent,
      taskProgress,
      onCheckpoint: (sid, usage) => {
        setTokenUsage((prev) => ({ ...prev, used: usage }));
        // Persist the real checkpoint so the /sessions id stays resumable.
        void checkpointWriter
          .writeCheckpoint({
            sessionId: sid,
            summary: `Auto-checkpoint at ${usage} tokens after ${messagesRef.current.length} message(s).`,
            tokenUsage: usage,
            decisions: [],
            currentDiffs: [],
            openIssues: [],
          })
          .catch(() => {
            // checkpoint write is best-effort; the loop continues regardless
          });
      },
      onStream: (chunk) => {
        if (chunk.type === "done" && chunk.usage) {
          setTokenUsage((prev) => ({
            ...prev,
            used: chunk.usage?.totalTokens ?? prev.used,
          }));
        }
        if (chunk.type === "tool_call") {
          setRunningTools((n) => n + 1);
        }
      },
      onToolResult: () => {
        setRunningTools((n) => Math.max(0, n - 1));
      },
    });

    loop.getModeManager().setMode(mode as "build" | "plan" | "debug" | "compose");
    loop.registerTool(fileIoTool);
    loop.registerTool(shellExecTool);
    loop.registerTool(gitTool);
    loop.registerTool(searchTool);
    loop.registerTool(browserTool);
    loop.registerTool(mcpClientTool);
    loop.registerTool(subagentTool);
    return loop;
  }, [config, mode, goal, memoryContent, checkpointContent, taskProgress]);

  const handleSubmit = useCallback(
    async (value: string) => {
      if (!value.trim()) return;

      // Handle slash commands
      if (value.startsWith("/")) {
        const parts = value.trim().split(/\s+/);
        const cmd = parts[0].toLowerCase();
        const arg = parts.slice(1).join(" ");

        if (cmd === "/exit" || cmd === "/quit") {
          exit();
          return;
        }
        if (cmd === "/clear") {
          setMessages([]);
          setInput("");
          return;
        }
        if (cmd === "/sidebar") {
          // "/sidebar" toggles the sidebar; "/sidebar <id>" collapses one section.
          if (arg) {
            setCollapsedSections((prev) => toggleSidebarSection(prev, arg));
          } else {
            setShowSidebar((prev) => !prev);
          }
          setInput("");
          return;
        }
        if (cmd === "/mode") {
          if (arg && MODE_CYCLE.includes(arg as (typeof MODE_CYCLE)[number])) {
            setMode(arg);
            setMessages((prev) => [
              ...prev,
              { role: "system", content: `Mode switched to [${arg}]` },
            ]);
          } else {
            setMessages((prev) => [
              ...prev,
              { role: "system", content: `Usage: /mode <${MODE_CYCLE.join("|")}>` },
            ]);
          }
          setInput("");
          return;
        }
        if (cmd === "/context-limit") {
          const num = parseInt(arg, 10);
          if (!isNaN(num) && num >= 1000) {
            setTokenUsage((prev) => ({ ...prev, limit: num }));
            setConfig((prev) => ({
              ...prev,
              memory: { ...prev.memory, contextLimit: num },
            }));
            saveConfig({
              ...config,
              memory: { ...config.memory, contextLimit: num },
            }).catch((error: unknown) => {
              setMessages((prev) => [
                ...prev,
                {
                  role: "system",
                  content: `Warning: ${num} applied for this session but not saved — ${error instanceof Error ? error.message : String(error)}`,
                },
              ]);
            });
            setMessages((prev) => [
              ...prev,
              { role: "system", content: `Sliding-window context limit updated to ${num} tokens.` },
            ]);
          } else {
            setMessages((prev) => [
              ...prev,
              { role: "system", content: `Usage: /context-limit <tokens> (min: 1000)` },
            ]);
          }
          setInput("");
          return;
        }
        if (cmd === "/goal") {
          if (!arg) {
            setMessages((prev) => [
              ...prev,
              { role: "system", content: "Usage: /goal <statement> — set the stop condition" },
            ]);
          } else {
            const newGoal: Goal = { statement: arg, maxIterations: 50 };
            setGoal(newGoal);
            setMessages((prev) => [...prev, { role: "system", content: `Goal set: "${arg}"` }]);
          }
          setInput("");
          return;
        }
        if (cmd === "/sessions") {
          const rows = memoryStore.listSessions(10);
          setMessages((prev) => [
            ...prev,
            {
              role: "system",
              content:
                rows.length === 0
                  ? "No sessions registered yet."
                  : `Recent sessions (newest first):\n${rows
                      .map((s) => `${s.id}  ${s.createdAt ?? ""}${s.id === sessionId ? "  (current)" : ""}`)
                      .join("\n")}`,
            },
          ]);
          setInput("");
          return;
        }
        if (cmd === "/mcp") {
          setMessages((prev) => [
            ...prev,
            {
              role: "system",
              content:
                mcpStatuses.length === 0
                  ? "No MCP servers connected."
                  : `MCP servers:\n${mcpStatuses
                      .map(
                        (s) =>
                          `● ${s.name}: ${s.status}${s.error ? ` (${s.error})` : ""}`,
                      )
                      .join("\n")}`,
            },
          ]);
          setInput("");
          return;
        }
        if (cmd === "/memory") {
          setMessages((prev) => [
            ...prev,
            {
              role: "system",
              content: memoryContent || "MEMORY.md is empty or missing.",
            },
          ]);
          setInput("");
          return;
        }
        if (cmd === "/dream") {
          setIsLoading(true);
          try {
            const traces = messages.map((m) => `[${m.role}] ${m.content}`).join("\n");
            const result = await dreamDistill.dream(process.cwd(), traces ? [traces] : []);
            setMessages((prev) => [
              ...prev,
              { role: "system", content: `Dream complete: ${result.summary}` },
            ]);
          } catch (error) {
            setMessages((prev) => [
              ...prev,
              {
                role: "system",
                content: `Dream error: ${error instanceof Error ? error.message : String(error)}`,
              },
            ]);
          } finally {
            setIsLoading(false);
            setInput("");
          }
          return;
        }
        if (cmd === "/distill") {
          setIsLoading(true);
          try {
            const traces = messages.map((m) => `[${m.role}] ${m.content}`).join("\n");
            const result = await dreamDistill.distill(process.cwd(), traces ? [traces] : []);
            setMessages((prev) => [
              ...prev,
              { role: "system", content: `Distill complete: ${result.summary}` },
            ]);
          } catch (error) {
            setMessages((prev) => [
              ...prev,
              {
                role: "system",
                content: `Distill error: ${error instanceof Error ? error.message : String(error)}`,
              },
            ]);
          } finally {
            setIsLoading(false);
            setInput("");
          }
          return;
        }
      }

      setMessages((prev) => [...prev, { role: "user", content: value }]);
      setInput("");
      setIsLoading(true);

      try {
        const loop = await buildLoop();
        const result = await loop.run(value);

        if (result.error) {
          setMessages((prev) => [...prev, { role: "assistant", content: result.error! }]);
        } else {
          const lastAssistant = result.messages.filter((m) => m.role === "assistant").pop();
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: lastAssistant?.content ?? "Task finished successfully.",
            },
          ]);
        }

        setTaskTree(loop.getTaskManager().getTaskTree());
        // Usage comes from the stream's `done` chunk; adding prompt length on
        // top made the meter drift high on every turn.
      } catch (error) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ]);
      } finally {
        setIsLoading(false);
      }
    },
    [buildLoop, exit, dreamDistill, messages],
  );

  useInput((inputChar, key) => {
    if (key.ctrl && inputChar === "c") exit();
    if (key.ctrl && inputChar === "p") {
      setPaletteOpen((prev) => !prev);
      setPaletteQuery("");
      setPaletteIndex(0);
      return;
    }
    if (paletteOpen) {
      if (key.upArrow) setPaletteIndex((prev) => nextPaletteIndex(prev, fuzzyFilter(PALETTE_COMMANDS, paletteQuery).length, -1));
      else if (key.downArrow) setPaletteIndex((prev) => nextPaletteIndex(prev, fuzzyFilter(PALETTE_COMMANDS, paletteQuery).length, 1));
      else if (key.return) {
        const matches = fuzzyFilter(PALETTE_COMMANDS, paletteQuery);
        const picked = matches[Math.min(paletteIndex, matches.length - 1)];
        setPaletteOpen(false);
        setPaletteQuery("");
        setPaletteIndex(0);
        if (picked) void handleSubmit(picked.name);
      } else if (key.escape) {
        setPaletteOpen(false);
        setPaletteQuery("");
      } else if (key.backspace || key.delete) {
        setPaletteQuery((prev) => prev.slice(0, -1));
      } else if (inputChar && !key.ctrl && !key.meta) {
        setPaletteQuery((prev) => prev + inputChar);
      }
      return;
    }
    if (key.ctrl && inputChar === "b") setShowSidebar((prev) => !prev);
    if (key.tab) {
      setMode((prev) => {
        const idx = MODE_CYCLE.indexOf(prev as (typeof MODE_CYCLE)[number]);
        return MODE_CYCLE[(idx + 1) % MODE_CYCLE.length];
      });
    }
  });

  const modeColor =
    mode === "build" ? "green" : mode === "plan" ? "cyan" : mode === "debug" ? "red" : "magenta";
  const usagePct = (tokenUsage.used / tokenUsage.limit) * 100;
  const sidebarState: SidebarState = {
    tokenUsage,
    usagePct,
    activeRouterInfo,
    mcpStatuses,
    taskTree,
    collapsed: collapsedSections,
  };

  return React.createElement(
    Box,
    { flexDirection: "row", padding: 1 },
    // Left Main Panel
    React.createElement(
      Box,
      {
        flexDirection: "column",
        width: showSidebar ? "70%" : "100%",
        paddingRight: showSidebar ? 1 : 0,
      },
      React.createElement(
        Box,
        { marginBottom: 1, justifyContent: "space-between" },
        React.createElement(
          Box,
          null,
          React.createElement(Text, { bold: true, color: "white" }, `Signhify CLI `),
          React.createElement(Text, { color: "gray" }, `v${CLI_VERSION} `),
          React.createElement(Text, { color: modeColor, bold: true }, `[${mode.toUpperCase()}]`),
          goal ? React.createElement(Text, { color: "yellow" }, ` 🎯 "${goal.statement}"`) : null,
        ),
        React.createElement(Text, { color: "gray" }, "Tab: mode | Ctrl+B: sidebar | Ctrl+P: commands"),
      ),
      React.createElement(
        Box,
        { flexDirection: "column", marginBottom: 1 },
        messages.length === 0
          ? React.createElement(
              Text,
              { color: "gray" },
              "Type your objective or slash command (/goal, /mode, /context-limit, /sidebar, /dream)... ctrl+p for commands.",
            )
          : messages.map((msg, i) =>
              React.createElement(
                Box,
                { key: i, marginBottom: 1 },
                React.createElement(
                  Text,
                  {
                    bold: true,
                    color:
                      msg.role === "user" ? "blue" : msg.role === "system" ? "yellow" : "green",
                  },
                  `${msg.role === "user" ? "You" : msg.role === "system" ? "System" : "AI"}: `,
                ),
                React.createElement(Text, {}, msg.content),
              ),
            ),
      ),
      React.createElement(
        Box,
        null,
        isLoading
          ? React.createElement(
              Box,
              null,
              React.createElement(Spinner, { type: "dots" }),
              React.createElement(
                Text,
                { color: "yellow" },
                runningTools > 0
                  ? ` Running ${runningTools} tool${runningTools === 1 ? "" : "s"}...`
                  : " Thinking...",
              ),
            )
          : paletteOpen
            ? React.createElement(PaletteOverlay, {
                query: paletteQuery,
                matches: fuzzyFilter(PALETTE_COMMANDS, paletteQuery),
                index: Math.min(paletteIndex, fuzzyFilter(PALETTE_COMMANDS, paletteQuery).length - 1),
              })
            : React.createElement(TextInput, {
                value: input,
                onChange: setInput,
                onSubmit: handleSubmit,
                placeholder: "Ask a question, enter instructions, or type /help...",
              }),
      ),
    ),

    // Right OpenCode-Style Collapsible Sidebar
    showSidebar
      ? React.createElement(
          Box,
          { flexDirection: "column", width: "30%", borderStyle: "single", paddingLeft: 1 },
          sidebarState &&
            buildSidebarSections().map((section) => section.render(sidebarState)),
        )
      : null,
  );
}

export async function runInteractive(config: SignhifyConfig): Promise<void> {
  // MCP servers connect inside ChatApp so their real status can be rendered.
  render(React.createElement(ChatApp, { config }));
}

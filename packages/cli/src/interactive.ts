import React, { useState, useCallback, useEffect, useRef } from "react";
import { render, Box, Text, useInput, useApp } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import { SignhifyConfig, AgentLoop, Goal, TaskNode, loadProjectInstructions } from "@signhify/core";
import { saveConfig, resolveApiKeyRef, resolveApiKey } from "./config.js";
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
  maskApiKey,
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
  configureMcpServers,
  disconnectAllMcpServers,
  getMcpStatuses,
} from "@signhify/tools";
import { calculateTokenSpeed, formatSessionSummary } from "./tokens.js";
import { Footer } from "./tui/footer.js";
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
  { name: "/usage", description: "show session token usage" },
  { name: "/provider", description: "show active provider and masked credentials" },
  { name: "/models", description: "show configured providers and fallback chain" },
  { name: "/config", description: "show configuration and masked credentials" },
  { name: "/history", description: "search checkpoint history" },
  { name: "/sidebar", description: "toggle sidebar (or collapse <id>)" },
  { name: "/goal", description: "set the stop condition" },
  { name: "/mcp", description: "show MCP server status" },
  { name: "/sessions", description: "list recent sessions" },
  { name: "/fork", description: "branch current session with checkpoints" },
  { name: "/memory", description: "show MEMORY.md" },
  { name: "/dream", description: "consolidate session notes" },
  { name: "/distill", description: "distill long-term notes" },
  { name: "/exit", description: "quit Signhify" },
];

function ChatApp({
  config: initialConfig,
  projectInstructions,
  resumeSessionId,
}: {
  config: SignhifyConfig;
  projectInstructions?: string;
  resumeSessionId?: string;
}) {
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
  const [tokensPerSecond, setTokensPerSecond] = useState<number | null>(null);
  const firstOutputAt = useRef<number | null>(null);
  const activeRun = useRef<AbortController | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<{
    message: string;
    resolve: (allowed: boolean) => void;
  } | null>(null);
  const [runningTools, setRunningTools] = useState<number>(0);
  const [mcpStatuses, setMcpStatuses] = useState<
    Array<{ name: string; status: "connected" | "failed" | "disabled"; error?: string }>
  >([]);
  const { exit } = useApp();

  useEffect(() => () => {
    activeRun.current?.abort();
    void disconnectAllMcpServers();
  }, []);

  const cwd = process.cwd();
  const memoryMd = new MemoryMdManager(cwd);
  const memoryStore = new MemoryStore(path.join(cwd, ".signhify", "memory.db"));
  const checkpointWriter = new CheckpointWriter(memoryStore, cwd);
  const dreamDistill = new DreamDistillEngine(memoryStore, memoryMd);

  // Session registry: one row per interactive run; checkpoints link to this id.
  const [sessionId, setSessionId] = useState(() => memoryStore.createSession(cwd, resumeSessionId));
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;

  useEffect(() => {
    (async () => {
      const [mem, cp] = await Promise.all([
        memoryMd.readMemoryMd(),
        resumeSessionId
          ? memoryStore.getCheckpointBySession(resumeSessionId)
          : checkpointWriter.readLatestCheckpoint(),
      ]);
      if (mem) setMemoryContent(mem);
      if (cp) {
        const parts: string[] = [];
        if (cp.summary) parts.push(`## Previous Session Summary\n${cp.summary}`);
        if ('sections' in cp && (cp as any).sections) {
          const sections = (cp as any).sections;
          if (sections.decisions?.length)
            parts.push(`## Decisions\n${sections.decisions.map((d: string) => `- ${d}`).join("\n")}`);
          if (sections.openIssues?.length)
            parts.push(`## Open Issues\n${sections.openIssues.map((i: string) => `- ${i}`).join("\n")}`);
          if (sections.taskProgress) setTaskProgress(sections.taskProgress);
        }
        setCheckpointContent(parts.join("\n\n"));
        if ('tokenUsageAtCheckpoint' in cp && cp.tokenUsageAtCheckpoint) {
          setTokenUsage((prev) => ({ ...prev, used: cp.tokenUsageAtCheckpoint ?? prev.used }));
        }
      }
      if (resumeSessionId) {
        const cpTokens = cp ? ('tokenUsageAtCheckpoint' in cp ? cp.tokenUsageAtCheckpoint : ('tokenUsage' in (cp as any) ? (cp as any).tokenUsage : 0)) : 0;
        setMessages((prev) => [
          ...prev,
          {
            role: "system",
            content: `Resumed session [${resumeSessionId}]${cp ? ` (loaded checkpoint at ${cpTokens ?? 0} tokens)` : ` (no prior checkpoints)`}.`,
          },
        ]);
      }
    })();

    // Real status only: a server that did not connect is never shown as connected.
    const configured = config.mcpServers ?? [];
    configureMcpServers(configured);
    const refreshMcpStatuses = () => {
      const active = getMcpStatuses();
      const byName = new Map(active.map((status) => [status.name, status]));
      setMcpStatuses([
        ...configured.map((server) => byName.get(server.name) ?? { name: server.name, status: "disabled" as const }),
        ...active.filter((status) => !configured.some((server) => server.name === status.name)),
      ]);
    };
    refreshMcpStatuses();
    const mcpStatusInterval = setInterval(refreshMcpStatuses, 1000);
    return () => clearInterval(mcpStatusInterval);
  }, [config]);

  const buildLoop = useCallback(async () => {
    configureMcpServers(config.mcpServers ?? []);
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
          const reasonText =
            event.reason === "rate_limit"
              ? "Provider rate limit reached"
              : event.reason === "auth"
                ? "Provider authentication failed"
                : event.reason === "unavailable"
                  ? "Provider service unavailable"
                  : event.reason === "timeout"
                    ? "Provider request timed out"
                    : `Provider error (${event.reason})`;
          setMessages((prev) => [
            ...prev,
            {
              role: "system",
              content: `⚡ ${reasonText} on ${event.fromEndpoint}: falling back to ${event.toEndpoint}`,
            },
          ]);
        },
        // The router only knows an endpoint answered once it streams; report
        // that rather than the configured-but-possibly-dead first entry.
        onEndpointSuccess: (endpointName: string) => {
          setActiveRouterInfo(`${endpointName} / ${config.provider.agent.model}`);
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
      onProgress: (event) => setMessages((prev) => [...prev, { role: "system", content: `[subagent] ${event.message}` }]),
    });

    const loop = new AgentLoop({
      config,
      workingDirectory: process.cwd(),
      provider: adapter,
      sessionId,
      autoMode: false,
      projectInstructions,
      confirm: (message) => new Promise<boolean>((resolve) => setPendingConfirmation({ message, resolve })),
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
        if (
          ((chunk.type === "text" && chunk.content) || chunk.type === "tool_call") &&
          firstOutputAt.current === null
        ) {
          firstOutputAt.current = Date.now();
        }
        if (chunk.type === "done" && chunk.usage) {
          const prompt = chunk.usage.promptTokens ?? 0;
          const completion = chunk.usage.completionTokens ?? 0;
          const total = chunk.usage.totalTokens ?? (prompt + completion);
          setTokenUsage((prev) => ({
            ...prev,
            used: total,
          }));
        }
        if (chunk.type === "done") {
          const elapsedMs = firstOutputAt.current === null ? 0 : Date.now() - firstOutputAt.current;
          const outputTokens = chunk.usage?.completionTokens;
          setTokensPerSecond(calculateTokenSpeed(outputTokens, elapsedMs));
          firstOutputAt.current = null;
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
  }, [config, mode, goal, memoryContent, checkpointContent, taskProgress, projectInstructions, sessionId]);

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
        if (cmd === "/usage") {
          setMessages((prev) => [
            ...prev,
            {
              role: "system",
              content: formatSessionSummary({
                usedTokens: tokenUsage.used,
                limitTokens: tokenUsage.limit,
                activeRouterInfo,
                tokensPerSecond,
                mode,
              }),
            },
          ]);
          setInput("");
          return;
        }
        if (cmd === "/provider") {
          const agentKey =
            config.provider.agent.apiKey ??
            (await resolveApiKey({
              vendor: config.provider.agent.vendor,
              apiKeyRef: config.provider.agent.apiKeyRef,
            }));
          setMessages((prev) => [
            ...prev,
            {
              role: "system",
              content: [
                `Active Provider: ${config.provider.agent.vendor}`,
                `Model: ${config.provider.agent.model}`,
                `API Key: ${maskApiKey(agentKey)}`,
                `Key Reference: ${config.provider.agent.apiKeyRef ?? "<none>"}`,
              ].join("\n"),
            },
          ]);
          setInput("");
          return;
        }
        if (cmd === "/models") {
          const agentKey =
            config.provider.agent.apiKey ??
            (await resolveApiKey({
              vendor: config.provider.agent.vendor,
              apiKeyRef: config.provider.agent.apiKeyRef,
            }));
          const chain =
            config.provider.fallbackChain && config.provider.fallbackChain.length > 0
              ? config.provider.fallbackChain
              : DEFAULT_ZERO_COST_CHAIN;
          setMessages((prev) => [
            ...prev,
            {
              role: "system",
              content: [
                `Agent endpoint: ${config.provider.agent.vendor}/${config.provider.agent.model} [key: ${maskApiKey(agentKey)}]`,
                "Fallback chain (highest priority first):",
                ...(chain as Array<{ name: string; vendor: string; model: string; isLocal?: boolean; apiKey?: string; apiKeyRef?: string }>).map(
                  (ep) => {
                    const epKey = maskApiKey(ep.apiKey ?? ep.apiKeyRef);
                    return `- ${ep.name}: ${ep.vendor}/${ep.model}${ep.isLocal ? " (local)" : ""} [key: ${epKey}]`;
                  },
                ),
              ].join("\n"),
            },
          ]);
          setInput("");
          return;
        }
        if (cmd === "/config") {
          const agentKey =
            config.provider.agent.apiKey ??
            (await resolveApiKey({
              vendor: config.provider.agent.vendor,
              apiKeyRef: config.provider.agent.apiKeyRef,
            }));
          setMessages((prev) => [
            ...prev,
            {
              role: "system",
              content: [
                "Configuration summary:",
                `- Provider: ${config.provider.agent.vendor}`,
                `- Model: ${config.provider.agent.model}`,
                `- API Key: ${maskApiKey(agentKey)}`,
                `- Key Reference: ${config.provider.agent.apiKeyRef ?? "<none>"}`,
                `- Context Limit: ${config.memory?.contextLimit ?? 128000}`,
                `- Fallback Chain Endpoints: ${(config.provider.fallbackChain ?? []).length}`,
              ].join("\n"),
            },
          ]);
          setInput("");
          return;
        }
        if (cmd === "/history") {
          if (!arg) {
            setMessages((prev) => [
              ...prev,
              { role: "system", content: "Usage: /history <query> — search checkpoint summaries" },
            ]);
          } else {
            const hits = memoryStore.searchCheckpoints(arg, 10);
            setMessages((prev) => [
              ...prev,
              {
                role: "system",
                content:
                  hits.length === 0
                    ? `No checkpoint matches for "${arg}".`
                    : `Checkpoint history for "${arg}":\n${hits
                        .map((h) => {
                          const text = h.snippet || h.summary;
                          return `• [${h.sessionId}] ${h.createdAt ?? ""} — ${text.length > 200 ? `${text.slice(0, 200)}…` : text}`;
                        })
                        .join("\n")}`,
              },
            ]);
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
                      .map((s) => {
                        const titlePart = s.title ? ` - "${s.title}"` : "";
                        const countPart = s.checkpointCount !== undefined ? ` (${s.checkpointCount} checkpoints)` : "";
                        const curPart = s.id === sessionId ? " (current)" : "";
                        return `${s.id}${titlePart}  ${s.createdAt ?? ""}${countPart}${curPart}`;
                      })
                      .join("\n")}`,
            },
          ]);
          setInput("");
          return;
        }
        if (cmd === "/fork") {
          try {
            const forkTitle = arg.trim() || undefined;
            const forked = memoryStore.forkSession(sessionId, undefined, forkTitle);
            setSessionId(forked.id);
            setMessages((prev) => [
              ...prev,
              {
                role: "system",
                content: `Forked session [${forked.id}]${forked.title ? ` ("${forked.title}")` : ""} from [${sessionId}]. Checkpoints duplicated: ${forked.checkpointCount ?? 0}.`,
              },
            ]);
          } catch (err: unknown) {
            setMessages((prev) => [
              ...prev,
              {
                role: "system",
                content: `Failed to fork session: ${err instanceof Error ? err.message : String(err)}`,
              },
            ]);
          }
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
                  ? "No MCP servers configured or connected."
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
        const controller = new AbortController();
        activeRun.current = controller;
        const loop = await buildLoop();
        const result = await loop.run(value, controller.signal);

        if (result.cancelled) {
          setMessages((prev) => [...prev, { role: "system", content: "Run cancelled. Actions completed before cancellation remain applied." }]);
        } else if (result.error) {
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
        activeRun.current = null;
        setIsLoading(false);
      }
    },
    [activeRouterInfo, buildLoop, config, dreamDistill, exit, mcpStatuses, memoryContent, memoryStore, messages, mode, sessionId, tokenUsage, tokensPerSecond],
  );

  useInput((inputChar, key) => {
    if (key.ctrl && inputChar === "c") {
      activeRun.current?.abort();
      pendingConfirmation?.resolve(false);
      setPendingConfirmation(null);
      exit();
    }
    if (pendingConfirmation) {
      if (inputChar.toLowerCase() === "y") {
        pendingConfirmation.resolve(true);
        setPendingConfirmation(null);
      } else if (key.escape) {
        pendingConfirmation.resolve(false);
        setPendingConfirmation(null);
        activeRun.current?.abort();
      } else if (inputChar.toLowerCase() === "n" || key.return) {
        pendingConfirmation.resolve(false);
        setPendingConfirmation(null);
      }
      return;
    }
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
    if (key.escape && activeRun.current) {
      activeRun.current.abort();
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
    tokensPerSecond,
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
        React.createElement(Text, { color: "gray" }, "Tab: mode | Esc: cancel run | Ctrl+B: sidebar | Ctrl+P: commands"),
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
          ? pendingConfirmation
            ? React.createElement(
                Box,
                { flexDirection: "column", borderStyle: "round", borderColor: "yellow", paddingX: 1 },
                React.createElement(Text, { bold: true, color: "yellow" }, "Review requested action"),
                React.createElement(Text, { wrap: "wrap" }, pendingConfirmation.message),
                React.createElement(Text, { color: "gray" }, "Y: approve | N: deny | Esc: cancel the run"),
              )
            : React.createElement(
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
      React.createElement(Footer, {
        tokensUsed: tokenUsage.used,
        tokenLimit: tokenUsage.limit,
        tokensPerSecond,
        activeRouterInfo,
      }),
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

export interface InteractiveOptions {
  resume?: string;
}

export async function runInteractive(config: SignhifyConfig, options?: InteractiveOptions): Promise<void> {
  const projectInstructions = await loadProjectInstructions(process.cwd(), config.memory?.tokenBudget);
  // Configured MCP commands start only after an approved tool call.
  render(React.createElement(ChatApp, { config, projectInstructions, resumeSessionId: options?.resume }));
}

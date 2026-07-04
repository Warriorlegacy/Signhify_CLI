import React, { useState, useCallback, useEffect } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import { SignhifyConfig, AgentLoop, Goal, TaskNode } from '@signhify/core';
import { createAdapter } from '@signhify/providers';
import { MemoryMdManager, MemoryStore, DreamDistillEngine, CheckpointWriter } from '@signhify/memory';
import { fileIoTool, shellExecTool, gitTool, searchTool, browserTool, mcpClientTool } from '@signhify/tools';
import * as path from 'node:path';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

const MODE_CYCLE = ['build', 'plan', 'debug', 'compose'] as const;

function ChatApp({ config }: { config: SignhifyConfig }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState('build');
  const [goal, setGoal] = useState<Goal | undefined>();
  const [taskTree, setTaskTree] = useState<TaskNode[]>([]);
  const [memoryContent, setMemoryContent] = useState('');
  const [checkpointContent, setCheckpointContent] = useState('');
  const [taskProgress, setTaskProgress] = useState('');
  const { exit } = useApp();

  const cwd = process.cwd();
  const memoryMd = new MemoryMdManager(cwd);
  const memoryStore = new MemoryStore(path.join(cwd, '.signhify', 'memory.db'));
  const checkpointWriter = new CheckpointWriter(memoryStore, cwd);
  const dreamDistill = new DreamDistillEngine(memoryStore, memoryMd);

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
        if (cp.sections.decisions.length) parts.push(`## Decisions\n${cp.sections.decisions.map(d => `- ${d}`).join('\n')}`);
        if (cp.sections.openIssues.length) parts.push(`## Open Issues\n${cp.sections.openIssues.map(i => `- ${i}`).join('\n')}`);
        setCheckpointContent(parts.join('\n\n'));
        if (cp.sections.taskProgress) setTaskProgress(cp.sections.taskProgress);
      }
    })();
  }, []);

  const buildLoop = useCallback(() => {
    const adapter = createAdapter(config.provider.agent);
    const loop = new AgentLoop({
      config,
      workingDirectory: process.cwd(),
      provider: adapter,
      autoMode: false,
      goal,
      memoryContent,
      checkpointContent,
      taskProgress,
    });

    loop.getModeManager().setMode(mode as 'build' | 'plan' | 'debug' | 'compose');
    loop.registerTool(fileIoTool);
    loop.registerTool(shellExecTool);
    loop.registerTool(gitTool);
    loop.registerTool(searchTool);
    loop.registerTool(browserTool);
    loop.registerTool(mcpClientTool);
    return loop;
  }, [config, mode, goal, memoryContent, checkpointContent, taskProgress]);

  const handleSubmit = useCallback(async (value: string) => {
    if (!value.trim()) return;

    // Handle slash commands
    if (value.startsWith('/')) {
      const cmd = value.trim().toLowerCase();
      if (cmd === '/exit' || cmd === '/quit') {
        exit();
        return;
      }
      if (cmd === '/goal') {
        setMessages(prev => [...prev, { role: 'system', content: 'Usage: /goal <statement> — set the stop condition' }]);
        return;
      }
      if (cmd === '/dream') {
        setIsLoading(true);
        try {
          const traces = messages.map(m => `[${m.role}] ${m.content}`).join('\n');
          const result = await dreamDistill.dream(process.cwd(), traces ? [traces] : []);
          setMessages(prev => [...prev, {
            role: 'system',
            content: `Dream complete: ${result.summary}`,
          }]);
        } catch (error) {
          setMessages(prev => [...prev, {
            role: 'system',
            content: `Dream error: ${error instanceof Error ? error.message : String(error)}`,
          }]);
        } finally {
          setIsLoading(false);
        }
        return;
      }
      if (cmd === '/distill') {
        setIsLoading(true);
        try {
          const traces = messages.map(m => `[${m.role}] ${m.content}`).join('\n');
          const result = await dreamDistill.distill(process.cwd(), traces ? [traces] : []);
          setMessages(prev => [...prev, {
            role: 'system',
            content: `Distill complete: ${result.summary}`,
          }]);
        } catch (error) {
          setMessages(prev => [...prev, {
            role: 'system',
            content: `Distill error: ${error instanceof Error ? error.message : String(error)}`,
          }]);
        } finally {
          setIsLoading(false);
        }
        return;
      }
      if (cmd.startsWith('/goal ')) {
        const statement = value.slice(6).trim();
        if (!statement) {
          setMessages(prev => [...prev, { role: 'system', content: 'Usage: /goal <statement> — set the stop condition' }]);
          return;
        }
        const newGoal: Goal = { statement, maxIterations: 50 };
        setGoal(newGoal);
        setMessages(prev => [...prev, { role: 'system', content: `Goal set: "${statement}" (max ${newGoal.maxIterations} iterations)` }]);
        return;
      }
    }

    setMessages(prev => [...prev, { role: 'user', content: value }]);
    setInput('');
    setIsLoading(true);

    try {
      const loop = buildLoop();
      const result = await loop.run(value);
      const lastAssistant = result.messages.filter(m => m.role === 'assistant').pop();
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: lastAssistant?.content ?? 'No response generated.',
      }]);
      setTaskTree(loop.getTaskManager().getTaskTree());
    } catch (error) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Error: ${error instanceof Error ? error.message : String(error)}`,
      }]);
    } finally {
      setIsLoading(false);
    }
  }, [buildLoop, exit]);

  useInput((inputChar, key) => {
    if (key.ctrl && inputChar === 'c') exit();
    if (key.tab) {
      setMode(prev => {
        const idx = MODE_CYCLE.indexOf(prev as typeof MODE_CYCLE[number]);
        return MODE_CYCLE[(idx + 1) % MODE_CYCLE.length];
      });
    }
  });

  return React.createElement(Box, { flexDirection: 'row', padding: 1 },
    React.createElement(Box, { flexDirection: 'column', width: '75%' },
      React.createElement(Box, { marginBottom: 1 },
        React.createElement(Text, { bold: true, color: 'green' }, 'Signhify v0.1.0'),
        React.createElement(Text, { color: 'cyan', bold: true }, ` [${mode}]`),
        goal ? React.createElement(Text, { color: 'yellow' }, ` Goal: "${goal.statement}"`) : null
      ),
      React.createElement(Box, { flexDirection: 'column', marginBottom: 1 },
        messages.map((msg, i) =>
          React.createElement(Box, { key: i, marginBottom: 1 },
            React.createElement(Text, { bold: true, color: msg.role === 'user' ? 'blue' : msg.role === 'system' ? 'yellow' : 'green' },
              `${msg.role === 'user' ? 'You' : msg.role === 'system' ? 'System' : 'AI'}: `
            ),
            React.createElement(Text, {}, msg.content)
          )
        )
      ),
      React.createElement(Box, null,
        isLoading
          ? React.createElement(Box, null, React.createElement(Spinner, { type: 'dots' }), React.createElement(Text, {}, ' Thinking...'))
          : React.createElement(TextInput, { value: input, onChange: setInput, onSubmit: handleSubmit, placeholder: 'Type a task, /goal <statement>, Tab to switch mode, or /exit to quit...' })
      )
    ),
    React.createElement(Box, { flexDirection: 'column', width: '25%', borderStyle: 'single', paddingLeft: 1 },
      React.createElement(Text, { bold: true, color: 'magenta' }, 'Task Tree'),
      React.createElement(Text, { color: 'gray' }, '─────────────'),
      taskTree.length === 0
        ? React.createElement(Text, { color: 'gray' }, '  (no tasks yet)')
        : taskTree.map((task) =>
            React.createElement(Box, { key: task.id },
              React.createElement(Text, { color: task.status === 'done' ? 'green' : task.status === 'in_progress' ? 'yellow' : task.status === 'blocked' ? 'red' : 'gray' },
                `  ${task.id} `
              ),
              React.createElement(Text, {}, task.title.length > 18 ? task.title.slice(0, 18) + '…' : task.title)
            )
          )
    )
  );
}

export async function runInteractive(config: SignhifyConfig): Promise<void> {
  // Auto-connect MCP servers from config
  if (config.mcpServers && config.mcpServers.length > 0) {
    for (const server of config.mcpServers) {
      try {
        await mcpClientTool.execute({
          action: 'connect',
          serverName: server.name,
          command: server.command,
          args: server.args ?? [],
        }, { workingDirectory: process.cwd() });
      } catch {
        // MCP server failed to connect — continue without it
      }
    }
  }

  render(React.createElement(ChatApp, { config }));
}

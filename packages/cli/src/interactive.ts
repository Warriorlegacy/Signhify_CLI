import React, { useState, useCallback } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import { SignhifyConfig, AgentLoop, Goal } from '@signhify/core';
import { createAdapter } from '@signhify/providers';
import { MemoryMdManager } from '@signhify/memory';
import { fileIoTool, shellExecTool, gitTool, searchTool } from '@signhify/tools';
import * as path from 'node:path';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

function ChatApp({ config }: { config: SignhifyConfig }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState('build');
  const { exit } = useApp();

  const memoryMd = new MemoryMdManager(process.cwd());

  const buildLoop = useCallback(() => {
    const adapter = createAdapter(config.provider.agent);
    const loop = new AgentLoop({
      config,
      workingDirectory: process.cwd(),
      provider: adapter,
      autoMode: false,
    });

    loop.getModeManager().setMode(mode as 'build' | 'plan' | 'debug' | 'compose');
    loop.registerTool(fileIoTool);
    loop.registerTool(shellExecTool);
    loop.registerTool(gitTool);
    loop.registerTool(searchTool);
    return loop;
  }, [config, mode]);

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
        setMessages(prev => [...prev, { role: 'system', content: 'Dream: not yet implemented' }]);
        return;
      }
      if (cmd === '/distill') {
        setMessages(prev => [...prev, { role: 'system', content: 'Distill: not yet implemented' }]);
        return;
      }
      if (cmd.startsWith('/goal ')) {
        const statement = value.slice(6).trim();
        setMessages(prev => [...prev, { role: 'system', content: `Goal set: ${statement}` }]);
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
  });

  return React.createElement(Box, { flexDirection: 'column', padding: 1 },
    React.createElement(Box, { marginBottom: 1 },
      React.createElement(Text, { bold: true, color: 'green' }, 'Signhify v0.1.0 — Your AI Engineering Partner'),
      React.createElement(Text, { color: 'gray' }, `  [${mode}]`)
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
        : React.createElement(TextInput, { value: input, onChange: setInput, onSubmit: handleSubmit, placeholder: 'Type a task, /goal <statement>, or /exit to quit...' })
    )
  );
}

export async function runInteractive(config: SignhifyConfig): Promise<void> {
  render(React.createElement(ChatApp, { config }));
}

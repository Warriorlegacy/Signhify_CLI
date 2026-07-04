import React, { useState, useCallback } from 'react';
import { render, Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { signhifyConfigSchema, saveConfig } from './config.js';

type WizardStep = 'choice' | 'provider' | 'model' | 'apikey' | 'done';

const STEPS: WizardStep[] = ['choice', 'provider', 'model', 'apikey', 'done'];

function WizardApp() {
  const [stepIdx, setStepIdx] = useState(0);
  const setChoice = useState('')[1];
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const setApiKey = useState('')[1];
  const [error, setError] = useState('');

  const step: WizardStep = STEPS[stepIdx];

  const advance = (next: WizardStep) => setStepIdx(STEPS.indexOf(next));

  const handleChoice = useCallback((value: string) => {
    const trimmed = value.trim().toLowerCase();
    const valid = ['1', '2', '3', '4', 'free', 'import', 'oauth', 'custom'];
    if (!valid.includes(trimmed)) {
      setError('Enter 1-4 or: free / import / oauth / custom');
      return;
    }
    const map: Record<string, string> = { '1': 'free', '2': 'oauth', '3': 'import', '4': 'custom', free: 'free', import: 'import', oauth: 'oauth', custom: 'custom' };
    setChoice(map[trimmed]);
    if (map[trimmed] === 'free') {
      advance('done');
    } else {
      advance('provider');
    }
    setError('');
  }, []);

  const handleProvider = useCallback(async (value: string) => {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) {
      setError('Enter a provider name');
      return;
    }
    setProvider(trimmed);
    advance('model');
    setError('');
  }, []);

  const handleModel = useCallback((value: string) => {
    setModel(value.trim());
    advance('apikey');
    setError('');
  }, []);

  const handleApiKey = useCallback(async (value: string) => {
    const trimmed = value.trim();
    setApiKey(trimmed);
    const cfg = {
      provider: {
        agent: {
          vendor: provider,
          model: model || 'gpt-4',
          apiKey: trimmed,
          ...(provider === 'openai-compatible' && { baseUrl: 'http://localhost:11434/v1' }),
        },
      },
    };
    try {
      await signhifyConfigSchema(cfg);
      await saveConfig(cfg);
      advance('done');
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [provider, model]);

  const content = step === 'choice'
    ? React.createElement(Box, { flexDirection: 'column' },
        React.createElement(Text, { bold: true }, 'Welcome to Signhify'),
        React.createElement(Text, {}, 'Choose your setup path:'),
        React.createElement(Box, { marginTop: 1, flexDirection: 'column' },
          React.createElement(Text, {}, '1. Free trial   (zero-config)'),
          React.createElement(Text, {}, '2. OAuth / platform login'),
          React.createElement(Text, {}, '3. Import existing credentials'),
          React.createElement(Text, {}, '4. Custom provider   (manual API key)')
        ),
        React.createElement(Box, { marginTop: 1 },
          React.createElement(TextInput, { value: '', onChange: handleChoice, placeholder: 'Enter 1-4...' })
        ),
        error ? React.createElement(Text, { color: 'red' }, error) : null
      )
    : step === 'provider'
      ? React.createElement(Box, { flexDirection: 'column' },
          React.createElement(Text, { bold: true }, 'Select provider'),
          React.createElement(Text, {}, 'e.g. openai, anthropic, google, mistral, groq, xai, together, deepinfra, fireworks, cohere'),
          React.createElement(Box, { marginTop: 1 },
            React.createElement(TextInput, { value: '', onChange: handleProvider, placeholder: 'provider name...' })
          )
        )
      : step === 'model'
        ? React.createElement(Box, { flexDirection: 'column' },
            React.createElement(Text, { bold: true }, `Provider: ${provider}`),
            React.createElement(Text, {}, 'Enter model name (e.g. claude-sonnet-4-20250514, gpt-4, gemini-pro)'),
            React.createElement(Box, { marginTop: 1 },
              React.createElement(TextInput, { value: '', onChange: handleModel, placeholder: 'model name...' })
            )
          )
        : step === 'apikey'
          ? React.createElement(Box, { flexDirection: 'column' },
              React.createElement(Text, { bold: true }, `Model: ${model} (${provider})`),
              React.createElement(Text, {}, 'Enter your API key:'),
              React.createElement(Box, { marginTop: 1 },
                React.createElement(TextInput, { value: '', onChange: handleApiKey, placeholder: 'sk-...', mask: '*' })
              )
            )
          : React.createElement(Box, { flexDirection: 'column' },
              React.createElement(Text, { color: 'green', bold: true }, 'Setup complete!'),
              React.createElement(Text, {}, `Provider: ${provider} / Model: ${model || 'gpt-4'}`),
              React.createElement(Text, {}, 'Config saved to .signhify/config.json'),
              React.createElement(Text, { dimColor: true }, 'Press Ctrl+C to exit')
            );

  return React.createElement(Box, { padding: 1 }, content);
}

export function runSetupWizard(): void {
  render(React.createElement(WizardApp));
}

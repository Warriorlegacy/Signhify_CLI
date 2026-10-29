import React, { useState, useCallback } from 'react';
import { render, Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { saveConfig } from './config.js';
import {
  validateProviderApiKey,
  getProviderKeyHint,
  maskApiKey,
  type KeyValidationResult,
} from '@signhify/providers';

export interface ProviderOption {
  id: string;
  name: string;
  description: string;
  defaultModel: string;
  baseUrl?: string;
  requiresKey: boolean;
}

export const PROVIDER_OPTIONS: ProviderOption[] = [
  { id: 'anthropic', name: 'Anthropic', description: 'Claude 3.7 Sonnet / Opus / Haiku', defaultModel: 'claude-3-7-sonnet-latest', requiresKey: true },
  { id: 'openai', name: 'OpenAI', description: 'GPT-4o / o1 / o3-mini', defaultModel: 'gpt-4o', requiresKey: true },
  { id: 'google', name: 'Google Gemini', description: 'Gemini 2.0 Flash / Pro', defaultModel: 'gemini-2.0-flash', requiresKey: true },
  { id: 'groq', name: 'Groq', description: 'Llama 3.3 70B (Ultra-fast inference)', defaultModel: 'llama-3.3-70b-versatile', requiresKey: true },
  { id: 'deepseek', name: 'DeepSeek', description: 'DeepSeek V3 / R1 reasoning', defaultModel: 'deepseek-chat', requiresKey: true },
  { id: 'openrouter', name: 'OpenRouter', description: 'Unified multi-provider router', defaultModel: 'anthropic/claude-3.7-sonnet', requiresKey: true },
  { id: 'ollama', name: 'Ollama', description: 'Local LLM (Zero cost, no API key required)', defaultModel: 'llama3', baseUrl: 'http://localhost:11434/v1', requiresKey: false },
  { id: 'openai-compatible', name: 'OpenAI-Compatible', description: 'Custom local or proxy endpoint', defaultModel: 'custom-model', baseUrl: 'http://localhost:11434/v1', requiresKey: false },
];

export function resolveWizardProvider(input: string): ProviderOption | undefined {
  const trimmed = input.trim().toLowerCase();
  const num = parseInt(trimmed, 10);
  if (!isNaN(num) && num >= 1 && num <= PROVIDER_OPTIONS.length) {
    return PROVIDER_OPTIONS[num - 1];
  }
  return PROVIDER_OPTIONS.find(
    (p) =>
      p.id.toLowerCase() === trimmed ||
      p.name.toLowerCase() === trimmed ||
      (p.id === 'google' && trimmed === 'gemini') ||
      (p.id === 'anthropic' && trimmed === 'claude'),
  );
}

export function validateWizardApiKey(
  provider: string,
  apiKey: string,
): { valid: boolean; error?: string; warning?: string; sanitizedKey?: string } {
  const trimmed = apiKey.trim();
  if (provider === 'ollama' && (!trimmed || trimmed === 'ollama')) {
    return { valid: true, sanitizedKey: 'ollama' };
  }
  if (trimmed.startsWith('env:')) {
    const varName = trimmed.slice(4).trim();
    if (!varName) {
      return {
        valid: false,
        error: 'Invalid env reference. Format should be env:VARIABLE_NAME',
      };
    }
    return { valid: true, sanitizedKey: trimmed };
  }

  const result: KeyValidationResult = validateProviderApiKey(provider, trimmed);
  if (!result.valid) {
    const hint = getProviderKeyHint(provider);
    return {
      valid: false,
      error: `${result.error ?? 'Invalid API key.'} Expected: ${hint}`,
      warning: result.warning,
    };
  }
  return result;
}

export type WizardStep = 'choice' | 'provider' | 'model' | 'apikey' | 'done';

const STEPS: WizardStep[] = ['choice', 'provider', 'model', 'apikey', 'done'];

export function WizardApp(): React.ReactElement {
  const [stepIdx, setStepIdx] = useState(0);
  const [provider, setProvider] = useState('anthropic');
  const [model, setModel] = useState('claude-3-7-sonnet-latest');
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState('');
  const [liveWarning, setLiveWarning] = useState('');
  const [baseUrl, setBaseUrl] = useState<string | undefined>(undefined);

  // Controlled input states
  const [choiceInput, setChoiceInput] = useState('');
  const [providerInput, setProviderInput] = useState('');
  const [modelInput, setModelInput] = useState('');
  const [apiKeyInput, setApiKeyInput] = useState('');

  const step: WizardStep = STEPS[stepIdx];

  const advance = (next: WizardStep) => setStepIdx(STEPS.indexOf(next));

  const handleChoice = useCallback((value: string) => {
    const trimmed = value.trim().toLowerCase();
    const valid = ['1', '2', '3', '4', 'free', 'import', 'oauth', 'custom'];
    if (!valid.includes(trimmed)) {
      setError('Enter 1-4 or: free / oauth / import / custom');
      return;
    }
    const map: Record<string, string> = {
      '1': 'free',
      '2': 'oauth',
      '3': 'import',
      '4': 'custom',
      free: 'free',
      import: 'import',
      oauth: 'oauth',
      custom: 'custom',
    };
    const choice = map[trimmed];
    setError('');
    if (choice === 'free') {
      setProvider('ollama');
      setModel('llama3');
      setBaseUrl('http://localhost:11434/v1');
      advance('done');
    } else {
      advance('provider');
    }
  }, []);

  const handleProvider = useCallback((value: string) => {
    const option = resolveWizardProvider(value);
    if (!option) {
      setError(`Invalid provider. Choose 1-${PROVIDER_OPTIONS.length} or enter provider name.`);
      return;
    }
    setProvider(option.id);
    setModel(option.defaultModel);
    setModelInput(option.defaultModel);
    setBaseUrl(option.baseUrl);
    setError('');
    advance('model');
  }, []);

  const handleModel = useCallback((value: string) => {
    const chosen = value.trim() || model;
    setModel(chosen);
    setError('');
    advance('apikey');
  }, [model]);

  const handleApiKeyChange = useCallback((value: string) => {
    setApiKeyInput(value);
    const trimmed = value.trim();
    if (!trimmed) {
      setLiveWarning('');
      return;
    }
    if (provider === 'ollama') {
      setLiveWarning('');
      return;
    }
    const check = validateWizardApiKey(provider, trimmed);
    if (!check.valid) {
      setLiveWarning(check.error ?? '');
    } else if (check.warning) {
      setLiveWarning(`Notice: ${check.warning}`);
    } else {
      setLiveWarning('');
    }
  }, [provider]);

  const handleApiKeySubmit = useCallback(async (value: string) => {
    const trimmed = value.trim();
    const check = validateWizardApiKey(provider, trimmed);
    if (!check.valid) {
      setError(check.error ?? 'Invalid API key format.');
      return;
    }

    const finalKey = check.sanitizedKey ?? trimmed;
    setApiKey(finalKey);

    const cfg = {
      provider: {
        agent: {
          vendor: provider,
          model: model || 'gpt-4o',
          apiKeyRef: finalKey,
          ...(baseUrl && { baseUrl }),
        },
      },
    };

    try {
      await saveConfig(cfg);
      advance('done');
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [provider, model, baseUrl]);

  const content = step === 'choice'
    ? React.createElement(Box, { flexDirection: 'column' },
        React.createElement(Text, { bold: true, color: 'cyan' }, 'Welcome to Signhify BYOK Setup'),
        React.createElement(Text, {}, 'Choose your setup path:'),
        React.createElement(Box, { marginTop: 1, flexDirection: 'column' },
          React.createElement(Text, {}, '1. Free trial / Local   (Ollama zero-config)'),
          React.createElement(Text, {}, '2. OAuth / platform login'),
          React.createElement(Text, {}, '3. Import existing credentials (.env)'),
          React.createElement(Text, {}, '4. Custom provider   (Bring Your Own Key)')
        ),
        React.createElement(Box, { marginTop: 1 },
          React.createElement(TextInput, {
            value: choiceInput,
            onChange: (val) => {
              setChoiceInput(val);
              if (['1', '2', '3', '4'].includes(val.trim())) {
                handleChoice(val);
              }
            },
            onSubmit: handleChoice,
            placeholder: 'Enter 1-4 (or press Enter)...'
          })
        ),
        error ? React.createElement(Text, { color: 'red' }, error) : null
      )
    : step === 'provider'
      ? React.createElement(Box, { flexDirection: 'column' },
          React.createElement(Text, { bold: true, color: 'cyan' }, 'Select Provider (BYOK)'),
          React.createElement(Box, { marginTop: 1, flexDirection: 'column' },
            PROVIDER_OPTIONS.map((opt, i) =>
              React.createElement(
                Text,
                { key: opt.id },
                `${i + 1}. ${opt.name.padEnd(18)} - ${opt.description}`
              )
            )
          ),
          React.createElement(Box, { marginTop: 1 },
            React.createElement(TextInput, {
              value: providerInput,
              onChange: (val) => {
                setProviderInput(val);
                const num = parseInt(val.trim(), 10);
                if (!isNaN(num) && num >= 1 && num <= PROVIDER_OPTIONS.length && val.trim().length === 1) {
                  handleProvider(val);
                }
              },
              onSubmit: handleProvider,
              placeholder: `Enter 1-${PROVIDER_OPTIONS.length} or provider name...`
            })
          ),
          error ? React.createElement(Text, { color: 'red' }, error) : null
        )
      : step === 'model'
        ? React.createElement(Box, { flexDirection: 'column' },
            React.createElement(Text, { bold: true, color: 'cyan' }, `Configure Model for ${provider}`),
            React.createElement(Text, {}, `Default model: ${model}`),
            React.createElement(Text, { dimColor: true }, 'Press Enter to keep default or enter a custom model name:'),
            React.createElement(Box, { marginTop: 1 },
              React.createElement(TextInput, {
                value: modelInput,
                onChange: setModelInput,
                onSubmit: handleModel,
                placeholder: model
              })
            ),
            error ? React.createElement(Text, { color: 'red' }, error) : null
          )
        : step === 'apikey'
          ? React.createElement(Box, { flexDirection: 'column' },
              React.createElement(Text, { bold: true, color: 'cyan' }, `API Key for ${provider} (${model})`),
              React.createElement(Text, {}, 'Enter your API key (or env:VARIABLE_NAME):'),
              React.createElement(Text, { dimColor: true }, `Format hint: ${getProviderKeyHint(provider)}`),
              React.createElement(Box, { marginTop: 1 },
                React.createElement(TextInput, {
                  value: apiKeyInput,
                  onChange: handleApiKeyChange,
                  onSubmit: handleApiKeySubmit,
                  placeholder: provider === 'ollama' ? 'Optional for Ollama (press Enter)...' : 'sk-...',
                  mask: '*'
                })
              ),
              liveWarning ? React.createElement(Text, { color: 'yellow' }, `⚠ ${liveWarning}`) : null,
              error ? React.createElement(Text, { color: 'red' }, `✖ ${error}`) : null
            )
          : React.createElement(Box, { flexDirection: 'column' },
              React.createElement(Text, { color: 'green', bold: true }, '✔ Setup complete!'),
              React.createElement(Text, {}, `Provider: ${provider}`),
              React.createElement(Text, {}, `Model:    ${model}`),
              React.createElement(Text, {}, `API Key:  ${maskApiKey(apiKey)}`),
              React.createElement(Text, { color: 'gray' }, 'Config saved to .signhify/config.json'),
              React.createElement(Box, { marginTop: 1 },
                React.createElement(Text, { dimColor: true }, 'Press Ctrl+C to exit')
              )
            );

  return React.createElement(Box, { padding: 1 }, content);
}

export function runSetupWizard(): void {
  render(React.createElement(WizardApp));
}

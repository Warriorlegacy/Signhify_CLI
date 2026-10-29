/**
 * Hardened validation and diagnostics for BYOK (Bring Your Own Key) credentials.
 */
import { sanitizeApiKey, maskApiKey } from './factory.js';

export interface KeyValidationResult {
  valid: boolean;
  sanitizedKey?: string;
  warning?: string;
  error?: string;
}

const PLACEHOLDER_PATTERNS = [
  /^sk-\.\.\.$/i,
  /^sk-ant-\.\.\.$/i,
  /^gsk_\.\.\.$/i,
  /\.\.\.$/,
  /^your[-_]?api[-_]?key/i,
  /^your[-_]?key/i,
  /placeholder/i,
  /^todo/i,
  /^xxx+$/i,
  /^<.*>$/,
  /^enter[-_]?key/i,
  /^test[-_]?key/i,
  /^my[-_]?api[-_]?key/i,
  /^insert[-_]?key/i,
  /^dummy/i,
];

/**
 * Returns human-readable guidance for the expected API key format/prefix per provider.
 */
export function getProviderKeyHint(vendor: string): string {
  const v = vendor.toLowerCase();
  if (['anthropic', 'claude'].includes(v)) {
    return 'Starts with "sk-ant-" (approx 100+ characters)';
  }
  if (['openai'].includes(v)) {
    return 'Starts with "sk-" (approx 50+ characters)';
  }
  if (['google', 'gemini'].includes(v)) {
    return 'Starts with "AIzaSy" (approx 39 characters)';
  }
  if (['groq'].includes(v)) {
    return 'Starts with "gsk_" (approx 56 characters)';
  }
  if (['deepseek'].includes(v)) {
    return 'Starts with "sk-" (approx 32 characters)';
  }
  if (['openrouter'].includes(v)) {
    return 'Starts with "sk-or-v1-" or "sk-or-"';
  }
  if (['ollama'].includes(v)) {
    return 'Optional for local Ollama server (press Enter to skip)';
  }
  if (['openai-compatible'].includes(v)) {
    return 'API key string or press Enter if unauthenticated';
  }
  return 'Valid API key string or env:VARIABLE';
}

/**
 * Validates a provider API key against known formats, placeholders, and length constraints.
 * Returns actionable diagnostic warnings/errors while allowing customized enterprise proxies.
 */
export function validateProviderApiKey(vendor: string, rawKey?: string): KeyValidationResult {
  const sanitized = sanitizeApiKey(rawKey);
  const normalizedVendor = vendor.toLowerCase();

  // Local or mock providers do not strictly require an API key
  if (['ollama', 'mock', 'test'].includes(normalizedVendor)) {
    if (!sanitized) {
      return {
        valid: true,
        sanitizedKey: normalizedVendor === 'ollama' ? 'ollama' : '',
      };
    }
  }

  if (['openai-compatible'].includes(normalizedVendor)) {
    if (!sanitized) {
      return {
        valid: true,
        sanitizedKey: undefined,
      };
    }
  }

  if (!sanitized) {
    return {
      valid: false,
      error: `API key for vendor "${vendor}" is missing or empty.`,
    };
  }

  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(sanitized)) {
      return {
        valid: false,
        sanitizedKey: sanitized,
        error: `API key appears to be an unconfigured placeholder ("${maskApiKey(sanitized)}"). Please provide a valid key.`,
      };
    }
  }

  let warning: string | undefined;

  if (['anthropic', 'claude'].includes(normalizedVendor)) {
    if (!sanitized.startsWith('sk-ant-') && !sanitized.startsWith('sk-')) {
      warning = `Anthropic API keys typically start with "sk-ant-".`;
    } else if (sanitized.length < 20) {
      warning = `Anthropic API key seems unusually short (${sanitized.length} chars).`;
    }
  } else if (['openai'].includes(normalizedVendor)) {
    if (!sanitized.startsWith('sk-')) {
      warning = `OpenAI API keys typically start with "sk-".`;
    } else if (sanitized.length < 20) {
      warning = `OpenAI API key seems unusually short (${sanitized.length} chars).`;
    }
  } else if (['google', 'gemini'].includes(normalizedVendor)) {
    if (sanitized.length < 20) {
      warning = `Google Gemini API key seems unusually short (${sanitized.length} chars).`;
    }
  } else if (['groq'].includes(normalizedVendor)) {
    if (!sanitized.startsWith('gsk_')) {
      warning = `Groq API keys typically start with "gsk_".`;
    }
  } else if (['deepseek'].includes(normalizedVendor)) {
    if (!sanitized.startsWith('sk-')) {
      warning = `DeepSeek API keys typically start with "sk-".`;
    } else if (sanitized.length < 20) {
      warning = `DeepSeek API key seems unusually short (${sanitized.length} chars).`;
    }
  } else if (['openrouter'].includes(normalizedVendor)) {
    if (!sanitized.startsWith('sk-or-')) {
      warning = `OpenRouter API keys typically start with "sk-or-".`;
    }
  } else if (['mistral'].includes(normalizedVendor)) {
    if (sanitized.length < 16) {
      warning = `Mistral API key seems unusually short (${sanitized.length} chars).`;
    }
  }

  return {
    valid: true,
    sanitizedKey: sanitized,
    warning,
  };
}

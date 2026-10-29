import { describe, it, expect } from 'vitest';
import {
  validateProviderApiKey,
  getProviderKeyHint,
  maskApiKey,
  sanitizeApiKey,
} from '../index.js';

describe('BYOK validation and masking', () => {
  describe('maskApiKey', () => {
    it('masks undefined or empty key as <none>', () => {
      expect(maskApiKey(undefined)).toBe('<none>');
      expect(maskApiKey('')).toBe('<none>');
      expect(maskApiKey('   ')).toBe('<none>');
    });

    it('masks short keys as ***', () => {
      expect(maskApiKey('12345')).toBe('***');
      expect(maskApiKey('12345678')).toBe('***');
    });

    it('masks longer keys preserving prefix and suffix safely', () => {
      const key1 = 'sk-ant-' + '1234567890abcdef';
      expect(maskApiKey(key1)).toBe('sk-...cdef');
      expect(maskApiKey(key1)).not.toContain('1234567890');

      const key2 = 'sk-proj-' + '1234567890abcdef';
      expect(maskApiKey(key2)).toBe('sk-...cdef');

      const key3 = 'AIzaSy1234567890abcdef';
      expect(maskApiKey(key3)).toBe('AIza...cdef');
    });
  });

  describe('sanitizeApiKey', () => {
    it('trims whitespace and quotes', () => {
      expect(sanitizeApiKey('  sk-test-key-12345  ')).toBe('sk-test-key-12345');
      expect(sanitizeApiKey('"sk-test-key-12345"')).toBe('sk-test-key-12345');
      expect(sanitizeApiKey("'sk-test-key-12345'")).toBe('sk-test-key-12345');
    });

    it('strips Bearer prefix and handles nested quotes and whitespace', () => {
      expect(sanitizeApiKey('Bearer sk-test-key-12345')).toBe('sk-test-key-12345');
      expect(sanitizeApiKey('bearer sk-test-key-12345')).toBe('sk-test-key-12345');
      expect(sanitizeApiKey('  Bearer "sk-test-key-12345"  ')).toBe('sk-test-key-12345');
    });
  });

  describe('validateProviderApiKey & placeholder rejection', () => {
    it('validates genuine keys for Anthropic, OpenAI, Groq, Mistral, and DeepSeek', () => {
      const anthropicKey = 'sk-ant-api03-' + 'a'.repeat(40);
      const antRes = validateProviderApiKey('anthropic', anthropicKey);
      expect(antRes.valid).toBe(true);
      expect(antRes.warning).toBeUndefined();

      const openaiKey = 'sk-proj-' + 'b'.repeat(40);
      const oaiRes = validateProviderApiKey('openai', openaiKey);
      expect(oaiRes.valid).toBe(true);
      expect(oaiRes.warning).toBeUndefined();

      const groqKey = 'gsk_' + 'c'.repeat(30);
      const groqRes = validateProviderApiKey('groq', groqKey);
      expect(groqRes.valid).toBe(true);
      expect(groqRes.warning).toBeUndefined();

      const mistralKey = 'd'.repeat(32);
      const mistralRes = validateProviderApiKey('mistral', mistralKey);
      expect(mistralRes.valid).toBe(true);
      expect(mistralRes.warning).toBeUndefined();

      const deepseekKey = 'sk-' + 'e'.repeat(32);
      const dsRes = validateProviderApiKey('deepseek', deepseekKey);
      expect(dsRes.valid).toBe(true);
      expect(dsRes.warning).toBeUndefined();
    });

    it('rejects missing key for paid providers', () => {
      const res = validateProviderApiKey('anthropic', '');
      expect(res.valid).toBe(false);
      expect(res.error).toContain('missing or empty');
    });

    it('allows empty key for ollama', () => {
      const res = validateProviderApiKey('ollama', '');
      expect(res.valid).toBe(true);
      expect(res.sanitizedKey).toBe('ollama');
    });

    it('allows empty key for openai-compatible', () => {
      const res = validateProviderApiKey('openai-compatible', '');
      expect(res.valid).toBe(true);
    });

    it('rejects placeholders for any provider', () => {
      const placeholders = [
        'sk-...',
        'your-api-key',
        'placeholder',
        '<insert_key_here>',
        'xxx',
        'sk-ant-...',
        'YOUR_KEY_HERE',
        'todo',
        'xxxxxxxxx',
        '<your-key>',
        'insert-key-here',
      ];
      for (const p of placeholders) {
        const res = validateProviderApiKey('openai', p);
        expect(res.valid).toBe(false);
        expect(res.error).toContain('placeholder');
      }
    });

    it('validates anthropic keys and warns if prefix unexpected or too short', () => {
      const shortRes = validateProviderApiKey('anthropic', 'sk-ant-short');
      expect(shortRes.valid).toBe(true);
      expect(shortRes.warning).toContain('unusually short');

      const nonStandard = validateProviderApiKey('anthropic', 'custom-key-12345678901234567890');
      expect(nonStandard.valid).toBe(true);
      expect(nonStandard.warning).toContain('sk-ant-');
    });

    it('validates groq keys and warns on wrong prefix', () => {
      const wrong = validateProviderApiKey('groq', 'sk-123456789012345678901234567890');
      expect(wrong.valid).toBe(true);
      expect(wrong.warning).toContain('gsk_');

      const ok = validateProviderApiKey('groq', 'gsk_123456789012345678901234567890');
      expect(ok.valid).toBe(true);
      expect(ok.warning).toBeUndefined();
    });
  });

  describe('getProviderKeyHint', () => {
    it('returns informative hints for providers', () => {
      expect(getProviderKeyHint('anthropic')).toContain('sk-ant-');
      expect(getProviderKeyHint('openai')).toContain('sk-');
      expect(getProviderKeyHint('google')).toContain('AIzaSy');
      expect(getProviderKeyHint('groq')).toContain('gsk_');
      expect(getProviderKeyHint('ollama')).toContain('Optional');
    });
  });
});

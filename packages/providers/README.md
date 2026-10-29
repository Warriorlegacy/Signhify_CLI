# @signhify/providers

Model provider adapters, validation engine, and transparent fallback routing for the Signhify AI coding agent.

`@signhify/providers` powers Signhify's hardened **Bring Your Own Key (BYOK)** architecture. It abstracts proprietary and open model protocols into a unified streaming interface with enterprise-grade credential sanitization, format diagnostics, and automated failover recovery.

## Installation

```bash
npm install @signhify/providers
```

## Supported Providers & Protocols

| Provider | Vendor ID | Default Models | Key Format / Prefix |
|---|---|---|---|
| **Anthropic** | `anthropic`, `claude` | `claude-3-5-sonnet-20241022`, `claude-3-5-haiku-20241022` | `sk-ant-api03-...` (~100+ chars) |
| **OpenAI** | `openai` | `gpt-4o`, `o1`, `o1-mini`, `gpt-4o-mini` | `sk-proj-...` or `sk-...` (~50+ chars) |
| **Google Gemini** | `google`, `gemini` | `gemini-1.5-pro`, `gemini-2.0-flash` | `AIzaSy...` (~39 chars) |
| **Groq** | `groq` | `llama-3.3-70b-versatile`, `mixtral-8x7b-32768` | `gsk_...` (~56 chars) |
| **DeepSeek** | `deepseek` | `deepseek-chat` (V3), `deepseek-reasoner` (R1) | `sk-...` (~32 chars) |
| **OpenRouter** | `openrouter` | Any open or commercial model route | `sk-or-v1-...` |
| **Mistral AI** | `mistral` | `mistral-large-latest`, `codestral-latest` | 32-character hex token |
| **Ollama** | `ollama` | `llama3.2`, `qwen2.5-coder`, `deepseek-r1` | Unauthenticated / local (`http://localhost:11434/v1`) |
| **OpenAI-Compatible** | `openai-compatible` | Custom vLLM, LM Studio, LocalAI, Together, Cerebras | Custom base URL + bearer token |

## BYOK Credential Validation & Diagnostics

The package includes static format verification and runtime validation through `validateProviderApiKey()` and `getProviderKeyHint()`.

```ts
import { validateProviderApiKey, getProviderKeyHint } from '@signhify/providers';

// Validate key formats and placeholder safety
const result = validateProviderApiKey('anthropic', 'sk-ant-api03-abcdef...');
// -> { valid: true, sanitizedKey: 'sk-ant-api03-abcdef...' }

const invalid = validateProviderApiKey('openai', 'sk-...');
// -> { valid: false, error: 'API key appears to be an unconfigured placeholder ("sk-..."). Please provide a valid key.' }
```

### Validation Invariants
1. **Placeholder Rejection**: Trailing ellipses (`...`), `sk-...`, `your-api-key`, `placeholder`, `todo`, `test-key`, and bracketed `<insert-key>` tokens are rejected upfront.
2. **Vendor Prefix Verification**: Warnings are emitted if Anthropic keys do not start with `sk-ant-`, Groq keys without `gsk_`, Gemini keys without `AIzaSy`, or OpenRouter keys without `sk-or-`.
3. **Length Floors**: Detects truncated or corrupted keys prior to sending network requests.
4. **Local & Proxy Relaxations**: Local endpoints (`ollama`) and `openai-compatible` proxies permit omitted keys without error.

## Credential Sanitization & Security Isolation

- **Zero Raw Key Storage**: The package never serializes plaintext keys to logs, traces, or unencrypted storage.
- **Masking Utility**: `maskApiKey(key)` preserves vendor prefix and last 4 characters while masking the secret payload:
  ```ts
  import { maskApiKey } from '@signhify/providers';
  console.log(maskApiKey('sk-ant-api03-1234567890abcdef')); 
  // 'sk-ant-***cdef'
  ```
- **Hierarchical Key Resolution**: `resolveProviderKey(config)` resolves credentials across multiple isolation tiers:
  1. Explicit `config.apiKey` (in-memory)
  2. `config.apiKeyEnv` pointer
  3. `config.apiKeyRef` (`env:VAR_NAME` or `keytar:signhify:...`)
  4. Namespaced environment variable: `SIGNHIFY_<VENDOR>_API_KEY`
  5. Canonical vendor environment variable: `<VENDOR>_API_KEY`

## Transparent Fallback & Error Recovery

Signhify's `FallbackRouter` wraps model adapters in an automatic failover circuit breaker:

```ts
import { FallbackRouter, createAdapter } from '@signhify/providers';

const primary = await createAdapter({
  vendor: 'anthropic',
  model: 'claude-3-5-sonnet-20241022',
  apiKeyEnv: 'SIGNHIFY_ANTHROPIC_API_KEY',
});

const router = new FallbackRouter({
  primary,
  fallbackChain: [
    { name: 'deepseek-r1', vendor: 'deepseek', model: 'deepseek-reasoner' },
    { name: 'gemini-flash', vendor: 'google', model: 'gemini-2.0-flash' },
    { name: 'local-ollama', vendor: 'ollama', model: 'qwen2.5-coder', isLocal: true },
  ],
});
```

### Failover Trigger Conditions
- **HTTP 429 (Rate Limits / Token Quotas)**: Immediately routes to next fallback provider.
- **Context Window Overflow (HTTP 400)**: Escalates to long-context model fallback.
- **Upstream Network Outages (HTTP 5xx)**: Exponential backoff retries followed by seamless failover.
- **Zero Token/State Loss**: The active agent loop conversation history and tool execution results remain completely intact during fallback execution.

## Usage Example

```ts
import { createAdapter, listSupportedVendors } from '@signhify/providers';

// Inspect supported engines
console.log(listSupportedVendors());

// Instantiate an adapter
const adapter = await createAdapter({
  vendor: 'anthropic',
  model: 'claude-3-5-sonnet-20241022',
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Stream completions with native tool calling
const model = adapter.getModel();
```

## License

MIT

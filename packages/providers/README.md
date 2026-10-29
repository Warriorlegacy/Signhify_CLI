# @signhify/providers

Model provider adapters for Signhify CLI. Connects seamlessly to Anthropic Claude, OpenAI, Google Gemini, and arbitrary OpenAI-compatible endpoints (Groq, Ollama, OpenRouter, Together AI).

## Installation

```bash
npm install @signhify/providers
```

## Features

- **AnthropicAdapter**: Streaming Claude 3.5 Sonnet and Haiku via official SDK with tool calling support.
- **OpenAIAdapter**: Official OpenAI API integration supporting GPT-4o, o1, and reasoning models.
- **GoogleGeminiAdapter**: Native Gemini 1.5 Pro and Flash adapters.
- **OpenAICompatibleAdapter**: Universal adapter for local and hosted endpoints (Ollama, vLLM, Groq, OpenRouter).
- **FallbackRouter**: Two-tier model routing (fast inline autocomplete vs deep reasoning agent loop) and automatic provider failover.

## License

MIT

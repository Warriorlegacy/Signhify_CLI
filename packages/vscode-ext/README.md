# Signhify — AI Engineering Agent for VS Code

Your AI engineering partner — in the terminal and in the IDE.

## Features

- **Chat Panel**: Webview-based chat interface in the activity bar (`Signhify Chat`).
- **Inline Completions**: Fast LLM-backed code suggestions as you type.
- **Commands**:
  - `Signhify: New Task` (`signhify.newTask`)
  - `Signhify: Set API Key` (`signhify.setApiKey`)
  - `Signhify: Set Autocomplete API Key` (`signhify.setAutocompleteApiKey`)
  - `Signhify: Switch Mode` (`signhify.switchMode`)
  - `Signhify: Open Memory` (`signhify.openMemory`)
  - `Signhify: Trigger Inline Completion` (`signhify.triggerInlineCompletion`)
- **Secure Key Storage**: API keys stored in VS Code SecretStorage.

## Configuration

Configure providers and models via VS Code Settings under `signhify.*`:
- `signhify.provider.vendor`: Provider vendor (`openai`, `anthropic`, `google`, `openai-compatible`).
- `signhify.provider.model`: Model name.
- `signhify.provider.baseUrl`: Optional base URL.
- `signhify.provider.autocomplete.vendor`: Autocomplete model provider.
- `signhify.provider.autocomplete.model`: Autocomplete model name.
- `signhify.provider.autocomplete.baseUrl`: Optional autocomplete base URL.

## Installation

Install from the packaged `.vsix` file:
```bash
code --install-extension signhify-0.3.0.vsix
```

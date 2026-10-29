import type { LanguageModel } from 'ai';
import { createAISDKAdapter, createMockAdapter, ModelProviderAdapter } from './adapter.js';

export interface ProviderFactoryConfig {
  vendor: string;
  model: string;
  apiKey?: string;
  /** Reference for the API key: "env:VAR_NAME" or a literal key. */
  apiKeyRef?: string;
  apiKeyEnv?: string;
  baseUrl?: string;
}

/**
 * Sanitizes an API key string by trimming whitespace, enclosing quotes,
 * and stripping any leading "Bearer " token prefix.
 */
export function sanitizeApiKey(key: string | undefined): string | undefined {
  if (!key) return undefined;
  let trimmed = key.trim().replace(/^['"]+|['"]+$/g, '');
  if (/^bearer\s+/i.test(trimmed)) {
    trimmed = trimmed.replace(/^bearer\s+/i, '').trim();
  }
  trimmed = trimmed.replace(/^['"]+|['"]+$/g, '').trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Masks an API key for safe logging, diagnostics, and display (never logs full credentials).
 */
export function maskApiKey(key?: string): string {
  if (!key) return '<none>';
  const clean = sanitizeApiKey(key) ?? '';
  if (clean.length === 0) return '<none>';
  if (clean.length <= 8) return '***';
  if (clean.startsWith('sk-')) {
    const suffix = clean.slice(-4);
    return `sk-...${suffix}`;
  }
  const prefix = clean.slice(0, 4);
  const suffix = clean.slice(-4);
  return `${prefix}...${suffix}`;
}

const VENDOR_ENV_MAP: Record<string, string[]> = {
  openai: ['OPENAI_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
  claude: ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'],
  google: ['GOOGLE_GENERATIVE_AI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_API_KEY'],
  deepseek: ['DEEPSEEK_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
  ollama: ['OLLAMA_API_KEY'],
  mistral: ['MISTRAL_API_KEY'],
  groq: ['GROQ_API_KEY'],
  xai: ['XAI_API_KEY'],
  grok: ['XAI_API_KEY', 'GROK_API_KEY'],
  togetherai: ['TOGETHER_API_KEY', 'TOGETHERAI_API_KEY'],
  together: ['TOGETHER_API_KEY', 'TOGETHERAI_API_KEY'],
  perplexity: ['PERPLEXITY_API_KEY'],
  deepinfra: ['DEEPINFRA_API_KEY'],
  fireworks: ['FIREWORKS_API_KEY'],
  cohere: ['COHERE_API_KEY'],
  cerebras: ['CEREBRAS_API_KEY'],
  alibaba: ['ALIBABA_API_KEY'],
  qwen: ['ALIBABA_API_KEY', 'QWEN_API_KEY'],
  azure: ['AZURE_API_KEY'],
};

/**
 * Single apiKeyRef resolution point: env: ref → environment variable,
 * otherwise the ref is a literal key. Explicit apiKey still wins.
 * Checks SIGNHIFY_<VENDOR>_API_KEY before <VENDOR>_API_KEY.
 * All resolved keys are sanitized.
 */
export function resolveProviderKey(config: ProviderFactoryConfig): string | undefined {
  if (config.apiKey) {
    const sanitized = sanitizeApiKey(config.apiKey);
    if (sanitized) return sanitized;
  }

  if (config.apiKeyEnv) {
    const envVar = config.apiKeyEnv;
    const signhifyVar = envVar.startsWith('SIGNHIFY_') ? envVar : `SIGNHIFY_${envVar}`;
    const signhifyVal = process.env[signhifyVar];
    if (signhifyVal) {
      const sanitized = sanitizeApiKey(signhifyVal);
      if (sanitized) return sanitized;
    }
    const val = process.env[envVar];
    if (val) {
      const sanitized = sanitizeApiKey(val);
      if (sanitized) return sanitized;
    }
  }

  const ref = config.apiKeyRef;
  if (ref?.startsWith('env:')) {
    const envVar = ref.slice(4);
    const signhifyVar = envVar.startsWith('SIGNHIFY_') ? envVar : `SIGNHIFY_${envVar}`;
    const signhifyVal = process.env[signhifyVar];
    if (signhifyVal) {
      const sanitized = sanitizeApiKey(signhifyVal);
      if (sanitized) return sanitized;
    }
    const val = process.env[envVar];
    if (val) {
      const sanitized = sanitizeApiKey(val);
      if (sanitized) return sanitized;
    }
  } else if (ref && !ref.startsWith('keytar:')) {
    const sanitized = sanitizeApiKey(ref);
    if (sanitized) return sanitized;
  }

  if (config.vendor) {
    const norm = config.vendor.toLowerCase().replace(/[^a-z0-9]/g, '');
    const rawUpper = config.vendor.toUpperCase().replace(/[^A-Z0-9]/g, '_');
    const knownVars = VENDOR_ENV_MAP[norm] ?? [];
    const envVars = [...new Set([...knownVars, `${rawUpper}_API_KEY`])];

    for (const v of envVars) {
      const signhifyVar = v.startsWith('SIGNHIFY_') ? v : `SIGNHIFY_${v}`;
      const signhifyVal = process.env[signhifyVar];
      if (signhifyVal) {
        const sanitized = sanitizeApiKey(signhifyVal);
        if (sanitized) return sanitized;
      }
      const val = process.env[v];
      if (val) {
        const sanitized = sanitizeApiKey(val);
        if (sanitized) return sanitized;
      }
    }
  }

  return undefined;
}

type ModelLoader = (modelId: string) => LanguageModel;

async function loadOpenAI(config: ProviderFactoryConfig): Promise<ModelLoader> {
  const { createOpenAI } = await import('@ai-sdk/openai');
  const apiKey = resolveProviderKey(config) ?? process.env.OPENAI_API_KEY ?? '';
  const provider = createOpenAI({ apiKey: apiKey || undefined, baseURL: config.baseUrl });
  return (modelId: string) => provider.languageModel(modelId) as unknown as LanguageModel;
}

async function loadAnthropic(config: ProviderFactoryConfig): Promise<ModelLoader> {
  const { createAnthropic } = await import('@ai-sdk/anthropic');
  const apiKey = resolveProviderKey(config) ?? process.env.ANTHROPIC_API_KEY ?? '';
  const provider = createAnthropic({ apiKey: apiKey || undefined, baseURL: config.baseUrl });
  return (modelId: string) => provider.languageModel(modelId) as unknown as LanguageModel;
}

async function loadGoogle(config: ProviderFactoryConfig): Promise<ModelLoader> {
  const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
  const apiKey = resolveProviderKey(config) ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? '';
  const provider = createGoogleGenerativeAI({ apiKey: apiKey || undefined, baseURL: config.baseUrl });
  return (modelId: string) => provider.languageModel(modelId) as unknown as LanguageModel;
}

async function loadAmazonBedrock(config: ProviderFactoryConfig): Promise<ModelLoader> {
  const { createAmazonBedrock } = await import('@ai-sdk/amazon-bedrock');
  const region = process.env.AWS_REGION ?? 'us-east-1';
  const provider = createAmazonBedrock({
    accessKeyId: resolveProviderKey(config) ?? process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region,
  });
  return (modelId: string) => provider.languageModel(modelId) as unknown as LanguageModel;
}

async function loadAzure(config: ProviderFactoryConfig): Promise<ModelLoader> {
  const { createAzure } = await import('@ai-sdk/azure');
  const apiKey = resolveProviderKey(config) ?? process.env.AZURE_API_KEY ?? '';
  const resourceName = config.baseUrl ?? process.env.AZURE_RESOURCE_NAME ?? '';
  const provider = createAzure({ apiKey: apiKey || undefined, resourceName });
  return (modelId: string) => provider.languageModel(modelId) as unknown as LanguageModel;
}

async function loadGoogleVertex(config: ProviderFactoryConfig): Promise<ModelLoader> {
  const { createVertex } = await import('@ai-sdk/google-vertex');
  const provider = createVertex({
    project: config.baseUrl ?? process.env.GOOGLE_VERTEX_PROJECT,
    location: process.env.GOOGLE_VERTEX_LOCATION ?? 'us-central1',
  });
  return (modelId: string) => provider.languageModel(modelId) as unknown as LanguageModel;
}

async function loadMistral(config: ProviderFactoryConfig): Promise<ModelLoader> {
  const { createMistral } = await import('@ai-sdk/mistral');
  const apiKey = resolveProviderKey(config) ?? process.env.MISTRAL_API_KEY ?? '';
  const provider = createMistral({ apiKey: apiKey || undefined, baseURL: config.baseUrl });
  return (modelId: string) => provider.languageModel(modelId) as unknown as LanguageModel;
}

async function loadGroq(config: ProviderFactoryConfig): Promise<ModelLoader> {
  const { createGroq } = await import('@ai-sdk/groq');
  const apiKey = resolveProviderKey(config) ?? process.env.GROQ_API_KEY ?? '';
  const provider = createGroq({ apiKey: apiKey || undefined, baseURL: config.baseUrl });
  return (modelId: string) => provider.languageModel(modelId) as unknown as LanguageModel;
}

async function loadXai(config: ProviderFactoryConfig): Promise<ModelLoader> {
  const { createXai } = await import('@ai-sdk/xai');
  const apiKey = resolveProviderKey(config) ?? process.env.XAI_API_KEY ?? '';
  const provider = createXai({ apiKey: apiKey || undefined, baseURL: config.baseUrl });
  return (modelId: string) => provider.languageModel(modelId) as unknown as LanguageModel;
}

async function loadTogetherAI(config: ProviderFactoryConfig): Promise<ModelLoader> {
  const { createTogetherAI } = await import('@ai-sdk/togetherai');
  const apiKey = resolveProviderKey(config) ?? process.env.TOGETHER_API_KEY ?? '';
  const provider = createTogetherAI({ apiKey: apiKey || undefined, baseURL: config.baseUrl });
  return (modelId: string) => provider.languageModel(modelId) as unknown as LanguageModel;
}

async function loadPerplexity(config: ProviderFactoryConfig): Promise<ModelLoader> {
  const { createPerplexity } = await import('@ai-sdk/perplexity');
  const apiKey = resolveProviderKey(config) ?? process.env.PERPLEXITY_API_KEY ?? '';
  const provider = createPerplexity({ apiKey: apiKey || undefined, baseURL: config.baseUrl });
  return (modelId: string) => provider.languageModel(modelId) as unknown as LanguageModel;
}

async function loadDeepInfra(config: ProviderFactoryConfig): Promise<ModelLoader> {
  const { createDeepInfra } = await import('@ai-sdk/deepinfra');
  const apiKey = resolveProviderKey(config) ?? process.env.DEEPINFRA_API_KEY ?? '';
  const provider = createDeepInfra({ apiKey: apiKey || undefined, baseURL: config.baseUrl });
  return (modelId: string) => provider.languageModel(modelId) as unknown as LanguageModel;
}

async function loadFireworks(config: ProviderFactoryConfig): Promise<ModelLoader> {
  const { createFireworks } = await import('@ai-sdk/fireworks');
  const apiKey = resolveProviderKey(config) ?? process.env.FIREWORKS_API_KEY ?? '';
  const provider = createFireworks({ apiKey: apiKey || undefined, baseURL: config.baseUrl });
  return (modelId: string) => provider.languageModel(modelId) as unknown as LanguageModel;
}

async function loadCohere(config: ProviderFactoryConfig): Promise<ModelLoader> {
  const { createCohere } = await import('@ai-sdk/cohere');
  const apiKey = resolveProviderKey(config) ?? process.env.COHERE_API_KEY ?? '';
  const provider = createCohere({ apiKey: apiKey || undefined, baseURL: config.baseUrl });
  return (modelId: string) => provider.languageModel(modelId) as unknown as LanguageModel;
}

async function loadCerebras(config: ProviderFactoryConfig): Promise<ModelLoader> {
  const { createCerebras } = await import('@ai-sdk/cerebras');
  const apiKey = resolveProviderKey(config) ?? process.env.CEREBRAS_API_KEY ?? '';
  const provider = createCerebras({ apiKey: apiKey || undefined, baseURL: config.baseUrl });
  return (modelId: string) => provider.languageModel(modelId) as unknown as LanguageModel;
}

async function loadAlibaba(config: ProviderFactoryConfig): Promise<ModelLoader> {
  const { createAlibaba } = await import('@ai-sdk/alibaba');
  const apiKey = resolveProviderKey(config) ?? process.env.ALIBABA_API_KEY ?? '';
  const provider = createAlibaba({ apiKey: apiKey || undefined, baseURL: config.baseUrl });
  return (modelId: string) => provider.languageModel(modelId) as unknown as LanguageModel;
}

async function loadGateway(config: ProviderFactoryConfig): Promise<ModelLoader> {
  const { createGateway } = await import('@ai-sdk/gateway');
  const apiKey = resolveProviderKey(config) ?? process.env.AI_GATEWAY_API_KEY ?? '';
  const provider = createGateway({ apiKey: apiKey || undefined, baseURL: config.baseUrl });
  return (modelId: string) => provider.languageModel(modelId) as unknown as LanguageModel;
}

async function loadDeepSeek(config: ProviderFactoryConfig): Promise<ModelLoader> {
  const { createDeepSeek } = await import('@ai-sdk/deepseek');
  const apiKey = resolveProviderKey(config) ?? process.env.SIGNHIFY_DEEPSEEK_API_KEY ?? process.env.DEEPSEEK_API_KEY ?? '';
  const provider = createDeepSeek({ apiKey: apiKey || undefined, baseURL: config.baseUrl });
  return (modelId: string) => provider.languageModel(modelId) as unknown as LanguageModel;
}

async function loadOpenAICompatible(config: ProviderFactoryConfig): Promise<ModelLoader> {
  const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
  let baseURL = config.baseUrl;
  if (!baseURL) {
    if (config.vendor === 'ollama') baseURL = 'http://localhost:11434/v1';
    else if (config.vendor === 'openrouter') baseURL = 'https://openrouter.ai/api/v1';
    else baseURL = 'http://localhost:11434/v1';
  }
  const apiKey = resolveProviderKey(config)
    ?? (config.vendor === 'openrouter' ? (process.env.SIGNHIFY_OPENROUTER_API_KEY ?? process.env.OPENROUTER_API_KEY) : undefined)
    ?? (config.vendor === 'ollama' ? 'ollama' : undefined)
    ?? process.env.SIGNHIFY_OPENAI_COMPATIBLE_API_KEY
    ?? process.env.OPENAI_COMPATIBLE_API_KEY
    ?? process.env.OPENAI_API_KEY
    ?? (config.vendor === 'ollama' ? 'ollama' : '');
  const provider = createOpenAICompatible({
    name: config.vendor || 'openai-compatible',
    baseURL,
    apiKey: apiKey || undefined,
    headers: config.vendor === 'openrouter' ? {
      'HTTP-Referer': 'https://signhify.dev',
      'X-Title': 'Signhify CLI',
    } : undefined,
  });
  return (modelId: string) => provider.languageModel(modelId) as unknown as LanguageModel;
}

interface VendorDef {
  match: string[];
  loader: (config: ProviderFactoryConfig) => Promise<ModelLoader>;
}

const vendors: VendorDef[] = [
  { match: ['openai'], loader: loadOpenAI },
  { match: ['anthropic', 'claude'], loader: loadAnthropic },
  { match: ['google', 'gemini'], loader: loadGoogle },
  { match: ['deepseek'], loader: loadDeepSeek },
  { match: ['ollama'], loader: loadOpenAICompatible },
  { match: ['openrouter'], loader: loadOpenAICompatible },
  { match: ['amazon-bedrock', 'bedrock'], loader: loadAmazonBedrock },
  { match: ['azure'], loader: loadAzure },
  { match: ['google-vertex', 'vertex'], loader: loadGoogleVertex },
  { match: ['mistral'], loader: loadMistral },
  { match: ['groq'], loader: loadGroq },
  { match: ['xai', 'grok'], loader: loadXai },
  { match: ['togetherai', 'together'], loader: loadTogetherAI },
  { match: ['perplexity'], loader: loadPerplexity },
  { match: ['deepinfra'], loader: loadDeepInfra },
  { match: ['fireworks'], loader: loadFireworks },
  { match: ['cohere'], loader: loadCohere },
  { match: ['cerebras'], loader: loadCerebras },
  { match: ['alibaba', 'qwen'], loader: loadAlibaba },
  { match: ['gateway', 'ai-gateway', 'llmgateway'], loader: loadGateway },
  { match: ['openai-compatible'], loader: loadOpenAICompatible },
];

export async function createAdapter(config: ProviderFactoryConfig): Promise<ModelProviderAdapter> {
  const vendor = config.vendor.toLowerCase();

  // Hermetic mock provider for tests, CI, and offline operation
  if (
    process.env.SIGNHIFY_MOCK_PROVIDER === '1' ||
    process.env.SIGNHIFY_MOCK_PROVIDER === 'true' ||
    vendor === 'mock' ||
    vendor === 'test'
  ) {
    return createMockAdapter({ vendor });
  }

  const apiKey = resolveProviderKey(config) ?? '';

  for (const def of vendors) {
    if (def.match.includes(vendor)) {
      const getModel = await def.loader({ ...config, apiKey });
      return createAISDKAdapter({ vendor, getModel });
    }
  }

  throw new Error(
    `Unknown vendor: "${config.vendor}". Supported: ${[...new Set(vendors.flatMap(v => v.match))].join(', ')}`,
  );
}

export function listSupportedVendors(): string[] {
  return [...new Set(vendors.flatMap(v => v.match))];
}

import type { LanguageModel } from 'ai';
import { createAISDKAdapter, ModelProviderAdapter } from './adapter.js';

export interface ProviderFactoryConfig {
  vendor: string;
  model: string;
  apiKey?: string;
  apiKeyEnv?: string;
  baseUrl?: string;
}

type ModelLoader = (modelId: string) => LanguageModel;

async function loadOpenAI(config: ProviderFactoryConfig): Promise<ModelLoader> {
  const { createOpenAI } = await import('@ai-sdk/openai');
  const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY ?? '';
  const provider = createOpenAI({ apiKey: apiKey || undefined, baseURL: config.baseUrl });
  return (modelId: string) => provider.languageModel(modelId) as unknown as LanguageModel;
}

async function loadAnthropic(config: ProviderFactoryConfig): Promise<ModelLoader> {
  const { createAnthropic } = await import('@ai-sdk/anthropic');
  const apiKey = config.apiKey ?? process.env.ANTHROPIC_API_KEY ?? '';
  const provider = createAnthropic({ apiKey: apiKey || undefined, baseURL: config.baseUrl });
  return (modelId: string) => provider.languageModel(modelId) as unknown as LanguageModel;
}

async function loadGoogle(config: ProviderFactoryConfig): Promise<ModelLoader> {
  const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
  const apiKey = config.apiKey ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? '';
  const provider = createGoogleGenerativeAI({ apiKey: apiKey || undefined, baseURL: config.baseUrl });
  return (modelId: string) => provider.languageModel(modelId) as unknown as LanguageModel;
}

async function loadAmazonBedrock(config: ProviderFactoryConfig): Promise<ModelLoader> {
  const { createAmazonBedrock } = await import('@ai-sdk/amazon-bedrock');
  const region = process.env.AWS_REGION ?? 'us-east-1';
  const provider = createAmazonBedrock({
    accessKeyId: config.apiKey ?? process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region,
  });
  return (modelId: string) => provider.languageModel(modelId) as unknown as LanguageModel;
}

async function loadAzure(config: ProviderFactoryConfig): Promise<ModelLoader> {
  const { createAzure } = await import('@ai-sdk/azure');
  const apiKey = config.apiKey ?? process.env.AZURE_API_KEY ?? '';
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
  const apiKey = config.apiKey ?? process.env.MISTRAL_API_KEY ?? '';
  const provider = createMistral({ apiKey: apiKey || undefined, baseURL: config.baseUrl });
  return (modelId: string) => provider.languageModel(modelId) as unknown as LanguageModel;
}

async function loadGroq(config: ProviderFactoryConfig): Promise<ModelLoader> {
  const { createGroq } = await import('@ai-sdk/groq');
  const apiKey = config.apiKey ?? process.env.GROQ_API_KEY ?? '';
  const provider = createGroq({ apiKey: apiKey || undefined, baseURL: config.baseUrl });
  return (modelId: string) => provider.languageModel(modelId) as unknown as LanguageModel;
}

async function loadXai(config: ProviderFactoryConfig): Promise<ModelLoader> {
  const { createXai } = await import('@ai-sdk/xai');
  const apiKey = config.apiKey ?? process.env.XAI_API_KEY ?? '';
  const provider = createXai({ apiKey: apiKey || undefined, baseURL: config.baseUrl });
  return (modelId: string) => provider.languageModel(modelId) as unknown as LanguageModel;
}

async function loadTogetherAI(config: ProviderFactoryConfig): Promise<ModelLoader> {
  const { createTogetherAI } = await import('@ai-sdk/togetherai');
  const apiKey = config.apiKey ?? process.env.TOGETHER_API_KEY ?? '';
  const provider = createTogetherAI({ apiKey: apiKey || undefined, baseURL: config.baseUrl });
  return (modelId: string) => provider.languageModel(modelId) as unknown as LanguageModel;
}

async function loadPerplexity(config: ProviderFactoryConfig): Promise<ModelLoader> {
  const { createPerplexity } = await import('@ai-sdk/perplexity');
  const apiKey = config.apiKey ?? process.env.PERPLEXITY_API_KEY ?? '';
  const provider = createPerplexity({ apiKey: apiKey || undefined, baseURL: config.baseUrl });
  return (modelId: string) => provider.languageModel(modelId) as unknown as LanguageModel;
}

async function loadDeepInfra(config: ProviderFactoryConfig): Promise<ModelLoader> {
  const { createDeepInfra } = await import('@ai-sdk/deepinfra');
  const apiKey = config.apiKey ?? process.env.DEEPINFRA_API_KEY ?? '';
  const provider = createDeepInfra({ apiKey: apiKey || undefined, baseURL: config.baseUrl });
  return (modelId: string) => provider.languageModel(modelId) as unknown as LanguageModel;
}

async function loadFireworks(config: ProviderFactoryConfig): Promise<ModelLoader> {
  const { createFireworks } = await import('@ai-sdk/fireworks');
  const apiKey = config.apiKey ?? process.env.FIREWORKS_API_KEY ?? '';
  const provider = createFireworks({ apiKey: apiKey || undefined, baseURL: config.baseUrl });
  return (modelId: string) => provider.languageModel(modelId) as unknown as LanguageModel;
}

async function loadCohere(config: ProviderFactoryConfig): Promise<ModelLoader> {
  const { createCohere } = await import('@ai-sdk/cohere');
  const apiKey = config.apiKey ?? process.env.COHERE_API_KEY ?? '';
  const provider = createCohere({ apiKey: apiKey || undefined, baseURL: config.baseUrl });
  return (modelId: string) => provider.languageModel(modelId) as unknown as LanguageModel;
}

async function loadCerebras(config: ProviderFactoryConfig): Promise<ModelLoader> {
  const { createCerebras } = await import('@ai-sdk/cerebras');
  const apiKey = config.apiKey ?? process.env.CEREBRAS_API_KEY ?? '';
  const provider = createCerebras({ apiKey: apiKey || undefined, baseURL: config.baseUrl });
  return (modelId: string) => provider.languageModel(modelId) as unknown as LanguageModel;
}

async function loadAlibaba(config: ProviderFactoryConfig): Promise<ModelLoader> {
  const { createAlibaba } = await import('@ai-sdk/alibaba');
  const apiKey = config.apiKey ?? process.env.ALIBABA_API_KEY ?? '';
  const provider = createAlibaba({ apiKey: apiKey || undefined, baseURL: config.baseUrl });
  return (modelId: string) => provider.languageModel(modelId) as unknown as LanguageModel;
}

async function loadGateway(config: ProviderFactoryConfig): Promise<ModelLoader> {
  const { createGateway } = await import('@ai-sdk/gateway');
  const apiKey = config.apiKey ?? process.env.AI_GATEWAY_API_KEY ?? '';
  const provider = createGateway({ apiKey: apiKey || undefined, baseURL: config.baseUrl });
  return (modelId: string) => provider.languageModel(modelId) as unknown as LanguageModel;
}

async function loadOpenAICompatible(config: ProviderFactoryConfig): Promise<ModelLoader> {
  const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
  const baseURL = config.baseUrl ?? 'http://localhost:11434/v1';
  const apiKey = config.apiKey ?? '';
  const provider = createOpenAICompatible({
    name: 'openai-compatible',
    baseURL,
    apiKey: apiKey || undefined,
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
  const apiKey = config.apiKey ?? (config.apiKeyEnv ? process.env[config.apiKeyEnv] : undefined) ?? '';

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

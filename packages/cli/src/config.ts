import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import type { SignhifyConfig } from "@signhify/core";

interface KeytarModule {
  setPassword(service: string, account: string, password: string): Promise<void>;
  getPassword(service: string, account: string): Promise<string | null>;
}

let keytar: KeytarModule | null = null;
try {
  const require = createRequire(import.meta.url);
  keytar = require("keytar") as KeytarModule;
} catch {
  // keytar not installed — keychain integration disabled
}

const KEYTAR_SERVICE = "signhify";

const DEFAULT_CONFIG: SignhifyConfig = {
  provider: {
    agent: { vendor: "openai", model: "gpt-4", apiKeyRef: "env:OPENAI_API_KEY" },
    fallbackChain: [
      { name: "9router-local", vendor: "openai-compatible", baseUrl: "http://127.0.0.1:20128/v1", model: "gemini-2.0-flash", isLocal: true },
      { name: "freellmapi-local", vendor: "openai-compatible", baseUrl: "http://127.0.0.1:31415/v1", model: "default", isLocal: true },
      { name: "google-gemini-free", vendor: "google", model: "gemini-2.0-flash", apiKeyRef: "env:GEMINI_API_KEY" },
      { name: "groq-cloud", vendor: "groq", model: "llama-3.3-70b-versatile", apiKeyRef: "env:GROQ_API_KEY" },
      { name: "openrouter-free", vendor: "openai-compatible", baseUrl: "https://openrouter.ai/api/v1", model: "meta-llama/llama-3.3-70b-instruct:free", apiKeyRef: "env:OPENROUTER_API_KEY" },
    ],
  },
  memory: { tokenBudget: 4000, checkpointThresholdPct: 80, contextLimit: 128000 },
};

export async function signhifyConfigSchema(config: SignhifyConfig): Promise<SignhifyConfig> {
  const schema = loadConfigSchema();
  const errors = validateAgainstSchema(schema, config, "$", (schema as JsonObjectSchema).$defs ?? {});
  if (errors.length > 0) {
    throw new Error(`Config validation failed:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
  }
  return config;
}

async function validateConfigBeforeSecretStorage(config: SignhifyConfig): Promise<void> {
  const candidate = JSON.parse(JSON.stringify(config)) as SignhifyConfig;
  const entries = [
    candidate?.provider?.agent,
    candidate?.provider?.autocomplete,
    ...(candidate?.provider?.fallbackChain ?? []),
  ];
  for (const entry of entries) {
    if (typeof entry?.apiKeyRef === "string" && entry.apiKeyRef &&
      !/^env:[A-Za-z_][A-Za-z0-9_]*$/.test(entry.apiKeyRef) &&
      !/^keytar:signhify:.+$/.test(entry.apiKeyRef)) {
      entry.apiKeyRef = "env:SIGNHIFY_SECRET_PLACEHOLDER";
    }
  }
  await signhifyConfigSchema(candidate);
}

/** Minimal JSON Schema subset covering exactly the constructs the shipped file uses. */
interface JsonObjectSchema {
  type?: string;
  properties?: Record<string, JsonObjectSchema>;
  items?: JsonObjectSchema;
  required?: string[];
  enum?: string[];
  pattern?: string;
  additionalProperties?: boolean;
  minimum?: number;
  maximum?: number;
  $ref?: string;
  $defs?: Record<string, JsonObjectSchema>;
}

/**
 * Single source: `signhify.config.schema.json` at the repo root (shipped next to
 * config.js inside dist/ by the cli build). Walks up parent dirs so src/ tests,
 * dist/ runtime, and arbitrary cwd's all resolve the same file.
 */
function loadConfigSchema(): JsonObjectSchema {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 6; depth++) {
    try {
      return JSON.parse(readFileSync(path.join(dir, "signhify.config.schema.json"), "utf-8")) as JsonObjectSchema;
    } catch {
      dir = path.dirname(dir);
    }
  }
  throw new Error("signhify.config.schema.json not found — cannot validate config");
}

function validateAgainstSchema(
  schema: JsonObjectSchema,
  value: unknown,
  at: string,
  defs: Record<string, JsonObjectSchema>,
): string[] {
  if (schema.$ref) {
    const refName = schema.$ref.split("/").pop()!;
    const resolved = defs[refName];
    if (!resolved) return [`${at}: unresolved $ref ${schema.$ref}`];
    return validateAgainstSchema(resolved, value, at, defs);
  }
  switch (schema.type) {
    case "object": {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return [`${at} must be an object`];
      }
      const obj = value as Record<string, unknown>;
      const errors: string[] = [];
      for (const req of schema.required ?? []) {
        if (!(req in obj)) errors.push(`${at} missing required "${req}"`);
      }
      for (const [key, sub] of Object.entries(schema.properties ?? {})) {
        if (key in obj) errors.push(...validateAgainstSchema(sub, obj[key], `${at}.${key}`, defs));
      }
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(obj)) {
          if (!(key in (schema.properties ?? {}))) errors.push(`${at}.${key} is not an allowed property`);
        }
      }
      return errors;
    }
    case "array": {
      if (!Array.isArray(value)) return [`${at} must be an array`];
      if (schema.items) {
        return value.flatMap((item, i) => validateAgainstSchema(schema.items!, item, `${at}[${i}]`, defs));
      }
      return [];
    }
    case "string": {
      if (typeof value !== "string") return [`${at} must be a string`];
      if (schema.enum && !schema.enum.includes(value)) {
        return [`${at} must be one of: ${schema.enum.join(", ")}`];
      }
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
        return [`${at} must match ${schema.pattern}`];
      }
      return [];
    }
    case "integer": {
      if (typeof value !== "number" || !Number.isInteger(value)) {
        return [`${at} must be an integer`];
      }
      if (schema.minimum !== undefined && value < schema.minimum) {
        return [`${at} must be >= ${schema.minimum}`];
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        return [`${at} must be <= ${schema.maximum}`];
      }
      return [];
    }
    case "boolean":
      return typeof value === "boolean" ? [] : [`${at} must be a boolean`];
    default:
      return [];
  }
}

/**
 * Legacy configs stored a plaintext `apiKey`; the schema (single source)
 * only allows `apiKeyRef`. Map legacy → ref in place before validation.
 */
function migrateLegacyApiKey(config: SignhifyConfig): SignhifyConfig {
  if (!config || typeof config !== "object" || Array.isArray(config)) return config;
  const agent = config.provider?.agent;
  if (agent) {
    if (agent.apiKey !== undefined && agent.apiKeyRef === undefined) {
      agent.apiKeyRef = agent.apiKey;
    }
    delete agent.apiKey;
  }
  return config;
}

/** Resolve an apiKeyRef: "env:NAME" | "keytar:service:account" | literal key. */
export async function resolveApiKeyRef(ref: string | undefined): Promise<string | undefined> {
  if (ref === undefined) return undefined;
  if (ref.startsWith("env:")) return process.env[ref.slice(4)] || undefined;
  if (ref.startsWith("keytar:")) {
    if (!keytar) {
      throw new Error(`Config references keytar key "${ref}" but keytar is not installed. Install keytar or use an env: reference.`);
    }
    const account = ref.split(":").slice(2).join(":");
    const password = await keytar.getPassword(KEYTAR_SERVICE, account);
    if (!password) throw new Error(`Keychain key not found for service="${KEYTAR_SERVICE}" account="${account}".`);
    return password;
  }
  return ref;
}

export async function loadConfig(projectDir?: string): Promise<SignhifyConfig> {
  const dir = projectDir ?? process.cwd();
  const projectConfigPath = path.join(dir, ".signhify", "config.json");
  const projectConfig = await loadConfigFile(projectConfigPath);
  if (projectConfig) return { ...DEFAULT_CONFIG, ...projectConfig } as SignhifyConfig;

  const globalConfigPath = path.join(os.homedir(), ".config", "signhify", "config.json");
  const globalConfig = await loadConfigFile(globalConfigPath);
  if (globalConfig) return { ...DEFAULT_CONFIG, ...globalConfig } as SignhifyConfig;

  return DEFAULT_CONFIG;
}

async function loadConfigFile(configPath: string): Promise<SignhifyConfig | undefined> {
  let content: string;
  try {
    content = await fs.readFile(configPath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }

  const parsed = migrateLegacyApiKey(JSON.parse(content) as SignhifyConfig);
  await validateConfigBeforeSecretStorage(parsed);
  const secured = await storeKeytarRefs(parsed);
  await signhifyConfigSchema(secured);
  if (JSON.stringify(parsed) !== JSON.stringify(secured)) {
    await writeConfigFile(configPath, secured);
  }
  return resolveAgentApiKey(secured);
}

export async function saveConfig(config: SignhifyConfig, projectDir?: string): Promise<void> {
  migrateLegacyApiKey(config);
  await validateConfigBeforeSecretStorage(config);
  const toSave = await storeKeytarRefs(config);
  await signhifyConfigSchema(toSave);
  const dir = projectDir ?? process.cwd();
  const configDir = path.join(dir, ".signhify");
  await fs.mkdir(configDir, { recursive: true });
  await writeConfigFile(path.join(configDir, "config.json"), toSave);
}

async function writeConfigFile(configPath: string, config: SignhifyConfig): Promise<void> {
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  const tempPath = `${configPath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tempPath, JSON.stringify(config, null, 2), { encoding: "utf-8", flag: "wx", mode: 0o600 });
    await fs.rename(tempPath, configPath);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

async function storeKeytarRefs(config: SignhifyConfig): Promise<SignhifyConfig> {
  const store = async <T extends { model: string; apiKeyRef?: string }>(value: T, account: string): Promise<T> => {
    const ref = value.apiKeyRef;
    if (!ref || ref.startsWith("env:") || ref.startsWith("keytar:")) return value;
    if (!keytar) throw new Error("Cannot save a literal API key because OS keychain support is unavailable. Set apiKeyRef to env:VARIABLE or install keytar.");
    try {
      await keytar.setPassword(KEYTAR_SERVICE, account, ref);
    } catch {
      throw new Error("Could not store the API key in the OS credential store; Signhify did not save the config file.");
    }
    return { ...value, apiKeyRef: `keytar:${KEYTAR_SERVICE}:${account}` };
  };

  const provider = config.provider;
  const agent = await store(provider.agent, provider.agent.model);
  const autocomplete = provider.autocomplete
    ? await store(provider.autocomplete, `autocomplete:${provider.autocomplete.model}`)
    : undefined;
  const fallbackChain = provider.fallbackChain
    ? await Promise.all(provider.fallbackChain.map((endpoint) => store(endpoint, `fallback:${endpoint.name}:${endpoint.model}`)))
    : undefined;
  return {
    ...config,
    provider: {
      ...provider,
      agent,
      ...(autocomplete ? { autocomplete } : {}),
      ...(fallbackChain ? { fallbackChain } : {}),
    },
  };
}

async function resolveAgentApiKey(config: SignhifyConfig): Promise<SignhifyConfig> {
  delete config.provider?.agent?.apiKey;
  const resolved = await resolveApiKeyRef(config.provider?.agent?.apiKeyRef);
  return {
    ...config,
    provider: {
      ...config.provider,
      agent: { ...config.provider.agent, apiKey: resolved },
    },
  };
}

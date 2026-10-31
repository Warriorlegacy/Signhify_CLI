import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import type { SignhifyConfig } from "@signhify/core";
import {
  validateProviderApiKey,
  maskApiKey,
  sanitizeApiKey,
} from "@signhify/providers";

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
  // Schema validation is deferred to loadConfig/saveConfig so that an invalid
  // user config (e.g. bad vendor) doesn't crash the CLI before defaults merge.
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

export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const cleanLine = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const eqIdx = cleanLine.indexOf("=");
    if (eqIdx === -1) continue;
    const key = cleanLine.slice(0, eqIdx).trim();
    let val = cleanLine.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key) {
      result[key] = val;
    }
  }
  return result;
}

export async function loadEnvFile(dir: string): Promise<Record<string, string>> {
  try {
    const envPath = path.join(dir, ".env");
    const content = await fs.readFile(envPath, "utf-8");
    return parseEnvFile(content);
  } catch {
    return {};
  }
}

export function getProviderEnvVarNames(vendor: string): string[] {
  const normalized = vendor.toLowerCase().replace(/[^a-z0-9]/g, "_");
  const upper = normalized.toUpperCase();
  const names: string[] = [
    `SIGNHIFY_${upper}_API_KEY`,
    `${upper}_API_KEY`,
  ];
  if (["google", "gemini"].includes(normalized)) {
    names.push(
      "SIGNHIFY_GOOGLE_API_KEY",
      "GOOGLE_API_KEY",
      "SIGNHIFY_GEMINI_API_KEY",
      "GEMINI_API_KEY",
      "GOOGLE_GENERATIVE_AI_API_KEY",
    );
  } else if (["anthropic", "claude"].includes(normalized)) {
    names.push(
      "SIGNHIFY_ANTHROPIC_API_KEY",
      "ANTHROPIC_API_KEY",
      "SIGNHIFY_CLAUDE_API_KEY",
      "CLAUDE_API_KEY",
    );
  } else if (["openai"].includes(normalized)) {
    names.push("SIGNHIFY_OPENAI_API_KEY", "OPENAI_API_KEY");
  } else if (["groq"].includes(normalized)) {
    names.push("SIGNHIFY_GROQ_API_KEY", "GROQ_API_KEY");
  } else if (["deepseek"].includes(normalized)) {
    names.push("SIGNHIFY_DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY");
  } else if (["openrouter"].includes(normalized)) {
    names.push("SIGNHIFY_OPENROUTER_API_KEY", "OPENROUTER_API_KEY");
  } else if (["mistral"].includes(normalized)) {
    names.push("SIGNHIFY_MISTRAL_API_KEY", "MISTRAL_API_KEY");
  } else if (["xai", "grok"].includes(normalized)) {
    names.push("SIGNHIFY_XAI_API_KEY", "XAI_API_KEY");
  }
  names.push("SIGNHIFY_API_KEY");
  return [...new Set(names)];
}

export interface ResolveApiKeyOptions {
  vendor: string;
  cliApiKey?: string;
  projectDir?: string;
  apiKeyRef?: string;
  env?: Record<string, string | undefined>;
}

/**
 * Resolves an API key according to strict hierarchical precedence:
 * 1. Explicit CLI flag (--api-key or opts.cliApiKey)
 * 2. Workspace .signhify/config.json or .env
 * 3. User global ~/.signhify/config.json (or ~/.config/signhify/config.json)
 * 4. Environment variable: SIGNHIFY_<PROVIDER>_API_KEY, followed by <PROVIDER>_API_KEY
 */
export async function resolveApiKey(
  vendorOrOptions: string | ResolveApiKeyOptions,
  options?: Partial<ResolveApiKeyOptions>,
): Promise<string | undefined> {
  const opts: ResolveApiKeyOptions =
    typeof vendorOrOptions === "string"
      ? { vendor: vendorOrOptions, ...options }
      : { ...vendorOrOptions, ...options };

  const vendor = opts.vendor;
  const projectDir = opts.projectDir ?? process.cwd();
  const envMap = opts.env ?? process.env;

  // 1. Explicit CLI flag (--api-key)
  if (opts.cliApiKey) {
    const sanitized = sanitizeApiKey(opts.cliApiKey);
    if (sanitized) return sanitized;
  }

  // 2. Workspace .signhify/config.json or .env
  const workspaceConfigPath = path.join(projectDir, ".signhify", "config.json");
  const workspaceEnv = await loadEnvFile(projectDir);

  // Check workspace .signhify/config.json
  try {
    const raw = await fs.readFile(workspaceConfigPath, "utf-8");
    const workspaceConfig = JSON.parse(raw) as SignhifyConfig;
    if (workspaceConfig?.provider?.agent) {
      const agent = workspaceConfig.provider.agent;
      if (!agent.vendor || agent.vendor === vendor) {
        const ref = agent.apiKeyRef ?? (agent as { apiKey?: string }).apiKey;
        if (ref) {
          if (ref.startsWith("keytar:")) {
            try {
              const val = await resolveApiKeyRef(ref);
              if (val) return sanitizeApiKey(val);
            } catch {
              // continue
            }
          } else if (ref.startsWith("env:")) {
            const varName = ref.slice(4);
            const fromEnv = workspaceEnv[varName] ?? envMap[varName];
            if (fromEnv) {
              return sanitizeApiKey(fromEnv);
            }
          } else {
            return sanitizeApiKey(ref);
          }
        }
      }
    }
  } catch {
    // workspace config not present
  }

  // If apiKeyRef was explicitly passed from a workspace config
  if (opts.apiKeyRef?.startsWith("env:")) {
    const varName = opts.apiKeyRef.slice(4);
    const fromEnv = workspaceEnv[varName] ?? envMap[varName];
    if (fromEnv) {
      return sanitizeApiKey(fromEnv);
    }
  }

  // Check workspace .env for provider variables
  const providerVars = getProviderEnvVarNames(vendor);
  for (const varName of providerVars) {
    if (workspaceEnv[varName]) {
      const sanitized = sanitizeApiKey(workspaceEnv[varName]);
      if (sanitized) return sanitized;
    }
  }

  // 3. User global ~/.signhify/config.json or ~/.config/signhify/config.json
  const home = os.homedir();
  const globalPaths = [
    path.join(home, ".signhify", "config.json"),
    path.join(home, ".config", "signhify", "config.json"),
  ];

  for (const gPath of globalPaths) {
    try {
      const raw = await fs.readFile(gPath, "utf-8");
      const gConfig = JSON.parse(raw) as SignhifyConfig;
      if (gConfig?.provider?.agent) {
        const agent = gConfig.provider.agent;
        if (!agent.vendor || agent.vendor === vendor) {
          const ref = agent.apiKeyRef ?? (agent as { apiKey?: string }).apiKey;
          if (ref) {
            if (ref.startsWith("keytar:")) {
              try {
                const val = await resolveApiKeyRef(ref);
                if (val) return sanitizeApiKey(val);
              } catch {
                // ignore
              }
            } else if (ref.startsWith("env:")) {
              const varName = ref.slice(4);
              if (envMap[varName]) {
                return sanitizeApiKey(envMap[varName]);
              }
            } else {
              return sanitizeApiKey(ref);
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // 4. Environment variable: SIGNHIFY_<PROVIDER>_API_KEY, followed by <PROVIDER>_API_KEY
  for (const varName of providerVars) {
    if (envMap[varName]) {
      const sanitized = sanitizeApiKey(envMap[varName]);
      if (sanitized) return sanitized;
    }
  }

  if (opts.apiKeyRef?.startsWith("env:")) {
    const varName = opts.apiKeyRef.slice(4);
    if (envMap[varName]) {
      const sanitized = sanitizeApiKey(envMap[varName]);
      if (sanitized) return sanitized;
    }
  } else if (opts.apiKeyRef?.startsWith("keytar:")) {
    try {
      const val = await resolveApiKeyRef(opts.apiKeyRef);
      if (val) return sanitizeApiKey(val);
    } catch {
      // ignore
    }
  } else if (opts.apiKeyRef) {
    return sanitizeApiKey(opts.apiKeyRef);
  }

  return undefined;
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

export interface LoadConfigOptions {
  cliApiKey?: string;
  cliProvider?: string;
  cliModel?: string;
  projectDir?: string;
}

export async function loadConfig(
  projectDirOrOptions?: string | LoadConfigOptions,
  options?: LoadConfigOptions,
): Promise<SignhifyConfig> {
  const opts: LoadConfigOptions =
    typeof projectDirOrOptions === "object" && projectDirOrOptions !== null
      ? projectDirOrOptions
      : options ?? {};
  const dir =
    (typeof projectDirOrOptions === "string" ? projectDirOrOptions : opts.projectDir) ??
    process.cwd();

  const projectConfigPath = path.join(dir, ".signhify", "config.json");
  const projectConfig = await loadConfigFile(projectConfigPath, dir);

  const home = os.homedir();
  const globalConfigPaths = [
    path.join(home, ".signhify", "config.json"),
    path.join(home, ".config", "signhify", "config.json"),
  ];

  let config: SignhifyConfig | undefined;
  if (projectConfig) {
    // Deep-merge provider so user config doesn't drop required sub-fields
    // (e.g. fallbackChain) that exist in DEFAULT_CONFIG.
    config = {
      ...DEFAULT_CONFIG,
      ...projectConfig,
      provider: {
        ...DEFAULT_CONFIG.provider,
        ...(projectConfig.provider ?? {}),
        agent: {
          ...DEFAULT_CONFIG.provider.agent,
          ...(projectConfig.provider?.agent ?? {}),
        },
      },
    } as SignhifyConfig;
  } else {
    for (const gPath of globalConfigPaths) {
      try {
        const loaded = await loadConfigFile(gPath, dir);
        if (loaded) {
          config = {
            ...DEFAULT_CONFIG,
            ...loaded,
            provider: {
              ...DEFAULT_CONFIG.provider,
              ...(loaded.provider ?? {}),
              agent: {
                ...DEFAULT_CONFIG.provider.agent,
                ...(loaded.provider?.agent ?? {}),
              },
            },
          } as SignhifyConfig;
          break;
        }
      } catch {
        // Ignore invalid global config to avoid blocking CLI operations
      }
    }
    if (!config) {
      config = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as SignhifyConfig;
    }
  }

  if (opts.cliProvider) {
    config.provider.agent.vendor = opts.cliProvider;
  }
  if (opts.cliModel) {
    config.provider.agent.model = opts.cliModel;
  }

  // Validate the merged config (defaults + user config + CLI overrides).
  // Strip runtime-resolved apiKey (not a config field) before schema check.
  const agentCopy = { ...config.provider.agent };
  delete agentCopy.apiKey;
  const schemaConfig = {
    ...config,
    provider: { ...config.provider, agent: agentCopy },
  };
  try {
    await signhifyConfigSchema(schemaConfig);
  } catch {
    console.warn("[Signhify] Invalid config detected — falling back to defaults. Run `signhify wizard` to reconfigure.");
    config = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as SignhifyConfig;
    if (opts.cliProvider) {
      config.provider.agent.vendor = opts.cliProvider;
    }
    if (opts.cliModel) {
      config.provider.agent.model = opts.cliModel;
    }
  }

  const vendor = config.provider.agent.vendor;
  const resolvedKey = await resolveApiKey({
    vendor,
    cliApiKey: opts.cliApiKey,
    projectDir: dir,
    apiKeyRef: config.provider.agent.apiKeyRef,
  });

  config.provider.agent.apiKey = resolvedKey;

  // Validate resolved API key
  const isMock =
    process.env.SIGNHIFY_MOCK_PROVIDER === "1" ||
    process.env.SIGNHIFY_MOCK_PROVIDER === "true" ||
    vendor === "mock" ||
    vendor === "test";

  if (!isMock) {
    if (resolvedKey) {
      const validation = validateProviderApiKey(vendor, resolvedKey);
      if (!validation.valid && validation.error?.includes("placeholder")) {
        throw new Error(
          `Placeholder API key detected for provider "${vendor}" ("${maskApiKey(resolvedKey)}"). ` +
          `Please set your actual API key in .signhify/config.json, .env, or run \`signhify configure\`.`
        );
      }
      if (validation.warning && !process.env.VITEST) {
        console.warn(`[Signhify] Key warning for ${vendor}: ${validation.warning}`);
      }
    } else {
      const rawRef = config.provider.agent.apiKeyRef;
      if (rawRef && !rawRef.startsWith("env:") && !rawRef.startsWith("keytar:")) {
        const val = validateProviderApiKey(vendor, rawRef);
        if (!val.valid && val.error?.includes("placeholder")) {
          throw new Error(
            `Placeholder API key detected for provider "${vendor}" ("${maskApiKey(rawRef)}"). ` +
            `Please set your actual API key in .signhify/config.json, .env, or run \`signhify configure\`.`
          );
        }
      }
    }
  }

  return config;
}

function validateNoPlaceholderApiKey(config: SignhifyConfig): void {
  const isMock =
    process.env.SIGNHIFY_MOCK_PROVIDER === "1" ||
    process.env.SIGNHIFY_MOCK_PROVIDER === "true" ||
    config.provider?.agent?.vendor === "mock" ||
    config.provider?.agent?.vendor === "test";
  if (isMock) return;

  const check = (vendor: string | undefined, ref: string | undefined) => {
    if (!ref || !vendor) return;
    if (ref.startsWith("env:") || ref.startsWith("keytar:")) return;
    const val = validateProviderApiKey(vendor, ref);
    if (!val.valid && val.error?.includes("placeholder")) {
      throw new Error(
        `Placeholder API key detected for provider "${vendor}" ("${maskApiKey(ref)}"). ` +
        `Please set your actual API key in .signhify/config.json, .env, or run \`signhify configure\`.`
      );
    }
  };

  if (config.provider?.agent) {
    check(config.provider.agent.vendor, config.provider.agent.apiKeyRef);
  }
  if (config.provider?.autocomplete) {
    check(config.provider.autocomplete.vendor, config.provider.autocomplete.apiKeyRef);
  }
  if (config.provider?.fallbackChain) {
    for (const fb of config.provider.fallbackChain) {
      check(fb.vendor, fb.apiKeyRef);
    }
  }
}

async function loadConfigFile(configPath: string, projectDir?: string): Promise<SignhifyConfig | undefined> {
  let content: string;
  try {
    content = await fs.readFile(configPath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }

  const parsed = migrateLegacyApiKey(JSON.parse(content) as SignhifyConfig);
  validateNoPlaceholderApiKey(parsed);
  await validateConfigBeforeSecretStorage(parsed);
  const secured = await storeKeytarRefs(parsed);
  if (JSON.stringify(parsed) !== JSON.stringify(secured)) {
    await writeConfigFile(configPath, secured);
  }
  return resolveAgentApiKey(secured, projectDir);
}

export async function saveConfig(config: SignhifyConfig, projectDir?: string): Promise<void> {
  migrateLegacyApiKey(config);
  validateNoPlaceholderApiKey(config);
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

async function resolveAgentApiKey(config: SignhifyConfig, projectDir?: string): Promise<SignhifyConfig> {
  delete config.provider?.agent?.apiKey;
  const vendor = config.provider?.agent?.vendor ?? "openai";
  const resolved = await resolveApiKey({
    vendor,
    apiKeyRef: config.provider?.agent?.apiKeyRef,
    projectDir,
  });
  return {
    ...config,
    provider: {
      ...config.provider,
      agent: { ...config.provider.agent, apiKey: resolved },
    },
  };
}

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
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
  },
  memory: { tokenBudget: 4000, checkpointThresholdPct: 80 },
};

export async function signhifyConfigSchema(config: SignhifyConfig): Promise<SignhifyConfig> {
  const errors: string[] = [];

  if (!config.provider) {
    errors.push('Missing "provider" section');
  } else {
    const agent = config.provider.agent;
    if (!agent?.vendor) errors.push('Missing provider.agent.vendor');
    if (!agent?.model) errors.push('Missing provider.agent.model');
    if (agent?.vendor === 'openai-compatible' && !agent?.baseUrl) {
      errors.push('openai-compatible provider requires baseUrl');
    }

    const ac = config.provider.autocomplete;
    if (ac && ac.vendor === 'openai-compatible' && !ac.baseUrl) {
      errors.push('openai-compatible autocomplete provider requires baseUrl');
    }
  }

  if (config.memory) {
    const budget = config.memory.tokenBudget;
    if (budget !== undefined && (budget < 100 || budget > 100000)) {
      errors.push(`memory.tokenBudget must be between 100 and 100000, got ${budget}`);
    }
    const threshold = config.memory.checkpointThresholdPct;
    if (threshold !== undefined && (threshold < 1 || threshold > 99)) {
      errors.push(`memory.checkpointThresholdPct must be between 1 and 99, got ${threshold}`);
    }
  }

  if (config.automation) {
    if (!Array.isArray(config.automation.shellAllowlist)) {
      errors.push('automation.shellAllowlist must be an array');
    }
    if (!Array.isArray(config.automation.shellDenylist)) {
      errors.push('automation.shellDenylist must be an array');
    }
  }

  if (errors.length > 0) {
    throw new Error(`Config validation failed:\n${errors.map(e => `  - ${e}`).join('\n')}`);
  }

  return config;
}

export async function loadConfig(projectDir?: string): Promise<SignhifyConfig> {
  const dir = projectDir ?? process.cwd();
  const projectConfigPath = path.join(dir, ".signhify", "config.json");
  try {
    const content = await fs.readFile(projectConfigPath, "utf-8");
    const parsed = JSON.parse(content) as Partial<SignhifyConfig>;
    await signhifyConfigSchema(parsed as SignhifyConfig);
    return { ...DEFAULT_CONFIG, ...(await resolveKeytarRefs(parsed as SignhifyConfig)) } as SignhifyConfig;
  } catch {
    // no project config or validation failed
  }

  const globalConfigPath = path.join(os.homedir(), ".config", "signhify", "config.json");
  try {
    const content = await fs.readFile(globalConfigPath, "utf-8");
    const parsed = JSON.parse(content) as Partial<SignhifyConfig>;
    await signhifyConfigSchema(parsed as SignhifyConfig);
    return { ...DEFAULT_CONFIG, ...(await resolveKeytarRefs(parsed as SignhifyConfig)) } as SignhifyConfig;
  } catch {
    // no global config or validation failed
  }

  return DEFAULT_CONFIG;
}

export async function saveConfig(config: SignhifyConfig, projectDir?: string): Promise<void> {
  const validated = await signhifyConfigSchema(config);
  const toSave = await storeKeytarRefs(validated);
  const dir = projectDir ?? process.cwd();
  const configDir = path.join(dir, ".signhify");
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(path.join(configDir, "config.json"), JSON.stringify(toSave, null, 2), "utf-8");
}

async function storeKeytarRefs(config: SignhifyConfig): Promise<SignhifyConfig> {
  if (!keytar || !config.provider?.agent?.apiKey) return config;

  const account = config.provider.agent.model;
  const apiKey = config.provider.agent.apiKey;

  try {
    await keytar.setPassword(KEYTAR_SERVICE, account, apiKey);
    return {
      ...config,
      provider: {
        ...config.provider,
        agent: { ...config.provider.agent, apiKey: `keytar:${KEYTAR_SERVICE}:${account}` },
      },
    };
  } catch {
    // keychain write failed — keep plaintext key in config
    return config;
  }
}

async function resolveKeytarRefs(config: SignhifyConfig): Promise<SignhifyConfig> {
  const agentKey = config.provider?.agent?.apiKey;
  if (!agentKey || !agentKey.startsWith("keytar:")) return config;
  if (!keytar) {
    throw new Error(`Config references keytar key "${agentKey}" but keytar is not installed. Install keytar or use a plain API key.`);
  }

  const parts = agentKey.split(":");
  const account = parts.slice(2).join(":");
  const password = await keytar.getPassword(KEYTAR_SERVICE, account);
  if (!password) {
    throw new Error(`Keychain key not found for service="${KEYTAR_SERVICE}" account="${account}". Run the setup wizard to re-enter your API key.`);
  }

  return {
    ...config,
    provider: {
      ...config.provider,
      agent: { ...config.provider.agent, apiKey: password },
    },
  };
}

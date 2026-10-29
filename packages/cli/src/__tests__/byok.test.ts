import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveApiKey, loadConfig } from "../config.js";
import { resolveWizardProvider, validateWizardApiKey, PROVIDER_OPTIONS } from "../wizard.js";
import { maskApiKey } from "@signhify/providers";

let sandbox: string;
beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), "signhify-byok-"));
});
afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function createWorkspace(files: Record<string, string>): string {
  const dir = join(sandbox, `ws-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(dir, ".signhify"), { recursive: true });
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = join(dir, relPath);
    writeFileSync(fullPath, content, "utf-8");
  }
  return dir;
}

describe("BYOK Strict Hierarchical Precedence & Resolution", () => {
  it("Precedence 1: Explicit CLI flag overrides workspace config, .env, and environment variables", async () => {
    const dir = createWorkspace({
      ".signhify/config.json": JSON.stringify({
        provider: {
          agent: {
            vendor: "anthropic",
            model: "claude-3-7-sonnet-latest",
            apiKeyRef: "sk-ant-workspace-key-1234567890",
          },
        },
      }),
      ".env": "ANTHROPIC_API_KEY=sk-ant-dotenv-key-1234567890\n",
    });

    const env = {
      SIGNHIFY_ANTHROPIC_API_KEY: "sk-ant-signhify-env-key-1234567890",
      ANTHROPIC_API_KEY: "sk-ant-plain-env-key-1234567890",
    };

    const key = await resolveApiKey({
      vendor: "anthropic",
      cliApiKey: "sk-ant-cli-override-key-1234567890",
      projectDir: dir,
      env,
    });

    expect(key).toBe("sk-ant-cli-override-key-1234567890");
  });

  it("Precedence 2: Workspace config overrides workspace .env and environment variables", async () => {
    const dir = createWorkspace({
      ".signhify/config.json": JSON.stringify({
        provider: {
          agent: {
            vendor: "openai",
            model: "gpt-4o",
            apiKeyRef: "sk-openai-workspace-key-1234567890",
          },
        },
      }),
      ".env": "OPENAI_API_KEY=sk-openai-dotenv-key-1234567890\n",
    });

    const env = {
      SIGNHIFY_OPENAI_API_KEY: "sk-openai-signhify-env-key-1234567890",
      OPENAI_API_KEY: "sk-openai-plain-env-key-1234567890",
    };

    const key = await resolveApiKey({
      vendor: "openai",
      projectDir: dir,
      env,
    });

    expect(key).toBe("sk-openai-workspace-key-1234567890");
  });

  it("Precedence 2: Workspace .env overrides process environment variables", async () => {
    const dir = createWorkspace({
      ".env": "ANTHROPIC_API_KEY=sk-ant-workspace-dotenv-1234567890\n",
    });

    const env = {
      SIGNHIFY_ANTHROPIC_API_KEY: "sk-ant-signhify-env-key-1234567890",
      ANTHROPIC_API_KEY: "sk-ant-plain-env-key-1234567890",
    };

    const key = await resolveApiKey({
      vendor: "anthropic",
      projectDir: dir,
      env,
    });

    expect(key).toBe("sk-ant-workspace-dotenv-1234567890");
  });

  it("Precedence 4: SIGNHIFY_<PROVIDER>_API_KEY takes precedence over <PROVIDER>_API_KEY", async () => {
    const dir = createWorkspace({});

    const env = {
      SIGNHIFY_ANTHROPIC_API_KEY: "sk-ant-signhify-specific-1234567890",
      ANTHROPIC_API_KEY: "sk-ant-generic-env-1234567890",
    };

    const key = await resolveApiKey({
      vendor: "anthropic",
      projectDir: dir,
      env,
    });

    expect(key).toBe("sk-ant-signhify-specific-1234567890");
  });

  it("Precedence 4: Fallbacks to generic <PROVIDER>_API_KEY if SIGNHIFY prefix is absent", async () => {
    const dir = createWorkspace({});

    const env = {
      GEMINI_API_KEY: "AIzaSy-gemini-generic-env-1234567890",
    };

    const key = await resolveApiKey({
      vendor: "google",
      projectDir: dir,
      env,
    });

    expect(key).toBe("AIzaSy-gemini-generic-env-1234567890");
  });
});

describe("Placeholder Rejection in Config Resolution", () => {
  it("rejects placeholder key sk-... with actionable guidance", async () => {
    const dir = createWorkspace({
      ".signhify/config.json": JSON.stringify({
        provider: {
          agent: {
            vendor: "anthropic",
            model: "claude-3-7-sonnet-latest",
            apiKeyRef: "sk-...",
          },
        },
      }),
    });

    await expect(loadConfig(dir)).rejects.toThrow(/Placeholder API key detected for provider "anthropic"/);
  });

  it("rejects placeholder your-api-key with actionable guidance", async () => {
    const dir = createWorkspace({
      ".signhify/config.json": JSON.stringify({
        provider: {
          agent: {
            vendor: "openai",
            model: "gpt-4o",
            apiKeyRef: "your-api-key-here",
          },
        },
      }),
    });

    await expect(loadConfig(dir)).rejects.toThrow(/Please set your actual API key in \.signhify\/config\.json, \.env, or run `signhify configure`/);
  });

  it("masks the placeholder in the rejection error message", async () => {
    const dir = createWorkspace({
      ".signhify/config.json": JSON.stringify({
        provider: {
          agent: {
            vendor: "groq",
            model: "llama-3.3-70b-versatile",
            apiKeyRef: "gsk_dummy_placeholder_key_value",
          },
        },
      }),
    });

    await expect(loadConfig(dir)).rejects.toThrow(/gsk_/);
  });
});

describe("Wizard Live Validation & Expanded Provider List", () => {
  it("provides 8 expanded provider choices including Ollama and OpenAI-Compatible", () => {
    const ids = PROVIDER_OPTIONS.map((p) => p.id);
    expect(ids).toContain("anthropic");
    expect(ids).toContain("openai");
    expect(ids).toContain("google");
    expect(ids).toContain("groq");
    expect(ids).toContain("deepseek");
    expect(ids).toContain("openrouter");
    expect(ids).toContain("ollama");
    expect(ids).toContain("openai-compatible");
  });

  it("resolves providers by numeric index and alias", () => {
    expect(resolveWizardProvider("1")?.id).toBe("anthropic");
    expect(resolveWizardProvider("2")?.id).toBe("openai");
    expect(resolveWizardProvider("3")?.id).toBe("google");
    expect(resolveWizardProvider("gemini")?.id).toBe("google");
    expect(resolveWizardProvider("claude")?.id).toBe("anthropic");
    expect(resolveWizardProvider("7")?.id).toBe("ollama");
    expect(resolveWizardProvider("8")?.id).toBe("openai-compatible");
  });

  it("validates live API key format and rejects placeholders", () => {
    const check1 = validateWizardApiKey("anthropic", "sk-...");
    expect(check1.valid).toBe(false);
    expect(check1.error).toMatch(/placeholder/i);
    expect(check1.error).toMatch(/sk-ant-/);

    const check2 = validateWizardApiKey("openai", "your-api-key");
    expect(check2.valid).toBe(false);
    expect(check2.error).toMatch(/placeholder/i);

    const check3 = validateWizardApiKey("anthropic", "sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890");
    expect(check3.valid).toBe(true);

    // Ollama does not require an API key
    const checkOllama = validateWizardApiKey("ollama", "");
    expect(checkOllama.valid).toBe(true);

    // env: references are accepted
    const checkEnv = validateWizardApiKey("anthropic", "env:ANTHROPIC_API_KEY");
    expect(checkEnv.valid).toBe(true);
  });
});

describe("Masking Utilities", () => {
  it("safely masks long API keys while exposing first 4 and last 4 characters or sk-... prefix", () => {
    const masked = maskApiKey("sk-ant-api03-1234567890abcdef");
    expect(masked).toBe("sk-...cdef");

    const nonSkMasked = maskApiKey("AIzaSy-gemini-key-1234567890abcdef");
    expect(nonSkMasked.startsWith("AIza")).toBe(true);
    expect(nonSkMasked.endsWith("cdef")).toBe(true);
    expect(nonSkMasked).toContain("...");
  });

  it("masks short keys completely without leaking content", () => {
    expect(maskApiKey("short")).toBe("***");
    expect(maskApiKey(undefined)).toBe("<none>");
  });
});

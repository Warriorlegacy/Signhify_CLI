import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadConfig,
  saveConfig,
  signhifyConfigSchema,
  resolveApiKeyRef,
} from "../config.js";

let sandbox: string;
beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), "signhify-config-"));
});
afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function writeProjectConfig(json: string): string {
  const dir = join(sandbox, `cfg-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(dir, ".signhify"), { recursive: true });
  writeFileSync(join(dir, ".signhify", "config.json"), json, "utf-8");
  return dir;
}

const validAgent = { vendor: "mock", model: "mock-model" };

describe("config: single schema source (T2.3) + /context-limit persistence (T2.2)", () => {
  it("apiKeyRef env: config validates and resolves from environment", async () => {
    process.env.SIGNHIFY_TEST_REF = "env-ref-value";
    try {
      const dir = writeProjectConfig(
        JSON.stringify({ provider: { agent: { ...validAgent, apiKeyRef: "env:SIGNHIFY_TEST_REF" } } }),
      );
      const cfg = await loadConfig(dir);
      expect(cfg.provider.agent.apiKeyRef).toBe("env:SIGNHIFY_TEST_REF");
      expect(cfg.provider.agent.apiKey).toBe("env-ref-value");
    } finally {
      delete process.env.SIGNHIFY_TEST_REF;
    }
  });

  it("migrates legacy plaintext apiKey securely or fails closed without keychain support", async () => {
    const dir = writeProjectConfig(
      JSON.stringify({ provider: { agent: { ...validAgent, apiKey: "sk-legacy" } } }),
    );
    let cfg: Awaited<ReturnType<typeof loadConfig>>;
    try {
      cfg = await loadConfig(dir);
    } catch (error) {
      expect(String(error)).toMatch(/keychain support is unavailable|could not store the API key/i);
      return;
    }
    expect(cfg.provider.agent.apiKeyRef).toMatch(/^keytar:signhify:/);
    expect(cfg.provider.agent.apiKey).toBe("sk-legacy");

    // And a round-trip persists only the OS keychain reference.
    const outDir = join(sandbox, "out");
    await saveConfig(cfg, outDir);
    const persisted = readFileSync(join(outDir, ".signhify", "config.json"), "utf-8");
    expect(persisted).toContain('"apiKeyRef": "keytar:signhify:');
    expect(persisted).not.toContain('"apiKey"');
  });

  it("invalid value rejected with the schema wording (T2.2 rejection path)", async () => {
    // contextLimit below the schema floor of 1000
    await expect(
      signhifyConfigSchema({
        provider: { agent: validAgent, fallbackChain: [] },
        memory: { contextLimit: 640 },
      } as never),
    ).rejects.toThrow(/must be >= 1000/);
  });

  it("validates an unknown vendor against the schema enum", async () => {
    await expect(
      signhifyConfigSchema({
        provider: { agent: { ...validAgent, vendor: "definitely-not-a-vendor" } },
      } as never),
    ).rejects.toThrow(/must be one of/);
  });

  it("saveConfig persists contextLimit: 64000 (T2.2 sets-and-persists contract)", async () => {
    const outDir = join(sandbox, "limit");
    await saveConfig(
      {
        provider: { agent: validAgent, fallbackChain: [] },
        memory: { contextLimit: 64000 },
      } as never,
      outDir,
    );
    const persisted = JSON.parse(
      readFileSync(join(outDir, ".signhify", "config.json"), "utf-8"),
    ) as { memory?: { contextLimit?: number } };
    expect(persisted.memory?.contextLimit).toBe(64000);
  });

  it("resolveApiKeyRef covers env:, literal, and undefined", async () => {
    expect(await resolveApiKeyRef(undefined)).toBeUndefined();
    expect(await resolveApiKeyRef("sk-literal")).toBe("sk-literal");
    process.env.SIGNHIFY_TEST_REF2 = "xyz";
    expect(await resolveApiKeyRef("env:SIGNHIFY_TEST_REF2")).toBe("xyz");
    delete process.env.SIGNHIFY_TEST_REF2;
    expect(await resolveApiKeyRef("env:DEFINITELY_NOT_SET_9")).toBeUndefined();
  });
});

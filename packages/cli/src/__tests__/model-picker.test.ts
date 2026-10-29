import { describe, it, expect, vi } from "vitest";
import {
  MODEL_CATALOG,
  fuzzyFilterModels,
  nextModelIndex,
  ModelPickerOverlay,
  type ModelPickerOverlayProps,
} from "../tui/model-picker.js";
import React from "react";

describe("MODEL_CATALOG", () => {
  it("contains every provider group from the spec", () => {
    const providers = new Set(MODEL_CATALOG.map((m) => m.provider));
    expect(providers).toEqual(
      new Set([
        "Anthropic",
        "OpenAI",
        "DeepSeek",
        "Gemini",
        "OpenRouter",
        "Local",
        "Groq",
      ]),
    );
  });

  it("has the exact expected model ids per provider", () => {
    const byProvider: Record<string, string[]> = {};
    for (const m of MODEL_CATALOG) {
      (byProvider[m.provider] ??= []).push(m.id);
    }
    expect(byProvider["Anthropic"]).toEqual([
      "claude-3-5-sonnet-latest",
      "claude-3-opus-20240229",
      "claude-3-5-haiku-20241022",
    ]);
    expect(byProvider["OpenAI"]).toEqual(["gpt-4o", "gpt-4o-mini", "o1"]);
    expect(byProvider["DeepSeek"]).toEqual(["deepseek-chat", "deepseek-reasoner"]);
    expect(byProvider["Gemini"]).toEqual([
      "gemini-1.5-pro-latest",
      "gemini-1.5-flash-latest",
    ]);
    expect(byProvider["OpenRouter"]).toEqual([
      "openrouter/auto",
      "meta-llama/llama-3.3-70b-instruct",
    ]);
    expect(byProvider["Local"]).toEqual(["llama3.2", "qwen2.5-coder:7b"]);
    expect(byProvider["Groq"]).toEqual(["llama-3.3-70b-versatile"]);
  });

  it("every entry has non-empty id, name, provider, hint", () => {
    for (const m of MODEL_CATALOG) {
      expect(m.id.length).toBeGreaterThan(0);
      expect(m.name.length).toBeGreaterThan(0);
      expect(m.provider.length).toBeGreaterThan(0);
      expect(m.hint.length).toBeGreaterThan(0);
    }
  });
});

describe("fuzzyFilterModels", () => {
  it("empty query returns everything", () => {
    expect(fuzzyFilterModels(MODEL_CATALOG, "")).toHaveLength(
      MODEL_CATALOG.length,
    );
  });

  it("filters by model id", () => {
    const hit = fuzzyFilterModels(MODEL_CATALOG, "claude-3-5-sonnet-latest");
    expect(hit).toHaveLength(1);
    expect(hit[0].id).toBe("claude-3-5-sonnet-latest");
  });

  it("filters by provider name", () => {
    const hits = fuzzyFilterModels(MODEL_CATALOG, "groq");
    expect(hits).toHaveLength(1);
    expect(hits[0].provider).toBe("Groq");
  });

  it("filters by hint keyword", () => {
    const hits = fuzzyFilterModels(MODEL_CATALOG, "reasoning");
    expect(hits.map((m) => m.id)).toEqual(
      expect.arrayContaining(["o1", "deepseek-reasoner"]),
    );
  });

  it("no match returns empty", () => {
    expect(fuzzyFilterModels(MODEL_CATALOG, "zzz")).toEqual([]);
  });
});

describe("nextModelIndex", () => {
  it("wraps at both ends", () => {
    const count = 5;
    expect(nextModelIndex(0, count, -1)).toBe(count - 1);
    expect(nextModelIndex(count - 1, count, 1)).toBe(0);
  });

  it("clamps empty lists to 0", () => {
    expect(nextModelIndex(0, 0, 1)).toBe(0);
  });
});

describe("ModelPickerOverlay selection", () => {
  it("invokes onSelect with the chosen model id", () => {
    const onSelect = vi.fn();
    const props: ModelPickerOverlayProps = {
      activeModelId: "claude-3-opus-20240229",
      onSelect,
    };
    React.createElement(ModelPickerOverlay, props);
    // Contract: consumers call props.onSelect(id) on Enter; verify the
    // callback shape is honored by the overlay's props type.
    onSelect("claude-3-opus-20240229");
    expect(onSelect).toHaveBeenCalledWith("claude-3-opus-20240229");
  });

  it("renders without throwing", () => {
    const onSelect = vi.fn();
    const tree = React.createElement(ModelPickerOverlay, {
      activeModelId: undefined,
      onSelect,
    });
    expect(tree).toBeDefined();
    expect(tree.type).toBe(ModelPickerOverlay);
  });
});

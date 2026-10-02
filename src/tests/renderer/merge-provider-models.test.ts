import { describe, expect, it } from "vitest";
import { mergeProviderModels } from "../../renderer/utils/merge-provider-models";

const catalog = [
  { id: "claude-haiku-4-5", name: "claude-haiku-4-5" },
  { id: "claude-opus-4-6", name: "claude-opus-4-6" },
  { id: "claude-sonnet-4-6", name: "claude-sonnet-4-6" },
];

const base = {
  catalog,
  live: null,
  saved: [],
  disabled: [],
  defaultModel: "claude-haiku-4-5",
  modelSource: "preset" as const,
};

describe("mergeProviderModels", () => {
  it("returns the catalogue when nothing was fetched", () => {
    const result = mergeProviderModels(base);
    expect(result.rows.map((r) => r.id)).toEqual([
      "claude-haiku-4-5",
      "claude-opus-4-6",
      "claude-sonnet-4-6",
    ]);
    expect(result.rows.every((r) => r.enabled)).toBe(true);
    expect(result.rows.every((r) => r.isNew)).toBe(false);
    expect(result.defaultModel).toBe("claude-haiku-4-5");
  });

  it("appends endpoint-only models at the end and flags them as new", () => {
    const result = mergeProviderModels({
      ...base,
      live: [
        { id: "claude-sonnet-4-6", name: "claude-sonnet-4-6" },
        { id: "claude-opus-5", name: "claude-opus-5" },
      ],
    });
    expect(result.rows.map((r) => r.id)).toEqual([
      "claude-haiku-4-5",
      "claude-opus-4-6",
      "claude-sonnet-4-6",
      "claude-opus-5",
    ]);
    expect(result.rows.find((r) => r.id === "claude-opus-5")?.isNew).toBe(true);
    expect(result.enabled.map((m) => m.id)).toContain("claude-opus-5");
  });

  it("keeps models the endpoint no longer returns", () => {
    const result = mergeProviderModels({
      ...base,
      saved: [
        { id: "claude-legacy-3", label: "claude-legacy-3", source: "preset" },
      ],
    });
    const row = result.rows.find((r) => r.id === "claude-legacy-3");
    expect(row?.enabled).toBe(true);
    expect(row?.isNew).toBe(false);
  });

  it("honours disabled models and cleans up stale ones", () => {
    const result = mergeProviderModels({
      ...base,
      live: [{ id: "claude-sonnet-4-6", name: "claude-sonnet-4-6" }],
      disabled: ["claude-opus-4-6", "claude-long-gone"],
    });
    expect(result.rows.find((r) => r.id === "claude-opus-4-6")?.enabled).toBe(
      false,
    );
    expect(result.enabled.map((m) => m.id)).toEqual([
      "claude-haiku-4-5",
      "claude-sonnet-4-6",
    ]);
    expect(result.disabled).toEqual(["claude-opus-4-6"]);
  });

  it("re-picks the default when the current one is disabled", () => {
    const result = mergeProviderModels({
      ...base,
      defaultModel: "claude-opus-4-6",
      disabled: ["claude-opus-4-6"],
    });
    expect(result.defaultModel).toBe("claude-haiku-4-5");
    expect(result.rows.filter((r) => r.isDefault).map((r) => r.id)).toEqual([
      "claude-haiku-4-5",
    ]);
  });

  it("keeps the catalogue when the live list is empty", () => {
    const result = mergeProviderModels({ ...base, live: [] });
    expect(result.rows.map((r) => r.id)).toEqual(catalog.map((c) => c.id));
  });

  it("maps metadata and source for custom providers", () => {
    const result = mergeProviderModels({
      catalog: [],
      live: [
        {
          id: "qwen-max",
          name: "Qwen Max",
          contextWindow: 32000,
          input: ["text", "image"],
        },
      ],
      saved: [],
      disabled: [],
      defaultModel: "",
      modelSource: "custom",
    });
    expect(result.rows[0]).toMatchObject({
      id: "qwen-max",
      label: "Qwen Max",
      contextWindow: 32000,
      input: ["text", "image"],
      enabled: true,
      isDefault: true,
    });
    expect(result.enabled[0]).toMatchObject({
      id: "qwen-max",
      label: "Qwen Max",
      source: "custom",
      contextWindow: 32000,
    });
  });
});

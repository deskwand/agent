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

describe("mergeProviderModels keeps user overrides", () => {
  it("prefers a saved context window over the value the endpoint reports", () => {
    const result = mergeProviderModels({
      catalog: [],
      live: [{ id: "qwen-max", name: "Qwen Max", contextWindow: 131072 }],
      saved: [
        {
          id: "qwen-max",
          label: "Qwen Max",
          source: "custom",
          contextWindow: 200000,
          contextWindowPinned: true,
        },
      ],
      disabled: [],
      defaultModel: "qwen-max",
      modelSource: "custom",
    });
    expect(result.rows[0]?.contextWindow).toBe(200000);
    expect(result.rows[0]?.contextWindowPinned).toBe(true);
    expect(result.enabled[0]?.contextWindow).toBe(200000);
    expect(result.enabled[0]?.contextWindowPinned).toBe(true);
  });

  it("prefers a saved image capability over the endpoint metadata", () => {
    const result = mergeProviderModels({
      catalog: [],
      live: [{ id: "qwen-max", name: "Qwen Max", input: ["text"] }],
      saved: [
        {
          id: "qwen-max",
          label: "Qwen Max",
          source: "custom",
          input: ["text", "image"],
          inputPinned: true,
        },
      ],
      disabled: [],
      defaultModel: "qwen-max",
      modelSource: "custom",
    });
    expect(result.rows[0]?.input).toEqual(["text", "image"]);
    expect(result.enabled[0]?.inputPinned).toBe(true);
  });

  it("still refreshes an unpinned preset row from the catalogue", () => {
    const result = mergeProviderModels({
      ...base,
      saved: [
        {
          id: "claude-sonnet-4-6",
          label: "claude-sonnet-4-6",
          source: "preset",
          contextWindow: 512000,
        },
      ],
    });
    // 目录行沿用已保存值（历史行为），但钉住标记不会被凭空补上
    const row = result.rows.find((r) => r.id === "claude-sonnet-4-6");
    expect(row?.contextWindow).toBe(512000);
    expect(row?.contextWindowPinned).toBeUndefined();
  });
});

describe("mergeProviderModels treats a non-empty live list as authoritative", () => {
  it("drops saved models the endpoint no longer returns", () => {
    const result = mergeProviderModels({
      catalog: [],
      live: [{ id: "glm-5.2", name: "GLM-5.2", contextWindow: 1000000 }],
      saved: [
        {
          id: "glm-5.2",
          label: "GLM-5.2",
          source: "custom",
          contextWindow: 1000000,
        },
        {
          id: "glm-5.0",
          label: "GLM-5.0",
          source: "custom",
          contextWindow: 128000,
        },
      ],
      disabled: ["glm-5.0"],
      defaultModel: "glm-5.0",
      modelSource: "custom",
      dropMissingModels: true,
    });

    expect(result.rows.map((row) => row.id)).toEqual(["glm-5.2"]);
    expect(result.enabled.map((model) => model.id)).toEqual(["glm-5.2"]);
    // 被删模型的 disabled 记录一并清掉，默认模型回落到仍在的行
    expect(result.disabled).toEqual([]);
    expect(result.defaultModel).toBe("glm-5.2");
  });

  it("refreshes unpinned metadata from the endpoint", () => {
    const result = mergeProviderModels({
      catalog: [],
      live: [
        {
          id: "glm-5.2",
          name: "GLM-5.2",
          contextWindow: 1000000,
          maxTokens: 131072,
          input: ["text"],
        },
      ],
      saved: [
        {
          id: "glm-5.2",
          label: "glm-5.2",
          source: "custom",
          contextWindow: 272000,
        },
      ],
      disabled: [],
      defaultModel: "glm-5.2",
      modelSource: "custom",
    });

    expect(result.rows[0]).toMatchObject({
      id: "glm-5.2",
      label: "GLM-5.2",
      contextWindow: 1000000,
      maxTokens: 131072,
      input: ["text"],
    });
  });

  it("keeps the saved list when the endpoint could not be read", () => {
    const result = mergeProviderModels({
      catalog: [],
      live: null,
      saved: [
        {
          id: "glm-5.2",
          label: "GLM-5.2",
          source: "custom",
          contextWindow: 272000,
        },
      ],
      disabled: [],
      defaultModel: "glm-5.2",
      modelSource: "custom",
    });

    expect(result.rows.map((row) => row.id)).toEqual(["glm-5.2"]);
    expect(result.rows[0]?.contextWindow).toBe(272000);
  });

  it("keeps the saved list when the live list is empty", () => {
    const result = mergeProviderModels({
      catalog: [],
      live: [],
      saved: [{ id: "glm-5.2", label: "GLM-5.2", source: "custom" }],
      disabled: [],
      defaultModel: "glm-5.2",
      modelSource: "custom",
    });

    expect(result.rows.map((row) => row.id)).toEqual(["glm-5.2"]);
  });
});

describe("mergeProviderModels only drops missing rows on an explicit reconnect", () => {
  it("keeps rows the endpoint omitted when dropMissingModels is not set", () => {
    const result = mergeProviderModels({
      catalog: [],
      live: [{ id: "glm-5.2", name: "GLM-5.2", contextWindow: 1000000 }],
      saved: [
        {
          id: "glm-5.2",
          label: "glm-5.2",
          source: "custom",
          contextWindow: 272000,
        },
        // 用户手填、端点在 /models 里没列出的别名
        { id: "glm-5-alias", label: "glm-5-alias", source: "custom" },
      ],
      disabled: [],
      defaultModel: "glm-5.2",
      modelSource: "custom",
    });

    expect(result.rows.map((row) => row.id)).toEqual([
      "glm-5.2",
      "glm-5-alias",
    ]);
    // 元数据仍然会被刷新
    expect(result.rows[0]?.contextWindow).toBe(1000000);
  });
});

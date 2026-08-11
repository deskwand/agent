import { describe, expect, it } from "vitest";
import { modelDisplay } from "../src/renderer/utils/subagent-model-display";

const providers = {
  "custom:openai": {
    name: "本地DeepSeek代理",
    models: [{ id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" }],
  },
  deepseek: {
    name: "DeepSeek 官方",
    models: [{ id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" }],
  },
};

describe("modelDisplay with deskwand prefix", () => {
  it("strips deskwand prefix before provider lookup", () => {
    expect(
      modelDisplay("deskwand:custom:openai/deepseek-v4-flash", providers),
    ).toBe("本地DeepSeek代理 / DeepSeek V4 Flash");
  });

  it("still works for unprefixed specs", () => {
    expect(modelDisplay("custom:openai/deepseek-v4-flash", providers)).toBe(
      "本地DeepSeek代理 / DeepSeek V4 Flash",
    );
  });

  it("falls back to raw key and model id when provider unknown", () => {
    expect(modelDisplay("deskwand:nope/deepseek-v4-flash", providers)).toBe(
      "nope / deepseek-v4-flash",
    );
  });

  it("returns raw string when no slash", () => {
    expect(modelDisplay("deepseek-v4-flash", providers)).toBe(
      "deepseek-v4-flash",
    );
  });
});

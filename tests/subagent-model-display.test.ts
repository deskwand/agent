import { describe, expect, it } from "vitest";
import { modelDisplay } from "../src/renderer/utils/subagent-model-display";

// 只认云 provider 的 key，其余原样返回，用来确认走的是哪条分支
const t = (key: string) =>
  key === "providers.deskwandCloud" ? "DeskWand Cloud" : key;

const providers = {
  "custom:openai": {
    name: "本地DeepSeek代理",
    models: [{ id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" }],
  },
  deepseek: {
    name: "DeepSeek 官方",
    models: [{ id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" }],
  },
  "custom:deskwand": {
    // 配置里存的是登录当时语言写下的名字
    name: "DeskWand 云",
    models: [{ id: "deepseek-flash", label: "deepseek-flash" }],
  },
};

describe("modelDisplay with deskwand prefix", () => {
  it("strips deskwand prefix before provider lookup", () => {
    expect(
      modelDisplay("deskwand:custom:openai/deepseek-v4-flash", providers, t),
    ).toBe("本地DeepSeek代理 / DeepSeek V4 Flash");
  });

  it("localizes the cloud provider name instead of the stored one", () => {
    expect(
      modelDisplay("deskwand:custom:deskwand/deepseek-flash", providers, t),
    ).toBe("DeskWand Cloud / deepseek-flash");
    // 非云 provider 仍然用配置里存的名字（用户自己填的）
    expect(
      modelDisplay("deskwand:custom:openai/deepseek-v4-flash", providers, t),
    ).toBe("本地DeepSeek代理 / DeepSeek V4 Flash");
  });

  it("still works for unprefixed specs", () => {
    expect(modelDisplay("custom:openai/deepseek-v4-flash", providers, t)).toBe(
      "本地DeepSeek代理 / DeepSeek V4 Flash",
    );
  });

  it("falls back to raw key and model id when provider unknown", () => {
    expect(modelDisplay("deskwand:nope/deepseek-v4-flash", providers, t)).toBe(
      "nope / deepseek-v4-flash",
    );
  });

  it("returns raw string when no slash", () => {
    expect(modelDisplay("deepseek-v4-flash", providers, t)).toBe(
      "deepseek-v4-flash",
    );
  });
});

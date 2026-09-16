import { describe, it, expect } from "vitest";
import fs from "node:fs";
import {
  resolveModelLabel,
  resolveProviderDisplayName,
} from "../src/renderer/utils/model-label";
import type { ModelOptionGroup } from "../src/renderer/components/ChatInputBottomBar";

function group(
  profileKey: string,
  items: Array<{ id: string; name: string }>,
): ModelOptionGroup {
  return { profileKey, groupLabel: profileKey, items };
}

describe("resolveModelLabel", () => {
  const options: ModelOptionGroup[] = [
    group("custom:deskwand", [
      { id: "deepseek-flash", name: "deepseek-flash" },
      { id: "deepseek-v4-pro", name: "deepseek-v4-pro" },
    ]),
    group("custom:openai", [{ id: "deepseek-flash", name: "deepseek-flash" }]),
  ];

  it("returns the real model id for deskwand cloud models", () => {
    expect(
      resolveModelLabel(options, "custom:deskwand", "deepseek-flash"),
    ).toBe("deepseek-flash");
    expect(
      resolveModelLabel(options, "custom:deskwand", "deepseek-v4-pro"),
    ).toBe("deepseek-v4-pro");
  });

  it("does not leak labels across providers with the same model id", () => {
    // custom:openai 分组的同名模型 label 是 id 本身
    expect(resolveModelLabel(options, "custom:openai", "deepseek-flash")).toBe(
      "deepseek-flash",
    );
  });

  it("falls back to model id when not found", () => {
    expect(resolveModelLabel(options, "custom:deskwand", "unknown-model")).toBe(
      "unknown-model",
    );
    expect(resolveModelLabel(options, "nonexistent", "deepseek-flash")).toBe(
      "deepseek-flash",
    );
  });

  it("falls back to empty string when model is empty", () => {
    expect(resolveModelLabel(options, "custom:deskwand", "")).toBe("");
  });
});

describe("resolveProviderDisplayName", () => {
  // 只认云 provider 的 key，其余 key 原样返回，用来确认走的是哪条分支
  const t = (key: string) =>
    key === "providers.deskwandCloud" ? "DeskWand Cloud" : key;

  it("localizes the cloud label live instead of the stored name", () => {
    // 配置里存的是登录当时语言写下的字符串（旧值）
    expect(
      resolveProviderDisplayName("custom:deskwand", "DeskWand 云", t),
    ).toBe("DeskWand Cloud");
  });

  it("keeps the stored name for other providers", () => {
    // 自定义 provider 的名字是用户自己填的，必须原样保留
    expect(resolveProviderDisplayName("custom:openai", "我的中转", t)).toBe(
      "我的中转",
    );
  });

  it("returns undefined when there is no stored name so callers keep their fallback", () => {
    expect(
      resolveProviderDisplayName("openrouter", undefined, t),
    ).toBeUndefined();
    expect(resolveProviderDisplayName("openrouter", "", t)).toBe("");
  });

  it("defines the cloud label in both locales", () => {
    // key 缺失时 i18next 会退回 defaultValue（中文），英文界面会看到中文
    for (const locale of ["zh", "en"]) {
      const json = JSON.parse(
        fs.readFileSync(`src/renderer/i18n/locales/${locale}.json`, "utf8"),
      );
      expect(typeof json.providers?.deskwandCloud).toBe("string");
    }
  });
});

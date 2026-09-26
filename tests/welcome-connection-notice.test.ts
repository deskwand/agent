import { describe, expect, it } from "vitest";
import { connectionNoticeValues } from "../src/renderer/components/welcome/connection-notice";
import type { AppConfig } from "../src/renderer/types";

const config = (over: Partial<AppConfig>): AppConfig =>
  ({
    provider: "custom",
    customProtocol: "openai",
    model: "",
    activeProviderKey: "openrouter",
    profiles: {},
    providers: {},
    ...over,
  }) as AppConfig;

const provider = (defaultModel: string, name?: string) => ({
  provider: "custom" as const,
  customProtocol: "openai" as const,
  apiKey: "k",
  baseUrl: "",
  defaultModel,
  models: [],
  updatedAt: "2026-09-25T00:00:00.000Z",
  ...(name ? { name } : {}),
});

describe("connectionNoticeValues", () => {
  it("stays silent while activeProviderKey still points at the previous default", () => {
    // fresh install 的第一个快照：保存了 oauth provider，但 activeProviderKey 还是
    // "openrouter"，providers 里根本没有 openrouter —— 此时提示会写成
    // 「已连接 openrouter · 」，所以要等。
    expect(
      connectionNoticeValues(
        config({
          activeProviderKey: "openrouter",
          providers: { "oauth:anthropic": provider("claude-opus-4-5") },
        }),
      ),
    ).toBeNull();
  });

  it("stays silent when the active provider has no model yet", () => {
    expect(
      connectionNoticeValues(
        config({
          activeProviderKey: "oauth:anthropic",
          providers: { "oauth:anthropic": provider("") },
        }),
      ),
    ).toBeNull();
  });

  it("stays silent before config has loaded", () => {
    expect(connectionNoticeValues(null)).toBeNull();
  });

  it("reports the provider name and model once the active provider is ready", () => {
    expect(
      connectionNoticeValues(
        config({
          activeProviderKey: "oauth:anthropic",
          providers: {
            "oauth:anthropic": provider("claude-opus-4-5", "Anthropic"),
          },
        }),
      ),
    ).toEqual({ provider: "Anthropic", model: "claude-opus-4-5" });
  });

  it("falls back to the profile key when the provider has no name", () => {
    expect(
      connectionNoticeValues(
        config({
          activeProviderKey: "oauth:anthropic",
          providers: { "oauth:anthropic": provider("claude-opus-4-5") },
        }),
      ),
    ).toEqual({ provider: "oauth:anthropic", model: "claude-opus-4-5" });
  });
});

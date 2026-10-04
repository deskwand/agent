// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../renderer/i18n/config";
import {
  ConfiguredProviderList,
  oauthProviderIdForProfile,
  rowBrand,
} from "../../renderer/components/settings/configured-provider-list";
import type { ApiProviderConfig } from "../../renderer/types";
import { API_PROVIDER_PRESETS } from "../../shared/api-model-presets";

const openrouterConfig: ApiProviderConfig = {
  provider: "openrouter",
  customProtocol: "anthropic",
  name: "",
  apiKey: "sk-or-v1-test",
  baseUrl: "https://openrouter.ai/api/v1",
  defaultModel: "openrouter/free",
  models: [
    { id: "openrouter/free", label: "Free", source: "preset" },
    { id: "openrouter/paid", label: "Paid", source: "preset" },
  ],
  updatedAt: "2024-01-01T00:00:00.000Z",
};

describe("ConfiguredProviderList", () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = (
    props: Partial<React.ComponentProps<typeof ConfiguredProviderList>> = {},
  ) => {
    container = document.createElement("div");
    document.body.innerHTML = "";
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        React.createElement(ConfiguredProviderList, {
          rows: [{ profileKey: "openrouter", config: openrouterConfig }],
          presets: API_PROVIDER_PRESETS,
          oauthStatuses: {},
          onEdit: vi.fn(),
          onDelete: vi.fn(),
          onDisconnect: vi.fn(),
          ...props,
        }),
      );
    });
  };

  afterEach(() => {
    if (root) act(() => root.unmount());
  });

  it("副文案给出 host 与模型数", () => {
    render();
    expect(container.textContent).toContain("openrouter.ai");
    expect(container.textContent).toContain("2 models");
  });

  it("OAuth 已登录的行给出已登录文案，且不重复 provider 名", () => {
    render({
      oauthStatuses: {
        openrouter: { loggedIn: true, providerName: "OpenRouter" },
      },
    });
    expect(container.textContent).toContain("Signed in");
    // 标题已经是 provider 名，副文案里不再重复一遍
    expect(container.textContent?.match(/OpenRouter/g)?.length).toBe(1);
    expect(
      container.querySelector('[data-testid="openrouter-oauth-disconnect"]'),
    ).not.toBeNull();
  });

  it("oauth profile 的 name 为空时，标题回退到目录里的 provider 名", () => {
    render({
      rows: [
        {
          profileKey: "oauth:openai-codex",
          config: {
            ...openrouterConfig,
            provider: "oauth",
            name: "",
            baseUrl: "",
            apiKey: "",
          },
        },
      ],
    });
    expect(container.textContent).toContain("OpenAI Codex");
    expect(container.textContent).not.toContain("oauth");
  });

  it("没登录的行不显示断开按钮", () => {
    render();
    expect(
      container.querySelector('[data-testid="openrouter-oauth-disconnect"]'),
    ).toBeNull();
  });

  it("点断开把 provider id 交回调用方", () => {
    const onDisconnect = vi.fn();
    render({
      onDisconnect,
      oauthStatuses: {
        openrouter: { loggedIn: true, providerName: "OpenRouter" },
      },
    });
    act(() => {
      container
        .querySelector('[data-testid="openrouter-oauth-disconnect"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onDisconnect).toHaveBeenCalledWith("openrouter");
  });

  it("编辑与删除按钮把 profile key 交回调用方", () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render({ onEdit, onDelete });
    act(() => {
      container
        .querySelector('[data-testid="openrouter-edit"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      container
        .querySelector('[data-testid="openrouter-delete"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onEdit).toHaveBeenCalledWith("openrouter");
    expect(onDelete).toHaveBeenCalledWith("openrouter");
  });

  it("oauth: 前缀的 profile key 能还原出 provider id", () => {
    expect(oauthProviderIdForProfile("openrouter")).toBe("openrouter");
    expect(oauthProviderIdForProfile("oauth:openai-codex")).toBe(
      "openai-codex",
    );
  });

  it("只有登录写入的 profile 才被当成 OAuth 行", () => {
    // anthropic 用 API Key 配时不能走 OAuth 分支，否则会与 oauth:anthropic 撞 testid
    expect(oauthProviderIdForProfile("anthropic")).toBeUndefined();
    expect(oauthProviderIdForProfile("custom:sub-1")).toBeUndefined();
    expect(oauthProviderIdForProfile("oauth:anthropic")).toBe("anthropic");
  });

  it("oauth profile 的图标来自目录里的 OAuth 条目，不是 Server 兜底", () => {
    // config.provider 是合成值 "oauth"，预设表与 BRAND_SPECS 都没有它；
    // 品牌只能从 OAUTH_PROVIDERS[].brand 取，否则整行渲染成 Server 占位图。
    const oauthConfig = { ...openrouterConfig, provider: "oauth" as const };
    expect(rowBrand("oauth:openai-codex", oauthConfig)).toBe("openai");
    expect(rowBrand("oauth:anthropic", oauthConfig)).toBe("anthropic");
    expect(rowBrand("oauth:github-copilot", oauthConfig)).toBe("github");
  });

  it("非 oauth 行的品牌仍按 provider / 协议解析", () => {
    expect(rowBrand("openrouter", openrouterConfig)).toBe("openrouter");
    expect(
      rowBrand("deepseek", { ...openrouterConfig, provider: "deepseek" }),
    ).toBe("deepseek");
    // 自定义 endpoint 按协议取品牌
    expect(
      rowBrand("custom:x", {
        ...openrouterConfig,
        provider: "custom",
        customProtocol: "anthropic",
      }),
    ).toBe("anthropic");
  });

  it("预设 provider 显示预设名，不是裸 id", () => {
    render({
      rows: [
        {
          profileKey: "deepseek",
          config: {
            ...openrouterConfig,
            provider: "deepseek",
            baseUrl: "https://api.deepseek.com",
          },
        },
      ],
    });
    expect(container.textContent).toContain("DeepSeek");
  });
});

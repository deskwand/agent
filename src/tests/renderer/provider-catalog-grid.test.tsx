// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../renderer/i18n/config";
import { ProviderCatalogGrid } from "../../renderer/components/settings/provider-catalog-grid";
import { API_PROVIDER_PRESETS } from "../../shared/api-model-presets";

describe("ProviderCatalogGrid", () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = (
    overrides: Partial<React.ComponentProps<typeof ProviderCatalogGrid>> = {},
  ) => {
    container = document.createElement("div");
    document.body.innerHTML = "";
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        React.createElement(ProviderCatalogGrid, {
          presets: API_PROVIDER_PRESETS,
          configuredProfileKeys: new Set<string>(),
          oauthStatuses: {},
          oauthLoading: {},
          oauthErrors: {},
          onCreateProvider: vi.fn(),
          onCreatePlan: vi.fn(),
          onOAuthLogin: vi.fn(),
          onOAuthDisconnect: vi.fn(),
          ...overrides,
        }),
      );
    });
  };

  const tiles = () =>
    Array.from(container.querySelectorAll("button[data-catalog-entry]"));

  afterEach(() => {
    if (root) act(() => root.unmount());
  });

  it("铺开 15 个瓦片和三个分类", () => {
    render();
    expect(tiles()).toHaveLength(15);
    expect(container.textContent).toContain("Subscription");
    expect(container.textContent).toContain("Providers");
    expect(container.textContent).toContain("Relay");
  });

  it("每个瓦片的文案都是人读得懂的字，不是原始 i18n key", () => {
    render();
    for (const tile of tiles()) {
      const text = tile.textContent?.trim() ?? "";
      expect(text.length, "瓦片文案不能为空").toBeGreaterThan(0);
      expect(text.startsWith("api."), `瓦片渲染了原始 key：${text}`).toBe(
        false,
      );
    }
  });

  it("点供应商瓦片把 provider id 交回调用方", () => {
    const onCreateProvider = vi.fn();
    render({ onCreateProvider });
    const tile = tiles().find(
      (b) => b.getAttribute("data-catalog-entry") === "provider:deepseek",
    );
    act(() => {
      tile?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onCreateProvider).toHaveBeenCalledWith("deepseek");
  });

  it("点订阅套餐瓦片打开套餐弹窗", () => {
    const onCreatePlan = vi.fn();
    render({ onCreatePlan });
    const tile = tiles().find(
      (b) =>
        b.getAttribute("data-catalog-entry") ===
        "plan:custom:subscription-bailian-coding",
    );
    act(() => {
      tile?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onCreatePlan).toHaveBeenCalled();
  });

  it("未登录的订阅瓦片发起登录", () => {
    const onOAuthLogin = vi.fn();
    render({ onOAuthLogin });
    const tile = container.querySelector(
      '[data-testid="openai-codex-oauth-connect"]',
    );
    expect(tile).not.toBeNull();
    act(() => {
      tile?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onOAuthLogin).toHaveBeenCalledWith("openai-codex");
  });

  it("已登录的订阅瓦片走断开，不发登录", () => {
    const onOAuthLogin = vi.fn();
    const onOAuthDisconnect = vi.fn();
    render({
      onOAuthLogin,
      onOAuthDisconnect,
      oauthStatuses: { "openai-codex": { loggedIn: true } },
    });
    const tile = container.querySelector(
      '[data-testid="openai-codex-oauth-connect"]',
    ) as HTMLButtonElement;
    // 它是登出的唯一出口，所以不能禁用
    expect(tile.disabled).toBe(false);
    act(() => {
      tile.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onOAuthLogin).not.toHaveBeenCalled();
    expect(onOAuthDisconnect).toHaveBeenCalledWith("openai-codex");
    expect(tile.getAttribute("aria-label")).toBe("OpenAI Codex — Connected");
  });

  it("登录中的订阅瓦片禁用，不重复发请求", () => {
    const onOAuthLogin = vi.fn();
    render({
      onOAuthLogin,
      oauthLoading: { "openai-codex": true },
    });
    const tile = container.querySelector(
      '[data-testid="openai-codex-oauth-connect"]',
    ) as HTMLButtonElement;
    expect(tile.disabled).toBe(true);
    act(() => {
      tile.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onOAuthLogin).not.toHaveBeenCalled();
  });

  it("profile 已存在时供应商瓦片带已配置状态（纯装饰点 + 可访问名）", () => {
    render({ configuredProfileKeys: new Set(["deepseek"]) });
    const tile = tiles().find(
      (b) => b.getAttribute("data-catalog-entry") === "provider:deepseek",
    );
    // 瓦片只有 40px 高、列宽又窄：状态只画一个点，不塞带字的胶囊。
    const dot = tile?.querySelector("[aria-hidden='true']");
    expect(dot).not.toBeNull();
    expect(dot?.textContent).toBe("");
    // 胶囊形态（带字）不得出现在瓦片里 —— 它会被压缩成竖排并撞穿行高。
    expect(tile?.querySelector(".whitespace-nowrap")).toBeNull();
    // 状态靠按钮的 aria-label 传达：button 的子节点在无障碍树里被压平，
    // 放在里面的 sr-only 读不出来。
    expect(tile?.getAttribute("aria-label")).toBe("DeepSeek — Configured");
  });

  it("OAuth 错误在订阅分类下方渲染，不从页面上消失", () => {
    render({
      oauthErrors: { "openai-codex": "Pi SDK returned no models" },
    });
    const alert = container.querySelector('p[role="alert"]');
    expect(alert?.textContent).toContain("Pi SDK returned no models");
  });

  it("订阅类 Anthropic 显示 Claude，供应商类显示 Anthropic", () => {
    render();
    const claude = tiles().find(
      (b) => b.getAttribute("data-catalog-entry") === "oauth:anthropic",
    );
    const anthropic = tiles().find(
      (b) => b.getAttribute("data-catalog-entry") === "provider:anthropic",
    );
    expect(claude?.textContent).toContain("Claude");
    expect(anthropic?.textContent).toContain("Anthropic");
  });

  it("订阅瓦片包在 Tooltip 里，描述文案不丢", () => {
    render();
    const tile = tiles().find(
      (b) => b.getAttribute("data-catalog-entry") === "oauth:openai-codex",
    );
    const anchor = tile?.closest(".tt-anchor");
    expect(anchor, "订阅瓦片应由 Tooltip 包一层").not.toBeNull();

    // focus 打开气泡（useFocus），文案出现在 portal 里
    act(() => {
      anchor?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    expect(document.body.textContent).toContain(
      "Connect via ChatGPT subscription",
    );
  });

  it("没有描述的供应商瓦片不额外包 Tooltip", () => {
    render();
    const tile = tiles().find(
      (b) => b.getAttribute("data-catalog-entry") === "provider:deepseek",
    );
    expect(tile?.closest(".tt-anchor")).toBeNull();
  });
});

// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../renderer/i18n/config";
import i18n from "../../renderer/i18n/config";
import { ProviderCatalogPage } from "../../renderer/components/settings/api/provider-catalog-page";
import { API_PROVIDER_PRESETS } from "../../shared/api-model-presets";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(
  overrides: Partial<React.ComponentProps<typeof ProviderCatalogPage>> = {},
) {
  const props = {
    presets: API_PROVIDER_PRESETS,
    configuredProfileKeys: new Set<string>(),
    oauthStatuses: {},
    oauthLoading: {},
    oauthErrors: {},
    configuredLocalGateways: new Set<"magpie">(),
    localGatewayStatus: {},
    onBack: vi.fn(),
    onPickEntry: vi.fn(),
    onOAuthLogin: vi.fn(),
    onOAuthDisconnect: vi.fn(),
    onOpenLocalGateway: vi.fn(),
    onOpenConfigured: vi.fn(),
    ...overrides,
  };
  act(() => root.render(<ProviderCatalogPage {...props} />));
  return props;
}

function tile(entry: string): HTMLButtonElement | null {
  return container.querySelector(`[data-catalog-entry="${entry}"]`);
}

function typeSearch(value: string) {
  const input = container.querySelector<HTMLInputElement>(
    '[data-testid="catalog-search"]',
  )!;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("目录页", () => {
  it("按四个分类渲染，瓦片文案是人读得懂的字", () => {
    render();
    expect(container.textContent).toContain(i18n.t("api.categorySubscription"));
    expect(container.textContent).toContain(i18n.t("api.categoryVendor"));
    expect(container.textContent).toContain(i18n.t("api.categoryRelay"));
    expect(container.textContent).toContain(i18n.t("api.categoryLocal"));
    const labels = [...container.querySelectorAll("[data-catalog-entry]")].map(
      (node) => node.textContent ?? "",
    );
    expect(labels.length).toBeGreaterThanOrEqual(15);
    for (const label of labels) {
      expect(label.trim().length).toBeGreaterThan(0);
      expect(label.startsWith("api.")).toBe(false);
    }
  });

  it("点厂商瓦片把条目交回调用方", () => {
    const props = render();
    act(() => tile("provider:deepseek")!.click());
    expect(props.onPickEntry).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "provider", id: "deepseek" }),
    );
  });

  it("已配置的条目置灰并直接进详情，不重复创建", () => {
    const props = render({ configuredProfileKeys: new Set(["deepseek"]) });
    const deepseek = tile("provider:deepseek")!;
    expect(deepseek.getAttribute("aria-label")).toContain(
      i18n.t("api.catalogConfiguredBadge"),
    );
    act(() => deepseek.click());
    expect(props.onOpenConfigured).toHaveBeenCalledWith("deepseek");
    expect(props.onPickEntry).not.toHaveBeenCalled();
  });

  it("搜索按域名命中，命中后只剩匹配项", () => {
    render();
    typeSearch("moonshot");
    expect(tile("provider:deepseek")).toBeNull();
    expect(tile("oauth:anthropic")).toBeNull();
  });

  it("搜索无结果时给出自定义 URL 出口", () => {
    const props = render();
    typeSearch("zzz-nope");
    expect(container.textContent).toContain(
      i18n.t("api.catalogNoResult", { query: "zzz-nope" }),
    );
    const custom = container.querySelector<HTMLButtonElement>(
      '[data-testid="catalog-no-result-custom"]',
    )!;
    act(() => custom.click());
    expect(props.onPickEntry).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "provider", id: "custom" }),
    );
  });

  it("本机瓦片把探测状态写进 aria-label，并把 id 交回调用方", () => {
    const props = render({
      localGatewayStatus: { magpie: { state: "available", modelCount: 3 } },
    });
    const magpie = tile("local:magpie")!;
    expect(magpie.getAttribute("aria-label")).toContain("3");
    act(() => magpie.click());
    expect(props.onOpenLocalGateway).toHaveBeenCalledWith("magpie");
  });

  it("未登录的订阅瓦片发起登录；已登录的走断开", () => {
    const props = render();
    act(() => tile("oauth:openai-codex")!.click());
    expect(props.onOAuthLogin).toHaveBeenCalledWith("openai-codex");

    act(() => root.unmount());
    root = createRoot(container);
    const loggedIn = render({
      oauthStatuses: { "openai-codex": { loggedIn: true } },
    });
    act(() => tile("oauth:openai-codex")!.click());
    expect(loggedIn.onOAuthDisconnect).toHaveBeenCalledWith("openai-codex");
    expect(loggedIn.onOAuthLogin).not.toHaveBeenCalled();
  });

  it("compact 模式只渲染精简集且不出分组标题", () => {
    render({ compact: true });
    expect(container.textContent).not.toContain(i18n.t("api.categoryRelay"));
    const ids = [...container.querySelectorAll("[data-catalog-entry]")].map(
      (node) => node.getAttribute("data-catalog-entry"),
    );
    expect(ids).toContain("cloud:deskwand");
    expect(ids).not.toContain("provider:zhipu");
  });

  it("返回按钮把控制权交回调用方", () => {
    const props = render();
    act(() =>
      container
        .querySelector<HTMLButtonElement>('[data-testid="catalog-back"]')!
        .click(),
    );
    expect(props.onBack).toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../renderer/i18n/config";
import i18n from "../../renderer/i18n/config";
import { ConnectPanel } from "../../renderer/components/welcome/connect-panel";

let container: HTMLDivElement;
let root: Root;

function render(
  overrides: Partial<React.ComponentProps<typeof ConnectPanel>> = {},
) {
  const props = {
    configuredProfileKeys: new Set<string>(),
    oauthStatuses: {},
    configuredLocalGateways: new Set<"magpie">(),
    onOpenCloud: vi.fn(),
    onOpenApiSettings: vi.fn(),
    onOAuthLogin: vi.fn(async () => {}),
    onSubmitCredentials: vi.fn(async () => {}),
    ...overrides,
  };
  act(() => root.render(<ConnectPanel {...props} />));
  return props;
}

function tile(entry: string): HTMLButtonElement | null {
  return container.querySelector(`[data-catalog-entry="${entry}"]`);
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("引导页连接区", () => {
  it("只渲染精简集，且不出现「中转」分组", () => {
    render();
    expect(tile("cloud:deskwand")).not.toBeNull();
    expect(tile("provider:deepseek")).not.toBeNull();
    expect(tile("provider:zhipu")).toBeNull();
    expect(container.textContent).not.toContain(i18n.t("api.categoryRelay"));
  });

  it("点厂商瓦片原地换成凭证表单，不打开设置面板", async () => {
    const props = render();
    await act(async () => tile("provider:deepseek")!.click());
    expect(props.onOpenApiSettings).not.toHaveBeenCalled();
    expect(
      container.querySelector('[data-testid="credential-api-key"]'),
    ).not.toBeNull();
  });

  it("凭证提交把条目与值交给父层", async () => {
    const props = render();
    await act(async () => tile("provider:deepseek")!.click());
    const key = container.querySelector<HTMLInputElement>(
      '[data-testid="credential-api-key"]',
    )!;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    act(() => {
      setter.call(key, "sk-test");
      key.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="credential-submit"]')!
        .click();
    });
    expect(props.onSubmitCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "provider", id: "deepseek" }),
      expect.objectContaining({ apiKey: "sk-test" }),
    );
  });

  it("点「更多供应商…」把打开设置的意图交回父层", async () => {
    const props = render();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="connect-more-providers"]',
        )!
        .click();
    });
    expect(props.onOpenApiSettings).toHaveBeenCalled();
  });

  it("点云服务瓦片走登录弹窗，不进凭证表单", async () => {
    const props = render();
    await act(async () => tile("cloud:deskwand")!.click());
    expect(props.onOpenCloud).toHaveBeenCalled();
    expect(
      container.querySelector('[data-testid="credential-api-key"]'),
    ).toBeNull();
  });

  it("OAuth 瓦片发起登录；失败时就地渲染错误文案", async () => {
    const onOAuthLogin = vi.fn(async () => {
      throw new Error("boom");
    });
    render({ onOAuthLogin });
    await act(async () => tile("oauth:openai-codex")!.click());
    expect(onOAuthLogin).toHaveBeenCalledWith("openai-codex", "openai-codex");
    expect(container.textContent).toContain("boom");
  });

  it("凭证表单里点「返回」回到精简集", async () => {
    render();
    await act(async () => tile("provider:deepseek")!.click());
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="connect-back"]')!
        .click();
    });
    expect(tile("provider:deepseek")).not.toBeNull();
  });
});

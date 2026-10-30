// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../renderer/i18n/config";
import i18n from "../../renderer/i18n/config";
import {
  ProviderListPage,
  maskSecret,
} from "../../renderer/components/settings/api/provider-list-page";
import type { ApiProviderConfig } from "../../renderer/types";
import { API_PROVIDER_PRESETS } from "../../shared/api-model-presets";

const deepseek: ApiProviderConfig = {
  provider: "deepseek",
  customProtocol: "openai",
  apiKey: "sk-1234567890abcd",
  baseUrl: "https://api.deepseek.com/v1",
  defaultModel: "deepseek-chat",
  models: [
    { id: "deepseek-chat", label: "Chat", source: "preset" },
    { id: "deepseek-v4-pro", label: "Pro", source: "preset" },
  ],
  updatedAt: "2024-01-01T00:00:00.000Z",
};

const emptyModels: ApiProviderConfig = {
  ...deepseek,
  provider: "custom",
  name: "Kimi",
  baseUrl: "https://api.moonshot.cn/v1",
  models: [],
  defaultModel: "",
};

describe("maskSecret", () => {
  it("保留末四位，前面用点", () => {
    expect(maskSecret("sk-1234567890abcd")).toBe("sk-•••••abcd");
  });
  it("短于 8 位整串打码，不泄露长度", () => {
    expect(maskSecret("magpie")).toBe("••••••");
  });
  it("空值返回空串", () => {
    expect(maskSecret("")).toBe("");
  });
});

describe("列表页", () => {
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
    overrides: Partial<React.ComponentProps<typeof ProviderListPage>> = {},
  ) {
    const props = {
      rows: [{ profileKey: "deepseek", config: deepseek }],
      activeProfileKey: "deepseek" as const,
      presets: API_PROVIDER_PRESETS,
      oauthStatuses: {},
      onOpen: vi.fn(),
      onAdd: vi.fn(),
      onSetActive: vi.fn(),
      onDelete: vi.fn(),
      onDisconnect: vi.fn(),
      ...overrides,
    };
    act(() => root.render(<ProviderListPage {...props} />));
    return props;
  }

  it("副文案给出 host、模型数与打码 key", () => {
    render();
    expect(container.textContent).toContain("api.deepseek.com");
    expect(container.textContent).toContain("2");
    expect(container.textContent).toContain("abcd");
    expect(container.textContent).not.toContain("sk-1234567890abcd");
  });

  it("点整行进详情", () => {
    const props = render();
    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="configured-provider-deepseek"]',
        )!
        .click(),
    );
    expect(props.onOpen).toHaveBeenCalledWith("deepseek");
  });

  it("点 ⋯ 只开菜单，不进详情", () => {
    const props = render();
    const menu = container.querySelector<HTMLButtonElement>(
      '[data-testid="provider-row-menu-deepseek"]',
    )!;
    act(() => menu.click());
    expect(props.onOpen).not.toHaveBeenCalled();
    expect(menu.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain(i18n.t("api.providerRowDelete"));
  });

  it("菜单「删除」把 profile key 交回，且不触发进详情", () => {
    const props = render({ activeProfileKey: "deepseek" });
    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="provider-row-menu-deepseek"]',
        )!
        .click(),
    );
    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="provider-row-delete-deepseek"]',
        )!
        .click(),
    );
    expect(props.onDelete).toHaveBeenCalledWith("deepseek");
    expect(props.onOpen).not.toHaveBeenCalled();
  });

  it("当前供应商显示「当前」徽章；非当前行菜单里有「设为当前」", () => {
    const props = render({
      rows: [
        { profileKey: "deepseek", config: deepseek },
        { profileKey: "custom:kimi", config: emptyModels },
      ],
    });
    expect(container.textContent).toContain(i18n.t("api.activeSetTag"));
    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="provider-row-menu-custom:kimi"]',
        )!
        .click(),
    );
    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="provider-row-set-active-custom:kimi"]',
        )!
        .click(),
    );
    expect(props.onSetActive).toHaveBeenCalledWith("custom:kimi");
  });

  it("没有登录写入的行就没有「断开登录」菜单项", () => {
    render();
    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="provider-row-menu-deepseek"]',
        )!
        .click(),
    );
    expect(
      container.querySelector('[data-testid="provider-row-disconnect"]'),
    ).toBeNull();
  });

  it("零模型的供应商给出「未获取模型」提示", () => {
    render({ rows: [{ profileKey: "custom:kimi", config: emptyModels }] });
    expect(container.textContent).toContain(i18n.t("api.rowNoModels"));
  });

  it("OAuth 行显示已登录而不是打码 key", () => {
    render({
      rows: [
        {
          profileKey: "oauth:openai-codex",
          config: { ...deepseek, provider: "oauth" },
        },
      ],
      oauthStatuses: {
        "openai-codex": { loggedIn: true, providerName: "OpenAI Codex" },
      },
    });
    expect(container.textContent).toContain(i18n.t("api.oauthConnected"));
    expect(container.textContent).not.toContain("•••••");
  });

  it("空态给出添加按钮", () => {
    const props = render({ rows: [] });
    expect(container.textContent).toContain(
      i18n.t("api.configuredListEmptyTitle"),
    );
    act(() =>
      container
        .querySelector<HTMLButtonElement>('[data-testid="provider-list-add"]')!
        .click(),
    );
    expect(props.onAdd).toHaveBeenCalled();
  });
});

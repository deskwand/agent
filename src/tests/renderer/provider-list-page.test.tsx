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

/** Radix 的焦点移动/回焦/关闭都在 setTimeout(0) 里 —— 断言前得把这批任务跑完。 */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Radix 的菜单触发器只认左键 pointerdown，合成 click 不会展开。 */
async function pointerDown(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.dispatchEvent(
      new MouseEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        ctrlKey: false,
      }),
    );
  });
  await flush();
}

/** 菜单内容 portal 到 document.body，不在测试 container 里。 */
function menuItem(testId: string): HTMLElement {
  const el = document.body.querySelector<HTMLElement>(
    `[data-testid="${testId}"]`,
  );
  expect(el, `菜单项 ${testId} 必须存在`).toBeTruthy();
  return el!;
}

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

  /** 展开某一行的 ⋯ 菜单，返回触发器本身。 */
  async function openRowMenu(profileKey: string): Promise<HTMLElement> {
    const trigger = container.querySelector<HTMLElement>(
      `[data-testid="provider-row-menu-${profileKey}"]`,
    )!;
    await pointerDown(trigger);
    return trigger;
  }

  /** 点掉菜单里的某一项，等 Radix 收起。 */
  async function pickMenu(testId: string): Promise<void> {
    await act(async () => menuItem(testId).click());
    await flush();
  }

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

  it("点 ⋯ 只开菜单，不进详情", async () => {
    const props = render();
    const trigger = await openRowMenu("deepseek");
    expect(props.onOpen).not.toHaveBeenCalled();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.body.textContent).toContain(
      i18n.t("api.providerRowDelete"),
    );
  });

  it("菜单「编辑」进详情 —— 行尾 ⋯ 是唯一的编辑入口", async () => {
    const props = render();
    await openRowMenu("deepseek");
    expect(menuItem("provider-row-edit-deepseek").textContent).toBe(
      i18n.t("api.editApi"),
    );
    await pickMenu("provider-row-edit-deepseek");
    expect(props.onOpen).toHaveBeenCalledWith("deepseek");
  });

  it("菜单「删除」把 profile key 交回，且不触发进详情", async () => {
    const props = render({ activeProfileKey: "deepseek" });
    await openRowMenu("deepseek");
    await pickMenu("provider-row-delete-deepseek");
    expect(props.onDelete).toHaveBeenCalledWith("deepseek");
    expect(props.onOpen).not.toHaveBeenCalled();
  });

  it("当前供应商显示「当前」徽章；非当前行菜单里有「设为当前」", async () => {
    const props = render({
      rows: [
        { profileKey: "deepseek", config: deepseek },
        { profileKey: "custom:kimi", config: emptyModels },
      ],
    });
    expect(container.textContent).toContain(i18n.t("api.activeSetTag"));
    await openRowMenu("custom:kimi");
    await pickMenu("provider-row-set-active-custom:kimi");
    expect(props.onSetActive).toHaveBeenCalledWith("custom:kimi");
  });

  it("没有登录写入的行就没有「断开登录」菜单项", async () => {
    render();
    await openRowMenu("deepseek");
    expect(
      document.body.querySelector('[data-testid="provider-row-disconnect"]'),
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

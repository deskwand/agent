// @vitest-environment jsdom
//
// Task 3 第 1 小步：API 编辑弹窗外壳迁到 OccludingDialog（shadcn Dialog）后的不变量。
//
// 覆盖失败模式：
//   #1 弹窗内容经 portal 挂到 document.body，不再位于测试 container 内
//      （既有 5 个测试文件的 container 查询因此变红，见同批改动）
//   #2 外壳语义：唯一 role=dialog、标题走 i18n、occlusion 恰好占 1
//   #3 遮罩点击 / Escape 都不关闭（原手写外壳就没有这两条关闭路径）
//   #4 本地化 X 关闭恰一次并释放 occlusion；关闭后焦点回到 opener
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../renderer/i18n/config";
import i18n from "../../renderer/i18n/config";
import { SettingsAPI } from "../../renderer/components/settings/SettingsAPI";
import { useAppStore } from "../../renderer/store";
import type { AppConfig } from "../../renderer/types";
import { API_PROVIDER_PRESETS } from "../../shared/api-model-presets";
import { normalizeCodemodeConfig } from "../../shared/codemode-config";
import { normalizeWebAccessConfig } from "../../shared/web-access";

function buildConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    provider: "openrouter",
    apiKey: "",
    baseUrl: "https://openrouter.ai/api/v1",
    customProtocol: "anthropic",
    model: "",
    contextWindow: undefined,
    maxTokens: undefined,
    activeProfileKey: "openrouter",
    profiles: {},
    activeProviderKey: "openrouter",
    providers: {},
    deskWandCodePath: "",
    defaultWorkdir: "",
    theme: "light",
    themePreset: "zinc",
    sandboxEnabled: false,
    memoryEnabled: true,
    memoryRuntime: { maxNavSteps: 2, ingestionConcurrency: 4 },
    enableThinking: false,
    thinkingLevel: "medium",
    autoSkillLearning: false,
    isConfigured: false,
    webAccess: normalizeWebAccessConfig(undefined),
    codemode: normalizeCodemodeConfig(undefined),
    ...overrides,
  };
}

async function flush(): Promise<void> {
  // Radix 的 FocusScope 在 setTimeout(0) 里回焦（focusScope.autoFocusOnUnmount）：
  // 只 drain 微任务会在回焦前就断言 activeElement。
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function click(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });
}

/**
 * Radix FocusScope 的 Tab 候选口径（react-focus-scope 的 `getTabbableCandidates`）：
 * tabIndex >= 0 且非 disabled/hidden，按文档顺序。jsdom 不实现原生 Tab 导航，
 * 只有用同一口径算出「末 tabbable」，才能验证 DialogContent（loop: true）的
 * 末→首回绕真的发生，而不是断言到浏览器/测试自己的猜测。
 */
function tabbableCandidates(layer: HTMLElement): HTMLElement[] {
  const nodes: HTMLElement[] = [];
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) => {
      const el = node as HTMLElement;
      const isHiddenInput =
        el.tagName === "INPUT" && (el as HTMLInputElement).type === "hidden";
      if ((el as HTMLButtonElement).disabled || el.hidden || isHiddenInput) {
        return NodeFilter.FILTER_SKIP;
      }
      return el.tabIndex >= 0
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP;
    },
  });
  while (walker.nextNode()) nodes.push(walker.currentNode as HTMLElement);
  return nodes;
}

async function pressTab(): Promise<void> {
  await act(async () => {
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

/**
 * 五组弹窗外壳共用的焦点契约：开窗后焦点已进入 dialog；
 * 末 tabbable 按 Tab 必须回绕到首 tabbable（焦点锁在弹窗内）。
 */
async function expectFocusTrap(layer: HTMLElement): Promise<void> {
  expect(
    layer.contains(document.activeElement),
    "开窗后焦点必须进入 dialog",
  ).toBe(true);
  const candidates = tabbableCandidates(layer);
  expect(candidates.length, "弹窗内至少要有两个 tabbable").toBeGreaterThan(1);
  const first = candidates[0];
  const last = candidates[candidates.length - 1];
  last.focus();
  expect(document.activeElement, "先把焦点置于末 tabbable").toBe(last);
  await pressTab();
  expect(
    document.activeElement,
    "末 tabbable 按 Tab 必须回到首 tabbable（焦点锁在弹窗内）",
  ).toBe(first);
}

describe("SettingsAPI 剩余四个弹窗外壳（Task 3 第 2 小步）", () => {
  let container: HTMLDivElement;
  let root: Root;
  let acquireSpy: ReturnType<typeof vi.fn<(id: string) => void>>;
  let releaseSpy: ReturnType<typeof vi.fn<(id: string) => void>>;
  let deleteProvider: ReturnType<
    typeof vi.fn<
      (args: { profileKey: string }) => Promise<{ config: AppConfig }>
    >
  >;
  let authLogout: ReturnType<typeof vi.fn<(id: string) => Promise<void>>>;

  const oauthConfig = (): AppConfig =>
    buildConfig({
      providers: {
        "oauth:openai-codex": {
          provider: "oauth",
          customProtocol: "anthropic",
          apiKey: "",
          baseUrl: "",
          defaultModel: "gpt-6-astra",
          models: [
            { id: "gpt-6-astra", label: "GPT-6 Astra", source: "preset" },
          ],
          updatedAt: "2026-09-13T00:00:00.000Z",
        },
      },
    });

  beforeEach(() => {
    document.body.innerHTML = "";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const state = useAppStore.getState();
    acquireSpy = vi.fn(state.acquireBrowserOcclusion);
    releaseSpy = vi.fn(state.releaseBrowserOcclusion);
    const config = oauthConfig();
    useAppStore.setState({
      appConfig: config,
      isConfigured: true,
      browserOcclusionIds: new Set<string>(),
      acquireBrowserOcclusion: acquireSpy,
      releaseBrowserOcclusion: releaseSpy,
    });
    deleteProvider = vi.fn(
      (_args: { profileKey: string }): Promise<{ config: AppConfig }> =>
        Promise.resolve({ config }),
    ) as unknown as typeof deleteProvider;
    authLogout = vi.fn(async () => undefined) as unknown as typeof authLogout;
    window.electronAPI = {
      config: {
        get: vi.fn(async () => config),
        getPresets: vi.fn(async () => API_PROVIDER_PRESETS),
        saveProvider: vi.fn(async () => ({ success: true, config })),
        deleteProvider,
        fetchOpenRouterModels: vi.fn(async () => ({
          usedFallback: false,
          models: [],
        })),
      },
      auth: {
        status: vi.fn(async (id: string) => ({
          loggedIn: id === "openai-codex",
          providerName: "OpenAI Codex",
        })),
        logout: authLogout,
      },
      openrouterAuth: {
        login: vi.fn(async () => ({
          apiKey: "sk-or-v1-test",
          providerName: "OpenRouter",
        })),
        logout: vi.fn(async () => undefined),
        status: vi.fn(async () => ({
          loggedIn: false,
          providerName: "OpenRouter",
        })),
      },
    } as unknown as typeof window.electronAPI;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body
      .querySelectorAll('[role="dialog"], [role="alertdialog"]')
      .forEach((el) => el.remove());
    useAppStore.setState({ browserOcclusionIds: new Set<string>() });
  });

  function deferred<T>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (error: unknown) => void;
  } {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  const dialogs = (role: "dialog" | "alertdialog" = "dialog"): HTMLElement[] =>
    Array.from(document.body.querySelectorAll<HTMLElement>(`[role="${role}"]`));

  // 弹窗动作必须按层查找：列表行里的 opener 与弹窗动作常常同一文案。
  const buttonIn = (layer: HTMLElement, text: string): HTMLButtonElement => {
    const button = Array.from(
      layer.querySelectorAll<HTMLButtonElement>("button"),
    ).find((item) => (item.textContent ?? "").trim() === text);
    expect(button, `层内按钮「${text}」必须存在`).toBeTruthy();
    return button!;
  };

  const renderSettings = async (): Promise<void> => {
    await act(async () => {
      root.render(React.createElement(SettingsAPI, {}));
    });
    // 加载 config 后还有一轮串行的 OAuth status 拉取，多 drain 几轮避免竞态。
    for (let i = 0; i < 5; i += 1) {
      await flush();
    }
  };

  /** 行尾（⋯）菜单是 Radix DropdownMenu：触发器只认左键 pointerdown。 */
  const openRowMenu = async (profileKey: string): Promise<void> => {
    const trigger = container.querySelector<HTMLElement>(
      `[data-testid="provider-row-menu-${profileKey}"]`,
    );
    expect(trigger, "行尾 ⋯ 必须存在").not.toBeNull();
    await act(async () => {
      trigger!.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          ctrlKey: false,
        }),
      );
    });
    await flush();
  };

  /** 菜单内容 portal 到 document.body，不在测试 container 里。 */
  const menuItem = (testId: string): HTMLElement => {
    const el = document.body.querySelector<HTMLElement>(
      `[data-testid="${testId}"]`,
    );
    expect(el, `菜单项 ${testId} 必须存在`).toBeTruthy();
    return el!;
  };

  const outsideClick = async (content: HTMLElement): Promise<void> => {
    const overlay = content.previousElementSibling;
    expect(overlay, "遮罩层必须存在").not.toBeNull();
    await act(async () => {
      overlay!.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
      );
    });
    await act(async () => {
      overlay!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    await flush();
  };

  const pressEscape = async (): Promise<void> => {
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await flush();
  };

  const openOauthDialog = async (): Promise<HTMLButtonElement> => {
    await renderSettings();
    // 断开入口收进了行尾 ⋯ 菜单
    await openRowMenu("oauth:openai-codex");
    const opener = menuItem("provider-row-disconnect") as HTMLButtonElement;
    opener.focus();
    await click(opener);
    await flush();
    return opener;
  };

  const openDeleteDialog = async (): Promise<HTMLButtonElement> => {
    await renderSettings();
    await openRowMenu("oauth:openai-codex");
    const opener = menuItem(
      "provider-row-delete-oauth:openai-codex",
    ) as HTMLButtonElement;
    opener.focus();
    await click(opener);
    await flush();
    return opener;
  };

  it("OAuth 断开：确认恰一次、pending 立即清空而请求仍挂起、无额外取消调用", async () => {
    const logout = deferred<void>();
    authLogout.mockReturnValue(logout.promise);

    await openOauthDialog();
    expect(dialogs("alertdialog")).toHaveLength(1);
    expect(dialogs("alertdialog")[0].querySelector("h2")?.textContent).toBe(
      i18n.t("api.oauthDisconnect"),
    );
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(1);

    await click(
      buttonIn(dialogs("alertdialog")[0], i18n.t("api.oauthDisconnect")),
    );
    await flush();

    expect(authLogout, "确认恰一次").toHaveBeenCalledTimes(1);
    expect(authLogout.mock.calls[0][0]).toBe("openai-codex");
    expect(
      dialogs("alertdialog"),
      "pending 必须先清空：alertdialog 立即消失",
    ).toHaveLength(0);
    // 「请求仍挂起」的可证伪形式：deferred 只归测试所有，实现拿不到 resolve。
    // 若实现把清 pending / 关弹窗挪到 await 之后，「立即消失」会先红；
    // 这里再钉一次确认路径没有等待请求或二次发起（老断言的 settled 恒为 false，删）。
    expect(
      authLogout,
      "挂起期间只发起一次登出，不等待不重试",
    ).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(0);
    expect(releaseSpy).toHaveBeenCalledTimes(1);
    // 菜单项点完即卸载，关闭后焦点回到页面根节点（rootRef fallback）
    expect(container.contains(document.activeElement)).toBe(true);

    await act(async () => {
      logout.resolve();
    });
    await flush();
    expect(authLogout).toHaveBeenCalledTimes(1);
  });

  it("API Key 删除：pending 期间 disabled、遮罩/Escape 不关、不重复请求；resolve 关/reject 恢复", async () => {
    const first = deferred<{ config: AppConfig }>();
    deleteProvider.mockReturnValue(first.promise);
    await openDeleteDialog();
    await flush();
    expect(dialogs("alertdialog")).toHaveLength(1);
    expect(dialogs("alertdialog")[0].querySelector("h2")?.textContent).toBe(
      i18n.t("api.deleteApi"),
    );

    const confirmFirst = buttonIn(
      dialogs("alertdialog")[0],
      i18n.t("api.deleteApi"),
    );
    const cancelButton = buttonIn(
      dialogs("alertdialog")[0],
      i18n.t("common.cancel"),
    );
    await click(confirmFirst);
    await flush();

    expect(deleteProvider).toHaveBeenCalledTimes(1);
    expect(dialogs("alertdialog"), "pending 期间弹窗必须仍在").toHaveLength(1);
    expect(confirmFirst.disabled, "确认按钮 disabled").toBe(true);
    expect(cancelButton.disabled, "取消按钮 disabled").toBe(true);

    await click(confirmFirst);
    await flush();
    expect(
      deleteProvider,
      "disabled 期间二次点击不重复请求",
    ).toHaveBeenCalledTimes(1);
    await outsideClick(dialogs("alertdialog")[0]);
    await pressEscape();
    expect(dialogs("alertdialog"), "遮罩/Escape 不得关闭").toHaveLength(1);

    await act(async () => {
      first.resolve({ config: oauthConfig() });
    });
    await flush();
    expect(dialogs("alertdialog"), "resolve 后关闭").toHaveLength(0);
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(0);
    expect(releaseSpy).toHaveBeenCalledTimes(1);

    // reject：弹窗仍打开、按钮恢复可用、取消仍是关闭入口。
    const second = deferred<{ config: AppConfig }>();
    deleteProvider.mockReturnValue(second.promise);
    // 菜单项点一次就卸载，重开菜单再点
    await openRowMenu("oauth:openai-codex");
    await click(menuItem("provider-row-delete-oauth:openai-codex"));
    await flush();
    const confirmSecond = buttonIn(
      dialogs("alertdialog")[0],
      i18n.t("api.deleteApi"),
    );
    await click(confirmSecond);
    await flush();
    await act(async () => {
      second.reject(new Error("boom"));
    });
    await flush();
    expect(dialogs("alertdialog"), "reject 后仍打开").toHaveLength(1);
    expect(confirmSecond.disabled, "reject 后确认恢复").toBe(false);
    const cancelSecond = buttonIn(
      dialogs("alertdialog")[0],
      i18n.t("common.cancel"),
    );
    expect(cancelSecond.disabled, "reject 后取消恢复").toBe(false);
    await click(cancelSecond);
    await flush();
    expect(dialogs("alertdialog")).toHaveLength(0);
  });

  it("API Key 删除成功且 opener 行已被移除：回焦走 rootRef fallback", async () => {
    const opener = await openDeleteDialog();
    // 成功返回的 config 不再含该 provider：确认后 opener 所在行随重渲染卸载，
    // 打开时捕获的返回目标 isConnected === false，只能落到 rootRef（tabIndex=-1 根容器）。
    deleteProvider.mockReturnValue(Promise.resolve({ config: buildConfig() }));

    await click(buttonIn(dialogs("alertdialog")[0], i18n.t("api.deleteApi")));
    await flush();

    expect(dialogs("alertdialog")).toHaveLength(0);
    expect(opener.isConnected, "opener 行必须已卸载").toBe(false);
    expect(
      document.activeElement,
      "返回目标已卸载 → rootRef fallback 必须拿到焦点",
    ).toBe(container.firstElementChild);
  });

  it("OAuth 断开：开窗后焦点进入 dialog，Tab 从末 tabbable 回绕到首 tabbable", async () => {
    await openOauthDialog();
    await expectFocusTrap(dialogs("alertdialog")[0]);
  });

  it("API Key 删除：开窗后焦点进入 dialog，Tab 从末 tabbable 回绕到首 tabbable", async () => {
    await openDeleteDialog();
    await expectFocusTrap(dialogs("alertdialog")[0]);
  });

  it("叠加：OAuth + Key 同时打开时 occlusion 2→1→0，逐层把焦点还回各层 opener", async () => {
    await openOauthDialog();
    expect(dialogs("alertdialog")).toHaveLength(1);

    // 合成路径，不是真实鼠标路径：modal 期间 Radix 给 body 加 pointer-events:none，
    // 底层 OAuth 弹窗对外不可点，真实用户点不到它的「删除」。这里直接派发 click
    // 绕开指针模型，专门验证两层各自记住返回目标、关掉上层不覆写下层。
    // 删除入口在行尾 ⋯ 菜单里：合成点击直接派发，绕开 modal 的指针模型。
    await openRowMenu("oauth:openai-codex");
    const deleteOpener = menuItem("provider-row-delete-oauth:openai-codex");
    await click(deleteOpener);
    await flush();

    expect(dialogs("alertdialog"), "真实同时打开两层").toHaveLength(2);
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(2);
    expect(
      dialogs("alertdialog")[1].contains(document.activeElement),
      "顶层打开后焦点必须进入顶层",
    ).toBe(true);

    // 关顶层（Key）：下层 OAuth 仍在。cancel 文案两层相同，必须按层内查找。
    const cancelIn = (layer: HTMLElement): HTMLButtonElement => {
      const button = Array.from(
        layer.querySelectorAll<HTMLButtonElement>("button"),
      ).find(
        (item) => (item.textContent ?? "").trim() === i18n.t("common.cancel"),
      );
      expect(button, "层内取消按钮必须存在").toBeTruthy();
      return button!;
    };
    await click(cancelIn(dialogs("alertdialog")[1]));
    await flush();
    expect(dialogs("alertdialog"), "只关顶层").toHaveLength(1);
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(1);
    const bottom = dialogs("alertdialog")[0];
    expect(bottom.querySelector("h2")?.textContent).toBe(
      i18n.t("api.oauthDisconnect"),
    );
    // 行尾 ⋯ 菜单换成 Radix DropdownMenu 后，删除入口（菜单项）在选中时随菜单一起卸载：
    // 顶层关掉时回焦目标已 disconnected，落在 settings 根（useReturnFocus 的兜底）。
    // 兜底不等于放羊：底层弹窗的焦点陷阱仍生效，下一次外部聚焦会被拉回弹窗内。
    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="provider-list-add"]')
        ?.focus();
    });
    await flush();
    expect(
      bottom.contains(document.activeElement),
      "关顶层后焦点必须回到底层弹窗内",
    ).toBe(true);

    await click(cancelIn(bottom));
    await flush();
    expect(dialogs("alertdialog")).toHaveLength(0);
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(0);
    // 菜单项点完即卸载：最终焦点回到页面根节点，而不是已消失的 opener
    expect(container.contains(document.activeElement)).toBe(true);
  });
});

// @vitest-environment jsdom
//
// 这个文件守的是**接线层**，不是面板内部：从底栏真实入口点圆环，确认额度块会出现。
//
// 为什么需要它：本次修的 bug（已登录的 Codex 额度在 deepseek 会话里不显示）根因就在
// 底栏/面板这一层的一道条件闸门（曾经的 `if (!open || !providerId) return;`）。
// `status-popover.test.ts` 直接渲染 StatusPopover，绕过了底栏——若有人在
// `ChatInputBottomBar` 处重新加条件渲染（或另一类闸门），那里的用例**全都不会红**。
// 之前唯一驱动这条链路的 `quota-provider-id.test.ts` 随「profile key → 适配器 id」
// 推导一起被删除，所以这里补回接线层的护栏。

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChatInputBottomBar,
  type ChatInputBottomBarProps,
} from "../../renderer/components/ChatInputBottomBar";
import type { ModelOptionGroup } from "../../renderer/components/ChatInputBottomBar";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));

const modelOptions: ModelOptionGroup[] = [
  {
    profileKey: "oauth:openai-codex" as never,
    groupLabel: "OpenAI Codex",
    items: [{ id: "gpt-5.6-luna", name: "gpt-5.6-luna" }],
  },
];

const baseProps: ChatInputBottomBarProps = {
  onAttach: () => {},
  onAddFiles: () => {},
  attachedKeys: new Set<string>(),
  model: "gpt-5.6-luna",
  modelOptions,
  activeProviderProfileKey: "openrouter" as never,
  onSelectModel: () => {},
  thinkingLevel: "medium",
  thinkingLevelOptions: ["off", "medium"],
  onSelectThinkingLevel: () => {},
  contextUsagePercentage: 10,
  contextRingColorClass: "text-accent",
  contextStatusDetails: {
    usedLabel: "26K",
    totalLabel: "258K",
    cacheHitRate: "--",
  },
  canStop: false,
  onStop: () => {},
  isSubmitting: false,
  hasInputContent: false,
};

const quota = [
  {
    providerId: "openai-codex",
    providerName: "OpenAI Codex",
    planName: "team",
    windows: [
      { kind: "session" as const, usedPercent: 10, resetsAt: 1789761912000 },
    ],
  },
];

describe("底栏到额度块的接线", () => {
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
    vi.unstubAllGlobals();
  });

  function stubQuotaList(result: unknown) {
    const list = vi.fn(async () => result);
    vi.stubGlobal("electronAPI", { quota: { list } });
    return list;
  }

  function render(props: Partial<ChatInputBottomBarProps> = {}) {
    act(() => {
      root.render(
        React.createElement(ChatInputBottomBar, { ...baseProps, ...props }),
      );
    });
  }

  /** 底栏里唯一的 aria-haspopup="dialog" 就是圆环触发按钮。 */
  function trigger(): HTMLButtonElement {
    return container.querySelector('button[aria-haspopup="dialog"]')!;
  }

  it("非 OAuth 会话（openrouter）里打开面板，仍能查到并显示已登录订阅的额度", async () => {
    const list = stubQuotaList(quota);
    render({ activeProviderProfileKey: "openrouter" as never });
    act(() => trigger().click());
    await act(async () => {});

    // 挂载预取 1 次 + 打开刷新 1 次
    expect(list).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("OpenAI Codex");
  });

  it("OAuth 会话里同样可以（防止另一个方向的回归）", async () => {
    const list = stubQuotaList(quota);
    render({ activeProviderProfileKey: "oauth:openai-codex" as never });
    act(() => trigger().click());
    await act(async () => {});

    // 挂载预取 1 次 + 打开刷新 1 次
    expect(list).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("OpenAI Codex");
  });
});

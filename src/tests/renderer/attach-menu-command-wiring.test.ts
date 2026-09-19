// @vitest-environment jsdom
//
// 这个文件守的是**底栏这一层**：命令入口从 ChatInputBottomBar 透传到 AttachMenu。
//
// 为什么需要它：attach-menu.test.ts 直接渲染 AttachMenu，绕过底栏 —— 若有人在底栏
// 漏传 onCommandEntry（或给 AttachMenu 加上条件渲染），命令组会在真实输入框里静默
// 消失，而那一整个文件的用例仍然全绿。（同类理由见 quota-panel-wiring.test.ts 的文件头。）

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChatInputBottomBar,
  type ChatInputBottomBarProps,
} from "../../renderer/components/ChatInputBottomBar";
import type { ModelOptionGroup } from "../../renderer/components/ChatInputBottomBar";

vi.mock("react-i18next", () => ({
  // 占位不可省：底栏会走到 StatusPopover → utils/i18n-format → i18n/config，
  // 那里在模块顶层调 i18n.use(initReactI18next)；缺了它在 import 期就抛，
  // 整个文件收集失败。同 quota-panel-wiring.test.ts:22 与
  // chat-input-expand-visibility.test.ts:24。
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));

const modelOptions: ModelOptionGroup[] = [
  {
    profileKey: "profile-a" as never,
    groupLabel: "Provider A",
    items: [{ id: "model-1", name: "Model One" }],
  },
];

const baseProps: ChatInputBottomBarProps = {
  onAttach: () => {},
  onAddFiles: () => {},
  attachedKeys: new Set<string>(),
  model: "model-1",
  modelOptions,
  activeProviderProfileKey: "profile-a" as never,
  onSelectModel: () => {},
  thinkingLevel: "medium",
  thinkingLevelOptions: ["off", "medium"],
  onSelectThinkingLevel: () => {},
  contextUsagePercentage: 0,
  contextRingColorClass: "text-accent",
  contextStatusDetails: {
    usedLabel: "0",
    totalLabel: "0",
    cacheHitRate: "--",
  },
  canStop: false,
  onStop: () => {},
  isSubmitting: false,
  hasInputContent: false,
};

describe("底栏到命令入口的接线", () => {
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

  function render(props: Partial<ChatInputBottomBarProps> = {}) {
    act(() => {
      root.render(
        React.createElement(ChatInputBottomBar, { ...baseProps, ...props }),
      );
    });
  }

  function attachTrigger(): HTMLButtonElement {
    const button = container.querySelector("button[data-attach-trigger]");
    if (!button) throw new Error("attach trigger not rendered");
    return button as HTMLButtonElement;
  }

  function menuItem(label: string): HTMLButtonElement {
    const found = Array.from(
      container.querySelectorAll<HTMLButtonElement>("[role='menuitem']"),
    ).find((button) => button.textContent?.includes(label));
    if (!found) throw new Error(`menu item not found: ${label}`);
    return found;
  }

  it("不传 onCommandEntry 时命令组不出现（欢迎页那一侧）", async () => {
    render();
    await act(async () => {
      attachTrigger().click();
    });
    expect(container.querySelectorAll("[role='menuitem']").length).toBe(3);
  });

  it("传了 onCommandEntry 时命令组出现，且点击透传到回调", async () => {
    const onCommandEntry = vi.fn();
    render({ onCommandEntry });
    await act(async () => {
      attachTrigger().click();
    });
    // 3 个附件项 + 「＋」+ 2 个内置命令（本文件没 stub promptCommands）
    expect(container.querySelectorAll("[role='menuitem']").length).toBe(6);

    act(() => menuItem("slash.goal").click());
    expect(onCommandEntry).toHaveBeenCalledWith("goal");
  });

  it("透传 onInsertPromptCommand：欢迎页也能建命令", async () => {
    const onInsertPromptCommand = vi.fn();
    render({ onInsertPromptCommand });
    await act(async () => {
      attachTrigger().click();
    });
    // 没有 onCommandEntry（欢迎页形态）时命令组也要出现，因为「＋」在里面；
    // 内置两项不渲染，所以 menuitem = 3 个附件项 + 「＋」= 4。
    expect(container.querySelector("[data-command-create]")).not.toBeNull();
    expect(container.querySelectorAll("[role='menuitem']").length).toBe(4);
  });

  it("两个能力都不传时命令组不渲染（守住欢迎页旧行为）", async () => {
    render();
    await act(async () => {
      attachTrigger().click();
    });
    expect(container.querySelector("[data-command-create]")).toBeNull();
  });
});

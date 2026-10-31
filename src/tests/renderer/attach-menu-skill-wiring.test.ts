// @vitest-environment jsdom
//
// 这个文件守的是**左簇这一层**：技能入口从 ChatInputActionBar 透传到 AttachMenu。
//
// 为什么需要它：attach-menu-skills.test.ts 直接渲染 AttachMenu，绕过底栏 —— 若有人
// 在底栏漏传 onInsertSkill（或给 AttachMenu 加上条件渲染），技能组会在真实输入框里
// 静默消失，而直接渲染 AttachMenu 的用例仍然全绿。

import React, { act } from "react";
import { toggleAttachMenu } from "./attach-menu-helper";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChatInputActionBar,
  type ChatInputActionBarProps,
} from "../../renderer/components/ChatInputActionBar";

vi.mock("react-i18next", () => ({
  // 占位不可省：底栏会走到 StatusPopover → utils/i18n-format → i18n/config，
  // 那里在模块顶层调 i18n.use(initReactI18next)；缺了它在 import 期就抛。
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));

const baseProps: ChatInputActionBarProps = {
  onAttach: () => {},
  onAddFiles: () => {},
  attachedKeys: new Set<string>(),
  hasInputContent: false,
  voice: {
    status: "idle",
    onToggle: () => {},
  },
};

describe("底栏到技能入口的接线", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    localStorage.setItem("deskwand.pinnedSkills", JSON.stringify(["pdf"]));
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      skills: {
        getAll: () =>
          Promise.resolve([
            {
              id: "1",
              name: "pdf",
              description: "",
              type: "builtin",
              enabled: true,
              createdAt: 0,
            },
          ]),
      },
      vault: { getSnapshot: vi.fn().mockRejectedValue(new Error("no vault")) },
      piCommands: { list: vi.fn().mockResolvedValue({ commands: [] }) },
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(props: Partial<ChatInputActionBarProps> = {}) {
    act(() => {
      root.render(
        React.createElement(ChatInputActionBar, { ...baseProps, ...props }),
      );
    });
  }

  it("不传 onInsertSkill 时技能组不出现（没有技能能力的宿主）", async () => {
    render();
    await act(async () => {
      await toggleAttachMenu(container);
    });
    expect(document.body.querySelector("[data-skill-row]")).toBeNull();
  });

  it("透传 onInsertSkill：出现星标技能行，点击把名字交给宿主", async () => {
    const onInsertSkill = vi.fn();
    render({ onInsertSkill });
    await act(async () => {
      await toggleAttachMenu(container);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const row = document.body.querySelector<HTMLButtonElement>(
      "[data-skill-row='pdf']",
    );
    if (!row) throw new Error("skill row not rendered");

    act(() => row.click());
    expect(onInsertSkill).toHaveBeenCalledWith("pdf");
  });
});

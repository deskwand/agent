// @vitest-environment jsdom
//
// 守 ChatInput 这一层的**保鲜**：星标存在 localStorage 里，两个菜单各自只在打开时
// 读一次。删掉 ChatInput 里那句"斜杠菜单打开时重读星标"，本文件必红。

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatInput } from "../../renderer/components/ChatInput";
import type { Skill } from "../../renderer/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../renderer/hooks/useIPC", () => ({
  useIPC: () => ({ isElectron: true }),
}));

const SKILLS: Skill[] = [
  {
    id: "1",
    name: "pdf",
    description: "d",
    type: "builtin",
    enabled: true,
    createdAt: 0,
  },
];

/** 以 "/" 打开斜杠菜单（照抄 chat-input-slash-recency.test.ts 的做法）。 */
async function openSlashMenu(container: HTMLElement) {
  const editor = container.querySelector<HTMLElement>("[data-placeholder]")!;
  await act(async () => {
    editor.focus();
    editor.dispatchEvent(
      new KeyboardEvent("keydown", { key: "/", bubbles: true }),
    );
    editor.textContent = "/";
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** 技能表是异步拉的：等到那一行的星标按钮出现。 */
async function waitForPin(container: HTMLElement): Promise<Element> {
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const star = container.querySelector("[data-skill-pin='pdf'] svg");
    if (star) return star;
  }
  throw new Error("pin button not rendered");
}

describe("斜杠菜单的星标保鲜", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    (window as unknown as { electronAPI?: unknown }).electronAPI = {
      skills: { getAll: () => Promise.resolve(SKILLS) },
      piCommands: { list: () => Promise.resolve({ commands: [] }) },
      on: () => () => {},
    };
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("挂载之后被别处改过的星标，在菜单打开时能读到", async () => {
    root = createRoot(container);
    await act(async () => {
      root.render(
        React.createElement(ChatInput, {
          draftKey: "test-session",
          onSubmit: () => {},
          placeholder: "p",
          cardClassName: "",
          textareaClassName: "",
          bottomSlot: null,
        }),
      );
    });

    // 模拟「+」菜单里点了星：挂载之后才写存储
    localStorage.setItem("deskwand.pinnedSkills", JSON.stringify(["pdf"]));

    await openSlashMenu(container);
    const star = await waitForPin(container);

    expect(star.getAttribute("fill")).toBe("currentColor");
  });
});

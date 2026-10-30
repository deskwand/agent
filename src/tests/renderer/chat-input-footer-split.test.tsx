// @vitest-environment jsdom
//
// 「长期状态不放在输入卡里」这条结构约定。
//
// 为什么钉结构而不是截图：卡内间距由 cardClassName 决定（ChatView 用 p-3.5，
// WelcomeView 用 px-5 py-5），页脚一旦被塞回卡里，它会继承卡的内边距 —— 视觉上
// 就是「页脚贴着输入框边」，而这在 jsdom 里只能靠包含关系判断，不能靠坐标。

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatInput } from "../../renderer/components/ChatInput";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../renderer/hooks/useIPC", () => ({
  useIPC: () => ({ isElectron: false }),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderInput(footerSlot: React.ReactNode) {
  await act(async () => {
    root.render(
      React.createElement(ChatInput, {
        draftKey: "footer-split-test",
        onSubmit: () => {},
        onContentChange: () => {},
        placeholder: "Message",
        cardClassName: "card-under-test",
        textareaClassName: "",
        bottomSlot: null,
        footerSlot,
      }),
    );
  });
}

describe("输入卡与页脚拆分", () => {
  it("页脚渲染在卡外", async () => {
    await renderInput(<span>MODEL-CHIP-STUB</span>);
    const card = container.querySelector<HTMLElement>(
      '[data-testid="chat-input-card"]',
    );
    const footer = container.querySelector<HTMLElement>(
      '[data-testid="chat-input-footer"]',
    );
    expect(card).not.toBeNull();
    expect(footer).not.toBeNull();
    expect(card!.contains(footer!)).toBe(false);
    expect(footer!.textContent).toContain("MODEL-CHIP-STUB");
    expect(card!.textContent).not.toContain("MODEL-CHIP-STUB");
  });

  it("不传 footerSlot 时不渲染空行", async () => {
    await renderInput(undefined);
    expect(
      container.querySelector('[data-testid="chat-input-footer"]'),
    ).toBeNull();
  });
});

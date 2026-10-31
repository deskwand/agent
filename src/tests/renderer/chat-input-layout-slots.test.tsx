// @vitest-environment jsdom
//
// 录音条（topSlot）与卡内单行的结构约定：
//   - 录音条必须在**卡片内**、编辑器**上方**（在卡外等于把它丢进消息区）；
//   - 左簇 / 编辑器 / 发送键必须是**同一行**的三个兄弟，且编辑器能伸缩。
//
// jsdom 没有布局引擎，钉不了像素；能钉的是结构与 class token。像素结论见
// design-docs/2026-10-29-composer-mockup/mockup.html 的 Chromium 实测。

import { readFileSync } from "node:fs";
import { join } from "node:path";
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

async function renderInput(props: Record<string, unknown> = {}) {
  await act(async () => {
    root.render(
      React.createElement(ChatInput, {
        draftKey: "input-slots-test",
        onSubmit: () => {},
        onContentChange: () => {},
        placeholder: "Message",
        cardClassName: "card-under-test",
        textareaClassName: "",
        bottomSlot: null,
        ...props,
      }),
    );
  });
}

describe("录音条槽位", () => {
  it("渲染在卡内、编辑器之前", async () => {
    await renderInput({ topSlot: <span>RECORDING-STRIP-STUB</span> });

    const card = container.querySelector<HTMLElement>(
      '[data-testid="chat-input-card"]',
    )!;
    const top = container.querySelector<HTMLElement>(
      '[data-testid="chat-input-top"]',
    )!;
    const editor = container.querySelector<HTMLElement>(".chat-editor")!;

    expect(card.contains(top)).toBe(true);
    expect(top.textContent).toContain("RECORDING-STRIP-STUB");
    // DOM 顺序即视觉顺序（两者都是普通流块级子节点）
    expect(
      top.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("不传 topSlot 时不渲染空行", async () => {
    await renderInput();

    expect(
      container.querySelector('[data-testid="chat-input-top"]'),
    ).toBeNull();
  });
});

describe("卡内单行布局", () => {
  it("左簇、编辑器、底栏是同一个 flex 行的三个兄弟", async () => {
    await renderInput({
      leadingSlot: <span data-testid="leading-stub">+</span>,
      bottomSlot: <span data-testid="send-stub">↑</span>,
    });

    const editor = container.querySelector<HTMLElement>(".chat-editor")!;
    const row = editor.parentElement!;
    expect(row.className).toContain("flex");
    expect(row.className).toContain("items-end");
    expect(
      row.contains(container.querySelector('[data-testid="leading-stub"]')),
    ).toBe(true);
    expect(
      row.contains(container.querySelector('[data-testid="send-stub"]')),
    ).toBe(true);
    // 编辑器必须能伸缩，否则窄 pane 下它会把发送键挤出去
    expect(editor.className).toContain("flex-1");
    expect(editor.className).toContain("min-w-0");
    // 分屏可拖到 15% 宽（MIN_RATIO）。那时编辑器放不下 96px 就该整体换行 ——
    // 只写 min-w-0 的话它会被压成 0 宽，打字时看不见自己写的字。
    expect(row.className).toContain("flex-wrap");
    expect(editor.className).toContain("basis-24");
  });

  it("不传 leadingSlot 时那一行仍然只有编辑器与发送键", async () => {
    await renderInput({ bottomSlot: <span data-testid="send-stub">↑</span> });

    const editor = container.querySelector<HTMLElement>(".chat-editor")!;
    const row = editor.parentElement!;
    expect(row.children).toHaveLength(2);
    expect(row.lastElementChild?.getAttribute("data-testid")).toBe("send-stub");
  });
});

describe("两个聊天宿主都接上了新槽位", () => {
  // 这两个宿主自己的测试套件目前因为 i18n 桩的老问题整体加载不起来（既有故障），
  // 而漏传 slot 在结构测试里看不出来 —— 于是按源码钉一条，改坏了立刻红。
  const read = (file: string) =>
    readFileSync(join(process.cwd(), "src/renderer/components", file), "utf-8");

  it.each(["ChatView.tsx", "WelcomeView.tsx"])(
    "%s 同时传了 leadingSlot 与 topSlot",
    (file) => {
      const source = read(file);
      expect(source).toContain("<ChatInputActionBar");
      expect(source).toContain("leadingSlot={");
      expect(source).toContain("topSlot={");
      expect(source).toContain("shouldShowRecordingStrip(voice.status)");
    },
  );
});

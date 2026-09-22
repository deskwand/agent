// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatInput } from "../../renderer/components/ChatInput";

vi.mock("react-i18next", () => ({
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

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function renderInput() {
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
}

function editorEl(): HTMLElement {
  return container.querySelector<HTMLElement>("[data-placeholder]")!;
}

/**
 * 在编辑器的指定字符位置「打一个 /」。
 *
 * caret 是插入后斜杠所在的 1-based 位置（caret=1 表示文本开头）。
 * 先把前缀写进编辑器并派发 input，再把光标放到插入点、派发 keydown 设触发标记，
 * 最后插入斜杠并派发 input —— 与真实按键顺序一致。
 */
async function typeSlashAt(caret: number, prefix: string) {
  const el = editorEl();
  const setCaret = (offset: number) => {
    const range = document.createRange();
    range.setStart(el.firstChild ?? el, offset);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
  };

  await act(async () => {
    el.focus();
    el.textContent = prefix;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });

  await act(async () => {
    setCaret(caret - 1);
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true }));
    el.textContent = `${prefix.slice(0, caret - 1)}/${prefix.slice(caret - 1)}`;
    setCaret(caret);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("slash 菜单触发位置", () => {
  it("在文本开头打 / 会打开菜单", async () => {
    await renderInput();
    await typeSlashAt(1, "");
    expect(container.textContent).toContain("slashAll");
  });

  it("在句中（空格后）打 / 不打开菜单", async () => {
    await renderInput();
    await typeSlashAt(5, "abc ");
    expect(container.textContent).not.toContain("slashAll");
  });
});

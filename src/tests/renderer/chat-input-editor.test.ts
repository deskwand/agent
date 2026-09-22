// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import {
  ChatInput,
  type ChatInputSubmitData,
} from "../../renderer/components/ChatInput";
import { serializeEditor } from "../../renderer/utils/editor-content";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../renderer/hooks/useIPC", () => ({
  useIPC: () => ({ isElectron: false }),
}));

let container: HTMLDivElement;
let root: Root;
let onSubmit: Mock<(data: ChatInputSubmitData) => void>;

beforeEach(() => {
  localStorage.clear();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  onSubmit = vi.fn<(data: ChatInputSubmitData) => void>();
  // jsdom 定义了 document.execCommand 但一调用就抛 "Not implemented"。
  // 真实 Electron 里它是可用的（换行/粘贴插入都靠它保留原生撤销栈）。
  document.execCommand = vi.fn(
    () => true,
  ) as unknown as typeof document.execCommand;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function renderInput(props: Record<string, unknown> = {}) {
  await act(async () => {
    root.render(
      React.createElement(ChatInput, {
        draftKey: "test-session",
        onSubmit,
        placeholder: "写点什么",
        cardClassName: "",
        textareaClassName: "",
        bottomSlot: null,
        ...props,
      }),
    );
  });
}

function editorEl(): HTMLElement {
  const el = container.querySelector<HTMLElement>("[data-placeholder]");
  if (!el) throw new Error("找不到编辑器元素");
  return el;
}

/** 往编辑器里输入纯文本，模拟浏览器行为（写 DOM 后派发 input）。 */
async function typeText(text: string) {
  const el = editorEl();
  await act(async () => {
    el.textContent = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("ChatInput 编辑器元素", () => {
  it("渲染的是 contenteditable 的 div，不再是 textarea", async () => {
    await renderInput();
    expect(container.querySelector("textarea")).toBeNull();
    const el = editorEl();
    expect(el.getAttribute("contenteditable")).toBe("true");
    expect(el.getAttribute("role")).toBe("textbox");
    expect(el.getAttribute("data-placeholder")).toBe("写点什么");
  });

  it("输入同步到 state 后可以提交", async () => {
    await renderInput();
    await typeText("帮我改下间距");
    await act(async () => {
      editorEl().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].text).toBe("帮我改下间距");
  });

  it("Shift+Enter 插入换行而不是提交", async () => {
    await renderInput();
    await typeText("第一行");
    await act(async () => {
      editorEl().dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          shiftKey: true,
          bubbles: true,
        }),
      );
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("disabled 时不可编辑", async () => {
    await renderInput({ disabled: true });
    expect(editorEl().getAttribute("contenteditable")).toBe("false");
  });

  it("序列化结果与输入一致", async () => {
    await renderInput();
    await typeText("纯文本");
    expect(serializeEditor(editorEl())).toBe("纯文本");
  });
});

// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChatInput,
  type ChatInputHandle,
} from "../../renderer/components/ChatInput";
import {
  getCaretOffset,
  serializeEditor,
  TOKEN_RAW_ATTR,
} from "../../renderer/utils/editor-content";
import { useAppStore } from "../../renderer/store";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../renderer/hooks/useIPC", () => ({
  useIPC: () => ({ isElectron: false }),
}));

let container: HTMLDivElement;
let root: Root;
let ref: React.RefObject<ChatInputHandle>;

beforeEach(() => {
  localStorage.clear();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  ref = React.createRef<ChatInputHandle>();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function editorEl(): HTMLElement {
  return container.querySelector<HTMLElement>("[data-placeholder]")!;
}

async function renderInput() {
  await act(async () => {
    root.render(
      React.createElement(ChatInput, {
        draftKey: "test-session",
        ref,
        onSubmit: () => {},
        placeholder: "p",
        cardClassName: "",
        textareaClassName: "",
        bottomSlot: null,
      }),
    );
  });
}

describe("显式写入路径", () => {
  it("setPrompt 写入含引用的文本时会渲染成 token（外部写进来的也要 parse）", async () => {
    await renderInput();
    await act(async () => {
      ref.current?.setPrompt("/skill:alpha 你好");
    });
    const token = editorEl().querySelector(`[${TOKEN_RAW_ATTR}]`);
    expect(token).not.toBeNull();
    expect(token!.getAttribute(TOKEN_RAW_ATTR)).toBe("/skill:alpha");
    expect(serializeEditor(editorEl())).toBe("/skill:alpha 你好");
  });

  it("clear 清空编辑器", async () => {
    await renderInput();
    await act(async () => {
      ref.current?.setPrompt("/skill:alpha 你好");
    });
    await act(async () => {
      ref.current?.clear();
    });
    expect(serializeEditor(editorEl())).toBe("");
    expect(ref.current?.isEmpty()).toBe(true);
  });

  it("pendingEditorText 写入后渲染 token 且被消费掉", async () => {
    await renderInput();
    await act(async () => {
      useAppStore.getState().setPendingEditorText("/skill:alpha 收到");
    });
    expect(editorEl().querySelector(`[${TOKEN_RAW_ATTR}]`)).not.toBeNull();
    expect(useAppStore.getState().pendingEditorText).toBeNull();
  });

  it("在 token 之前粘贴文字后，token 退化为纯文本", async () => {
    await renderInput();
    await act(async () => {
      ref.current?.setPrompt("/skill:alpha 你好");
    });
    const el = editorEl();
    await act(async () => {
      el.insertBefore(document.createTextNode("注意 "), el.firstChild);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(el.querySelector(`[${TOKEN_RAW_ATTR}]`)).toBeNull();
    expect(serializeEditor(el)).toBe("注意 /skill:alpha 你好");
  });
});

/** 等一帧：insertCommandChip 的文末光标落在 requestAnimationFrame 里。 */
async function flushFrame() {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
}

describe("insertCommandChip", () => {
  it("空草稿时插入命令 chip，光标落文末", async () => {
    await renderInput();
    await act(async () => {
      ref.current?.insertCommandChip("goal");
    });
    await flushFrame();

    const token = editorEl().querySelector(`[${TOKEN_RAW_ATTR}]`);
    expect(token).not.toBeNull();
    expect(token!.getAttribute(TOKEN_RAW_ATTR)).toBe("/goal");
    expect(serializeEditor(editorEl())).toBe("/goal ");
    expect(getCaretOffset(editorEl())).toBe("/goal ".length);
  });

  it("草稿非空时整体留在 chip 之后当目标描述", async () => {
    await renderInput();
    await act(async () => {
      ref.current?.setPrompt("重构登录模块");
    });
    await act(async () => {
      ref.current?.insertCommandChip("goal");
    });
    await flushFrame();

    expect(
      editorEl()
        .querySelector(`[${TOKEN_RAW_ATTR}]`)!
        .getAttribute(TOKEN_RAW_ATTR),
    ).toBe("/goal");
    expect(serializeEditor(editorEl())).toBe("/goal 重构登录模块");
    expect(getCaretOffset(editorEl())).toBe("/goal 重构登录模块".length);
  });

  it("行首已是同一条命令时不再叠加", async () => {
    await renderInput();
    await act(async () => {
      ref.current?.setPrompt("/goal 已经设好的目标");
    });
    await act(async () => {
      ref.current?.insertCommandChip("goal");
    });
    expect(serializeEditor(editorEl())).toBe("/goal 已经设好的目标");
  });

  it("命令后面直接换行时也不叠加", async () => {
    await renderInput();
    await act(async () => {
      ref.current?.setPrompt("/goal\n继续做别的事");
    });
    await act(async () => {
      ref.current?.insertCommandChip("goal");
    });
    expect(serializeEditor(editorEl())).toBe("/goal\n继续做别的事");
  });

  it("不叠加的那次点击仍把焦点与光标交回输入框", async () => {
    await renderInput();
    await act(async () => {
      ref.current?.setPrompt("/goal 已经设好的目标");
    });
    await act(async () => {
      ref.current?.insertCommandChip("goal");
    });
    await flushFrame();

    expect(document.activeElement).toBe(editorEl());
    expect(getCaretOffset(editorEl())).toBe("/goal 已经设好的目标".length);
  });
});

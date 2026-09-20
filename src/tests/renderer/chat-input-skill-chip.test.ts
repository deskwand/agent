// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChatInput,
  type ChatInputHandle,
} from "../../renderer/components/ChatInput";
import {
  serializeEditor,
  TOKEN_RAW_ATTR,
} from "../../renderer/utils/editor-content";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../renderer/hooks/useIPC", () => ({
  useIPC: () => ({ isElectron: true }),
}));

let container: HTMLDivElement;
let root: Root;
let inputRef: React.RefObject<ChatInputHandle>;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  (window as unknown as { electronAPI?: unknown }).electronAPI = {
    skills: { getAll: () => Promise.resolve([]) },
    piCommands: { list: () => Promise.resolve({ commands: [] }) },
    on: () => () => {},
  };
  inputRef = React.createRef<ChatInputHandle>();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
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
        ref: inputRef,
        onSubmit: () => {},
        placeholder: "p",
        cardClassName: "",
        textareaClassName: "",
        bottomSlot: null,
      }),
    );
  });
}

describe("insertSkillChip", () => {
  it("行首插入技能令牌，渲染成原子 token", async () => {
    await renderInput();
    await act(async () => inputRef.current!.insertSkillChip("pdf"));

    const token = editorEl().querySelector(`[${TOKEN_RAW_ATTR}]`);
    expect(token).not.toBeNull();
    expect(token!.getAttribute(TOKEN_RAW_ATTR)).toBe("/skill:pdf");
    expect(serializeEditor(editorEl())).toBe("/skill:pdf ");
  });

  it("原草稿整体保留在令牌之后", async () => {
    await renderInput();
    await act(async () => inputRef.current!.setPrompt("读一下这份"));
    await act(async () => inputRef.current!.insertSkillChip("pdf"));
    expect(serializeEditor(editorEl())).toBe("/skill:pdf 读一下这份");
  });

  it("连点两次不叠加 —— 叠加会渲染出两个令牌", async () => {
    await renderInput();
    await act(async () => inputRef.current!.insertSkillChip("pdf"));
    await act(async () => inputRef.current!.insertSkillChip("pdf"));
    expect(serializeEditor(editorEl())).toBe("/skill:pdf ");
    expect(editorEl().querySelectorAll(`[${TOKEN_RAW_ATTR}]`).length).toBe(1);
  });

  it("技能名里的正则元字符不会误判 —— `a.b` 不得匹配 `axb`", async () => {
    await renderInput();
    // 草稿里已有 `/skill:axb `。若名字未转义，拼出的 `^/skill:a.b(\s|$)` 会因为
    // `.` 匹配任意字符而认为 `a.b` 已经就位，这次点击被静默丢弃。
    await act(async () => inputRef.current!.setPrompt("/skill:axb "));
    await act(async () => inputRef.current!.insertSkillChip("a.b"));
    expect(serializeEditor(editorEl())).toContain("/skill:a.b");
  });

  it("技能名里的 `[` 不会让点击抛异常", async () => {
    await renderInput();
    await expect(
      act(async () => inputRef.current!.insertSkillChip("[x")),
    ).resolves.not.toThrow();
    expect(serializeEditor(editorEl())).toContain("[x");
  });
});

describe("appendPromptExample", () => {
  it("草稿为空时直接填入", async () => {
    await renderInput();
    await act(async () => inputRef.current!.appendPromptExample("打开某网页"));
    expect(serializeEditor(editorEl())).toBe("打开某网页");
  });

  it("草稿非空时追加，绝不覆盖用户已输入的文字", async () => {
    await renderInput();
    await act(async () => inputRef.current!.setPrompt("我的需求"));
    await act(async () => inputRef.current!.appendPromptExample("打开某网页"));
    expect(serializeEditor(editorEl())).toContain("我的需求");
    expect(serializeEditor(editorEl())).toContain("打开某网页");
  });
});

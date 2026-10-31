// @vitest-environment jsdom
//
// 注意：jsdom 没有布局引擎，本文件只能验证「行为」（有内容才渲染、展开态保留、
// 渲染在左 cluster、ChatInput → 底栏整链路出现/消失）。「显隐不产生位移」这类像素
// 结论由 design-docs/2026-09-14-expand-button-visibility-probe*.html 的 Chromium 实测覆盖。

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChatInput,
  hasInputContent,
  type ChatInputHandle,
} from "../../renderer/components/ChatInput";
import { ChatInputActionBar } from "../../renderer/components/ChatInputActionBar";
import {
  ChatInputBottomBar,
  shouldShowExpandButton,
} from "../../renderer/components/ChatInputBottomBar";

vi.mock("react-i18next", () => ({
  // 底栏现在会经 StatusPopover → utils/i18n-format → i18n/config 间接引用这个插件，
  // 整模块 mock 必须补上占位，否则配置模块在 import 期就抛错。
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));

// isElectron 需要按用例切换（附件选择路径要求 true），因此经 hoisted 的可控 mock 暴露。
const { useIPCMock } = vi.hoisted(() => ({
  useIPCMock: vi.fn(() => ({ isElectron: false })),
}));

vi.mock("../../renderer/hooks/useIPC", () => ({
  useIPC: () => useIPCMock(),
}));

type BarProps = React.ComponentProps<typeof ChatInputBottomBar>;

/** 右簇（展开 + 麦克风 + 发送）除「随内容变化的两个 prop」之外的必填/可选 prop。 */
const baseBarProps: Omit<BarProps, "hasInputContent" | "onToggleExpand"> = {
  canStop: false,
  onStop: () => {},
  isSubmitting: false,
  voice: { status: "idle", onToggle: () => {} },
};

/** 左簇（仅附件）不变的那几项；单测右簇时只用来占位。 */
const leadBarProps: React.ComponentProps<typeof ChatInputActionBar> = {
  onAttach: () => {},
  onAddFiles: () => {},
  attachedKeys: new Set<string>(),
};

/**
 * 往编辑器里「打字」。
 *
 * 编辑器是非受控 contenteditable：直接写 DOM 再派发 input 就是它真实的输入路径。
 * （改之前那套「绕 React value tracker」是受控 textarea 特有的麻烦，现在不需要了。）
 */
function typeInto(editor: HTMLElement, value: string) {
  editor.textContent = value;
  editor.dispatchEvent(new Event("input", { bubbles: true }));
}

function editorEl(): HTMLElement {
  return container.querySelector<HTMLElement>("[data-placeholder]")!;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  useIPCMock.mockReturnValue({ isElectron: false });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

async function renderInput(onContentChange: (hasContent: boolean) => void) {
  const ref = React.createRef<ChatInputHandle>();
  await act(async () => {
    root.render(
      React.createElement(ChatInput, {
        draftKey: "test-session",
        ref,
        onSubmit: () => {},
        onContentChange,
        placeholder: "Message",
        cardClassName: "",
        textareaClassName: "",
        bottomSlot: null,
      }),
    );
  });
  return ref;
}

function expandButton(): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(
    'button[aria-label="chat.expandInput"]',
  );
}

describe("hasInputContent", () => {
  it("treats blank text without attachments as empty", () => {
    expect(hasInputContent("", 0, 0)).toBe(false);
    expect(hasInputContent("   \n", 0, 0)).toBe(false);
  });

  it("treats text as content", () => {
    expect(hasInputContent("a", 0, 0)).toBe(true);
  });

  it("treats a pasted image as content even without text", () => {
    expect(hasInputContent("", 1, 0)).toBe(true);
  });

  it("treats an attached file as content even without text", () => {
    expect(hasInputContent("", 0, 1)).toBe(true);
  });

  it("只有技能令牌不算内容 —— 没有需求就不该能发", () => {
    expect(hasInputContent("/skill:pdf", 0, 0)).toBe(false);
    expect(hasInputContent("/skill:pdf   ", 0, 0)).toBe(false);
  });

  it("技能令牌之后有正文就算内容", () => {
    expect(hasInputContent("/skill:pdf 读一下这份", 0, 0)).toBe(true);
  });

  it("技能令牌 + 附件算内容 —— 门禁不得过度拦截", () => {
    expect(hasInputContent("/skill:pdf", 1, 0)).toBe(true);
    expect(hasInputContent("/skill:pdf", 0, 1)).toBe(true);
  });

  it("命令令牌单独发仍然合法", () => {
    expect(hasInputContent("/goal", 0, 0)).toBe(true);
    expect(hasInputContent("/compact", 0, 0)).toBe(true);
  });
});

describe("ChatInput content reporting", () => {
  it("reports false on mount", async () => {
    const onContentChange = vi.fn();
    await renderInput(onContentChange);

    expect(onContentChange).toHaveBeenCalledTimes(1);
    expect(onContentChange).toHaveBeenLastCalledWith(false);
  });

  it("reports true once text is entered and false again after clearing", async () => {
    const onContentChange = vi.fn();
    await renderInput(onContentChange);
    const editor = editorEl();

    await act(async () => {
      typeInto(editor, "draft");
    });
    expect(editor.textContent).toBe("draft");
    expect(onContentChange).toHaveBeenCalledTimes(2);
    expect(onContentChange).toHaveBeenLastCalledWith(true);

    await act(async () => {
      typeInto(editor, "");
    });
    expect(onContentChange).toHaveBeenCalledTimes(3);
    expect(onContentChange).toHaveBeenLastCalledWith(false);
  });

  it("reports true when the prompt is written through the imperative handle", async () => {
    const onContentChange = vi.fn();
    const ref = await renderInput(onContentChange);

    await act(async () => {
      ref.current?.setPrompt("x");
    });

    expect(onContentChange).toHaveBeenCalledTimes(2);
    expect(onContentChange).toHaveBeenLastCalledWith(true);
  });

  it("reports true for an attached file only, and false again after clear()", async () => {
    const onContentChange = vi.fn();
    useIPCMock.mockReturnValue({ isElectron: true });
    window.electronAPI = {
      selectFiles: vi.fn(async () => ["/tmp/report.pdf"]),
    } as unknown as typeof window.electronAPI;

    const ref = await renderInput(onContentChange);
    expect(onContentChange).toHaveBeenLastCalledWith(false);

    await act(async () => {
      ref.current?.selectFiles();
      // handleFileSelect 是 async 的（await window.electronAPI.selectFiles()），
      // 让出一次微任务，状态与上报 effect 才会在本轮 act 内落地。
      await Promise.resolve();
    });
    expect(onContentChange).toHaveBeenLastCalledWith(true);
    expect(container.textContent).toContain("report.pdf");

    await act(async () => {
      ref.current?.clear();
    });
    expect(onContentChange).toHaveBeenLastCalledWith(false);
  });
});

describe("shouldShowExpandButton", () => {
  it("hides the button for an empty, collapsed input", () => {
    expect(shouldShowExpandButton(false, false)).toBe(false);
  });

  it("shows the button as soon as there is content", () => {
    expect(shouldShowExpandButton(false, true)).toBe(true);
  });

  it("keeps the button visible while expanded, even after the draft is cleared", () => {
    expect(shouldShowExpandButton(true, false)).toBe(true);
    expect(shouldShowExpandButton(true, true)).toBe(true);
  });
});

describe("展开按钮（右簇）", () => {
  async function renderBar(props: Partial<BarProps>): Promise<void> {
    await act(async () => {
      root.render(
        React.createElement(ChatInputBottomBar, {
          ...baseBarProps,
          onToggleExpand: () => {},
          hasInputContent: false,
          ...props,
        }),
      );
    });
  }

  it("没有内容时不新增节点：那一格用 invisible 占着", async () => {
    await renderBar({ hasInputContent: false });

    const button = expandButton();
    // 关键：元素在，只是看不见 —— 条件渲染的版本一出现就会推动编辑器与发送键
    expect(button).not.toBeNull();
    expect(button!.className).toContain("invisible");
    // 右簇永远是「展开 + 麦克风 + 发送」三颗按钮，空态也一样
    expect(container.querySelectorAll("button")).toHaveLength(3);
  });

  it("有内容后是同一颗按钮原地变可见", async () => {
    await renderBar({ hasInputContent: false });
    const before = expandButton()!;

    await renderBar({ hasInputContent: true });
    const after = expandButton()!;

    expect(after).toBe(before); // 同一个 DOM 节点：没有卸载重建，也就没有位移
    expect(after.className).not.toContain("invisible");
  });

  it("与麦克风、发送键同处右簇，顺序是 展开 → 麦克风 → 发送", async () => {
    await renderBar({ hasInputContent: true });

    const button = expandButton()!;
    const send = container.querySelector('button[type="submit"]')!;
    const mic = container.querySelector<HTMLElement>(
      '[aria-label="chat.voiceStart"]',
    )!;
    const trail = button.parentElement!;
    // 同一个父节点 = 同一个右簇容器
    expect(trail).toBe(send.parentElement);
    expect(trail.contains(mic)).toBe(true);
    // 展开在最前：它显隐只改自己那格，不推走麦克风与发送键
    expect(trail.firstElementChild).toBe(button);
    // DOM 顺序 = 视觉顺序（麦克风外面包了一层容器，所以比 aria-label 而不是 nextElementSibling）
    expect(
      [...trail.querySelectorAll("button")].map((b) =>
        b.getAttribute("aria-label"),
      ),
    ).toEqual(["chat.expandInput", "chat.voiceStart", "chat.sendMessage"]);
  });

  it("keeps the button while expanded without content", async () => {
    await renderBar({ hasInputContent: false, isExpanded: true });

    expect(
      container.querySelector('button[aria-label="chat.collapseInput"]'),
    ).not.toBeNull();
  });

  it("renders no expand button when onToggleExpand is absent", async () => {
    await renderBar({ hasInputContent: true, onToggleExpand: undefined });

    expect(expandButton()).toBeNull();
  });
});

describe("打字时零位移（ChatInput → 右簇 整链路）", () => {
  function Harness() {
    const [hasInputContent, setHasInputContent] = React.useState(false);
    return React.createElement(ChatInput, {
      draftKey: "test-session",
      onSubmit: () => {},
      onContentChange: setHasInputContent,
      placeholder: "Message",
      cardClassName: "",
      textareaClassName: "",
      leadingSlot: React.createElement(ChatInputActionBar, leadBarProps),
      bottomSlot: React.createElement(ChatInputBottomBar, {
        ...baseBarProps,
        onToggleExpand: () => {},
        hasInputContent,
      }),
    });
  }

  it("打字第一帧不新增节点、不换元素（这才是「零位移」的可测形式）", async () => {
    await act(async () => {
      root.render(React.createElement(Harness));
    });
    const buttonCount = container.querySelectorAll("button").length;
    // 空态它就在，只是看不见
    const expand = expandButton()!;
    expect(expand.className).toContain("invisible");

    await act(async () => {
      typeInto(editorEl(), "x");
    });

    expect(container.querySelectorAll("button").length).toBe(buttonCount);
    expect(expandButton()).toBe(expand);
    expect(expandButton()!.className).not.toContain("invisible");
  });

  it("删字后回到隐形，节点仍是同一颗", async () => {
    await act(async () => {
      root.render(React.createElement(Harness));
    });
    const editor = editorEl();
    const buttonCount = container.querySelectorAll("button").length;
    const expand = expandButton()!;

    await act(async () => {
      typeInto(editor, "x");
    });
    expect(expandButton()!.className).not.toContain("invisible");

    await act(async () => {
      typeInto(editor, "");
    });

    expect(expandButton()).toBe(expand);
    expect(expandButton()!.className).toContain("invisible");
    expect(container.querySelectorAll("button").length).toBe(buttonCount);
  });
});

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

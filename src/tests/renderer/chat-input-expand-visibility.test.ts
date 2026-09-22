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
import {
  ChatInputBottomBar,
  shouldShowExpandButton,
  type ModelOptionGroup,
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

const modelOptions: ModelOptionGroup[] = [
  {
    profileKey: "profile-a" as never,
    groupLabel: "Provider A",
    items: [{ id: "model-1", name: "Model One" }],
  },
];

/** 底栏除「随内容变化的两个 prop」之外的必填/可选 prop。 */
const baseBarProps: Omit<BarProps, "hasInputContent" | "onToggleExpand"> = {
  onAttach: () => {},
  onAddFiles: () => {},
  attachedKeys: new Set<string>(),
  model: "model-1",
  modelOptions,
  activeProviderProfileKey: "profile-a" as never,
  onSelectModel: () => {},
  thinkingLevel: "medium" as never,
  thinkingLevelOptions: ["off", "medium"] as never[],
  onSelectThinkingLevel: () => {},
  contextUsagePercentage: 0,
  contextRingColorClass: "",
  contextStatusDetails: {
    usedLabel: "0",
    totalLabel: "0",
    cacheHitRate: "--",
  },
  canStop: false,
  onStop: () => {},
  isSubmitting: false,
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

/** 附件菜单的触发按钮（左 cluster 里那个 +）。用的就是它自己的 data 属性。 */
function attachButton(): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>("[data-attach-trigger]");
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

describe("ChatInputBottomBar expand button", () => {
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

  it("renders no expand button when there is no content", async () => {
    await renderBar({ hasInputContent: false });

    expect(expandButton()).toBeNull();
    // 附件按钮仍在。jsdom 没有布局引擎，这里证明不了「没有空档」——
    // 空档的有无由 §4.1 的 Chromium 探针负责（条件渲染本身不会留占位）。
    expect(attachButton()).not.toBeNull();
  });

  it("renders the expand button in the left cluster once there is content", async () => {
    await renderBar({ hasInputContent: true });

    const button = expandButton();
    expect(button).not.toBeNull();
    // 与附件触发按钮同处一个 div，且不在含发送键的那个 cluster 里。
    // 不写死 class 字符串：左 cluster 加 shrink-0 / min-w-0 之类仍应通过。
    const group = button!.closest("div")!;
    expect(group.contains(attachButton())).toBe(true);
    expect(
      group.contains(container.querySelector('button[type="submit"]')),
    ).toBe(false);
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

describe("有内容才显示展开按钮（ChatInput → 底栏 整链路）", () => {
  function Harness() {
    const [hasInputContent, setHasInputContent] = React.useState(false);
    return React.createElement(ChatInput, {
      draftKey: "test-session",
      onSubmit: () => {},
      onContentChange: setHasInputContent,
      placeholder: "Message",
      cardClassName: "",
      textareaClassName: "",
      bottomSlot: React.createElement(ChatInputBottomBar, {
        ...baseBarProps,
        onToggleExpand: () => {},
        hasInputContent,
      }),
    });
  }

  it("adds the expand button when the first character is typed", async () => {
    await act(async () => {
      root.render(React.createElement(Harness));
    });
    expect(expandButton()).toBeNull();

    await act(async () => {
      typeInto(editorEl(), "x");
    });

    expect(expandButton()).not.toBeNull();
  });

  it("removes the expand button again when the text is deleted", async () => {
    await act(async () => {
      root.render(React.createElement(Harness));
    });
    const editor = editorEl();

    await act(async () => {
      typeInto(editor, "x");
    });
    expect(expandButton()).not.toBeNull();

    await act(async () => {
      typeInto(editor, "");
    });

    expect(expandButton()).toBeNull();
  });
});

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

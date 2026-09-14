// @vitest-environment jsdom

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
  contextUsageTooltip: "",
  canStop: false,
  onStop: () => {},
  isSubmitting: false,
};

/**
 * 往 textarea 里「打字」。
 *
 * 不能用 `textarea.value = x` 直接赋值：React 的 value tracker 会同步记住这个值，
 * 随后派发的原生 input 事件会被判定为「没变化」，onChange 不触发。
 * 走原型上的原生 setter 写入，tracker 仍停在旧值，React 才会正常派发 onChange。
 */
function typeInto(textarea: HTMLTextAreaElement, value: string) {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )!.set!;
  nativeSetter.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
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

/** 展开按钮的外层槽位：button → span.tt-anchor → div。展开态下按钮换了 aria-label。 */
function expandSlot(label = "chat.expandInput"): HTMLElement {
  const button = container.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
  return button!.closest("div")!;
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
    const textarea = container.querySelector<HTMLTextAreaElement>("textarea")!;

    await act(async () => {
      typeInto(textarea, "draft");
    });
    expect(textarea.value).toBe("draft");
    expect(onContentChange).toHaveBeenCalledTimes(2);
    expect(onContentChange).toHaveBeenLastCalledWith(true);

    await act(async () => {
      typeInto(textarea, "");
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

  it("keeps the slot reserved but hidden when there is no content", async () => {
    await renderBar({ hasInputContent: false });

    expect(expandButton()).not.toBeNull();
    expect(expandSlot().className).toContain("invisible");
  });

  it("reuses the same slot node when the content appears, so nothing moves", async () => {
    await renderBar({ hasInputContent: false });
    const slot = expandSlot();
    expect(slot.className).toContain("invisible");

    await renderBar({ hasInputContent: true });

    expect(expandSlot()).toBe(slot);
    expect(slot.className).not.toContain("invisible");
  });

  it("keeps the button visible while expanded without content", async () => {
    await renderBar({ hasInputContent: false, isExpanded: true });

    expect(
      container.querySelector('button[aria-label="chat.collapseInput"]'),
    ).not.toBeNull();
    expect(expandSlot("chat.collapseInput").className).not.toContain(
      "invisible",
    );
  });

  it("remounts the tooltip subtree when hidden, so a stale bubble cannot linger", async () => {
    await renderBar({ hasInputContent: true });
    // 展开按钮的 tt-anchor（不要用 container.querySelector(".tt-anchor")，那是附件 + 按钮的）
    const anchorBefore = expandButton()!.parentElement;
    expect(anchorBefore!.className).toContain("tt-anchor");

    await renderBar({ hasInputContent: false });

    // 槽位（wrapper）保持同一节点 → 布局不动；Tooltip 子树重挂载 → 它内部的 open 状态被销毁
    expect(expandSlot().className).toContain("invisible");
    expect(expandButton()!.parentElement).not.toBe(anchorBefore);
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

  it("reveals the reserved slot in place when the first character is typed", async () => {
    await act(async () => {
      root.render(React.createElement(Harness));
    });
    const slot = expandSlot();
    expect(slot.className).toContain("invisible");

    await act(async () => {
      typeInto(container.querySelector<HTMLTextAreaElement>("textarea")!, "x");
    });

    expect(expandSlot()).toBe(slot);
    expect(slot.className).not.toContain("invisible");
  });

  it("hides the reserved slot in place again when the text is deleted", async () => {
    await act(async () => {
      root.render(React.createElement(Harness));
    });
    const textarea = container.querySelector<HTMLTextAreaElement>("textarea")!;

    await act(async () => {
      typeInto(textarea, "x");
    });
    const slot = expandSlot();
    expect(slot.className).not.toContain("invisible");

    await act(async () => {
      typeInto(textarea, "");
    });

    expect(expandSlot()).toBe(slot);
    expect(slot.className).toContain("invisible");
  });
});

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

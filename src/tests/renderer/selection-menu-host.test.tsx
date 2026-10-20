// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { SelectionMenuHost } from "../../renderer/components/SelectionMenuHost";
import { useAppStore } from "../../renderer/store";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let prose: HTMLParagraphElement;
const writeText = vi.fn(() => Promise.resolve());

function pressOn(node: Element) {
  act(() => {
    node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  });
}
function release() {
  act(() => {
    document.body.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
}
/** 一块内容面之外的落点（面板把手、按钮）。 */
function handleOutside(): HTMLElement {
  const handle = document.createElement("div");
  handle.className = "resize-handle";
  document.body.appendChild(handle);
  return handle;
}
function placeSelection(node: Node) {
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}
/** 划中一段：按下时选区是空的，松开时才出现 —— 中间的变化就是「在划选」。 */
function selectIn(node: Element) {
  window.getSelection()?.removeAllRanges();
  pressOn(node);
  act(() => placeSelection(node));
  release();
}
const menuEl = () =>
  document.querySelector(
    '[data-testid="selection-menu"]',
  ) as HTMLElement | null;
const itemEl = (id: string) =>
  document.querySelector(
    `[data-testid="selection-menu-item"][data-action="${id}"]`,
  ) as HTMLElement | null;
const itemLabels = () =>
  [...document.querySelectorAll('[data-testid="selection-menu-item"]')].map(
    (el) => el.textContent,
  );

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  container = document.createElement("div");
  document.body.innerHTML = "";
  document.body.appendChild(container);
  prose = document.createElement("p");
  prose.className = "prose-chat";
  prose.textContent = "一段可以被划中的正文";
  document.body.appendChild(prose);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  root = createRoot(container);
  act(() => root.render(<SelectionMenuHost />));
});

afterEach(async () => {
  act(() => window.getSelection()?.removeAllRanges());
  await act(async () => root.unmount());
  container.remove();
  writeText.mockClear();
});

describe("SelectionMenuHost", () => {
  it("划选后出现菜单，且容器挂着 titlebar-no-drag 与 z-[70]", () => {
    selectIn(prose);
    const el = menuEl()!;
    expect(el).not.toBeNull();
    expect(el.className).toContain("titlebar-no-drag");
    expect(el.className).toContain("z-[70]");
  });

  it("这次按下没改选区就不弹（拖面板宽度、拖文件）", () => {
    const handle = handleOutside();
    act(() => placeSelection(prose));
    // 按下与松开之间选区没变，而且按点落在选区所在内容面之外
    pressOn(handle);
    release();
    expect(menuEl()).toBeNull();
  });

  it("菜单开着时拖把手：按下就关，松手不重新弹", () => {
    const handle = handleOutside();
    selectIn(prose);
    expect(menuEl()).not.toBeNull();
    pressOn(handle);
    expect(menuEl()).toBeNull();
    release();
    expect(menuEl()).toBeNull(); // 文本未变，不新开
  });

  it("双击选词的第二次按下不把菜单闪掉", () => {
    selectIn(prose); // 第一对按下/松开：菜单开
    expect(menuEl()).not.toBeNull();
    pressOn(prose); // 第二次按下落在同一个内容面里
    expect(menuEl()).not.toBeNull();
    release();
    expect(menuEl()).not.toBeNull();
  });

  it("禁选骨架里的划选不弹", () => {
    const chrome = document.createElement("div");
    chrome.className = "sidebar-chrome";
    chrome.textContent = "骨架";
    document.body.appendChild(chrome);
    selectIn(chrome);
    expect(menuEl()).toBeNull();
  });

  it("弹层内只剩「复制」", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const p = document.createElement("p");
    p.className = "selectable";
    p.textContent = "配置串";
    dialog.appendChild(p);
    document.body.appendChild(dialog);
    selectIn(p);
    expect(itemLabels()).toEqual(["selectionMenu.copy"]);
  });

  it("点「复制」把原样的选中文本写进剪贴板", () => {
    const pre = document.createElement("pre");
    pre.className = "selectable";
    pre.textContent = "  if (a) {\n    b();\n  }";
    document.body.appendChild(pre);
    selectIn(pre);
    act(() => {
      itemEl("copy")!.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true }),
      );
      itemEl("copy")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(writeText).toHaveBeenCalledWith("  if (a) {\n    b();\n  }");
    expect(menuEl()).toBeNull();
  });

  it("点别处、滚动、Esc 都会关", () => {
    selectIn(prose);
    expect(menuEl()).not.toBeNull();
    pressOn(handleOutside());
    expect(menuEl()).toBeNull();

    selectIn(prose);
    act(() => {
      document.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    expect(menuEl()).toBeNull();

    selectIn(prose);
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(menuEl()).toBeNull();
  });

  it("菜单顺序：朗读这段 / 记一笔灵感 / 引用到输入框 / 复制", () => {
    selectIn(prose);
    expect(itemLabels()).toEqual([
      "selectionMenu.readAloud",
      "selectionMenu.saveIdea",
      "selectionMenu.quote",
      "selectionMenu.copy",
    ]);
  });

  it("点「引用到输入框」把原样文本追加进草稿，并给一条 notice", () => {
    selectIn(prose);
    act(() => {
      itemEl("quote")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(useAppStore.getState().pendingEditorAppend).toBe(prose.textContent);
    expect(useAppStore.getState().globalNotice?.messageKey).toBe(
      "selectionMenu.quoted",
    );
  });

  it("语音模式在跑时朗读项置灰，而不是插进去一起出声", () => {
    act(() => useAppStore.setState({ voiceModeOpen: true }));
    selectIn(prose);
    expect(itemEl("read-aloud")!.hasAttribute("disabled")).toBe(true);
    // 理由不靠原生 title 传（仓库禁止：title-attrs-migration.test.ts），
    // 屏读用户拿到的是禁用态本身 + 可见的标签。
    expect(itemEl("read-aloud")!.hasAttribute("title")).toBe(false);
  });

  it("点「记一笔灵感」带着原样文本打开浮层", () => {
    selectIn(prose);
    act(() => {
      itemEl("save-idea")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(useAppStore.getState().ideaCaptureOpen).toBe(true);
    expect(useAppStore.getState().ideaCaptureSeed).toBe(prose.textContent);
  });

  it("菜单已关、朗读在播时，Esc 仍然能停（那是唯一顺手的停止键）", () => {
    selectIn(prose);
    act(() => {
      itemEl("read-aloud")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(menuEl()).toBeNull(); // 点完菜单就收了
    act(() => useAppStore.getState().setSelectionSpeech({ status: "playing" }));

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(useAppStore.getState().selectionSpeech.status).toBe("idle");
  });

  it("弹层开着时 Esc 不动朗读，只让 Radix 关弹层", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const p = document.createElement("p");
    p.className = "selectable";
    p.textContent = "配置串";
    dialog.appendChild(p);
    document.body.appendChild(dialog);
    selectIn(p);
    act(() => useAppStore.getState().setSelectionSpeech({ status: "playing" }));

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(useAppStore.getState().selectionSpeech.status).toBe("playing");
  });

  it("朗读失败：给一条既有文案的提示，且再点是重试而不是空停", () => {
    act(() => useAppStore.getState().setSelectionSpeech({ status: "error" }));
    expect(useAppStore.getState().globalNotice?.messageKey).toBe(
      "messageCard.readAloudFailed",
    );

    selectIn(prose);
    // error 不算「在播」：标签回到「朗读这段」，而不是「停止朗读」
    expect(itemEl("read-aloud")!.textContent).toBe("selectionMenu.readAloud");

    // 再点一次 = 重新起播。jsdom 里没有 AudioContext，所以它又会立刻落到
    // error —— 看的是「真的又试了一次」：又报了一次错。
    const notice = vi.spyOn(useAppStore.getState(), "setGlobalNotice");
    act(() => {
      itemEl("read-aloud")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(notice).toHaveBeenCalledTimes(1);
    expect(notice.mock.calls[0]?.[0]?.messageKey).toBe(
      "messageCard.readAloudFailed",
    );
    notice.mockRestore();
  });
});

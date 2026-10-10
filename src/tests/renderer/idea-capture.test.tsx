// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupDialogs, setupDialogTest } from "../dialog-test-helpers";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));

// 浮层里有麦克风（Task 11 加的），但这份测试只关心文本路径：
// 语音控制器与引擎都定在"空闲"，让保存按钮可用。
vi.mock("../../renderer/hooks/useVoiceInput", () => ({
  VOICE_MESSAGE_KEYS: new Proxy(
    {},
    { get: (_t, key) => `voice.${String(key)}` },
  ),
  useVoiceInput: () => ({
    status: "idle",
    level: 0,
    seconds: 0,
    polishing: false,
    toggle: vi.fn(),
    cancel: vi.fn(),
  }),
}));

vi.mock("../../renderer/hooks/useVoiceEngine", () => ({
  useVoiceEngine: () => ({
    install: null,
    ensureReady: vi.fn().mockResolvedValue(false),
    confirmOpen: false,
    confirmDownload: vi.fn(),
    cancelDownload: vi.fn(),
  }),
}));

import { IdeaCaptureOverlay } from "../../renderer/components/IdeaCaptureOverlay";
import { useAppStore } from "../../renderer/store";

let view: ReturnType<typeof setupDialogTest>;
const create = vi.fn();
const remove = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  view = setupDialogTest();
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    voice: { onEvent: () => () => undefined },
    ideas: {
      create,
      remove,
      list: vi.fn().mockResolvedValue({ inbox: [], archived: [], skipped: 0 }),
    },
  };
  useAppStore.setState({
    ...useAppStore.getInitialState(),
    ideaCaptureOpen: true,
    activeView: "chat",
    activeSessionId: "s1",
  });
});

afterEach(() => {
  view.teardown();
  cleanupDialogs();
});

/**
 * 受控 textarea：走原型上的原生 setter再派发 input。
 * 直接赋 `.value` 会被 React 的值跟踪器吞掉，变更永远不会进 onChange。
 */
function typeInto(value: string): void {
  const box = document.body.querySelector("textarea")!;
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  act(() => {
    setter?.call(box, value);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** 在 textarea 上按一个键；组合输入态要显式传 `isComposing`。 */
function press(key: string, init: KeyboardEventInit = {}): void {
  const box = document.body.querySelector("textarea")!;
  act(() => {
    box.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  });
}

const saveButton = () => view.buttonByLabel("capture.save");

// 提示走 store，断言 messageKey 而不是中文文案（t 在测试里返回 key）。
const noticeKey = () => useAppStore.getState().globalNotice?.messageKey;

describe("捕获浮层", () => {
  it("Enter 保存，带上来来源", async () => {
    create.mockResolvedValue({ name: "x" });
    await view.render(<IdeaCaptureOverlay />);
    typeInto("一条想法");
    press("Enter");
    await act(async () => {});

    expect(create).toHaveBeenCalledWith({
      content: "一条想法",
      sourceSessionId: "s1",
      sourceView: "chat",
    });
  });

  it("Shift+Enter 换行，不保存", async () => {
    await view.render(<IdeaCaptureOverlay />);
    typeInto("一");
    press("Enter", { shiftKey: true });
    expect(create).not.toHaveBeenCalled();
  });

  it("输入法组合期间的 Enter 不保存", async () => {
    await view.render(<IdeaCaptureOverlay />);
    typeInto("组合中");
    press("Enter", { isComposing: true });
    expect(create).not.toHaveBeenCalled();
  });

  it("keyCode 229（Windows 输入法提交候选词）也不保存", async () => {
    await view.render(<IdeaCaptureOverlay />);
    typeInto("组合中");
    // 实测：Windows 输入法提交候选词的那次 Enter，isComposing 可能已经是 false。
    press("Enter", { keyCode: 229 });
    expect(create).not.toHaveBeenCalled();
  });

  it("空内容与纯空白禁用保存", async () => {
    await view.render(<IdeaCaptureOverlay />);
    expect(saveButton().disabled).toBe(true);
    typeInto("   ");
    expect(saveButton().disabled).toBe(true);
  });

  it("超过 4000 码点禁用保存并提示", async () => {
    await view.render(<IdeaCaptureOverlay />);
    typeInto("字".repeat(4001));
    expect(saveButton().disabled).toBe(true);
    expect(view.shell()?.textContent).toContain("capture.tooLong");
  });

  it("保存失败：浮层不关，正文不丢", async () => {
    create.mockRejectedValue(new Error("IDEA_TOO_LONG"));
    await view.render(<IdeaCaptureOverlay />);
    typeInto("一条想法");
    act(() => saveButton().click());
    await act(async () => {});

    expect(useAppStore.getState().ideaCaptureOpen).toBe(true);
    expect(document.body.querySelector("textarea")?.value).toBe("一条想法");
    expect(noticeKey()).toBe("capture.failed");
  });

  it("成功后关闭并发一条提示（不做撤销）", async () => {
    create.mockResolvedValue({ name: "2026-10-11-1504-x" });
    await view.render(<IdeaCaptureOverlay />);
    typeInto("一条想法");
    act(() => saveButton().click());
    await act(async () => {});

    expect(useAppStore.getState().ideaCaptureOpen).toBe(false);
    // 只报一句「已记到灵感」：新条目就在收件箱第一条，手滑了去列表里删。
    // 不断言 actionRun —— 那个字段不存在（本设计没有往共享原语上加速度）。
    expect(noticeKey()).toBe("capture.saved");
    expect(useAppStore.getState().globalNotice?.actionLabel).toBeUndefined();
  });
});

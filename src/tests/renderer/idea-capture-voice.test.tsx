// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupDialogs, setupDialogTest } from "../dialog-test-helpers";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));

/** 语音控制器与引擎都摸掉：它们要真麦克风与真 IPC，不是这个测试要验的东西。 */
const { voice, cancelMock, toggleMock } = vi.hoisted(() => ({
  voice: { status: "recording" as "idle" | "recording" | "finishing" },
  cancelMock: vi.fn(),
  toggleMock: vi.fn(),
}));

vi.mock("../../renderer/hooks/useVoiceInput", () => ({
  VOICE_MESSAGE_KEYS: new Proxy(
    {},
    { get: (_t, key) => `voice.${String(key)}` },
  ),
  useVoiceInput: () => ({
    status: voice.status,
    level: 0.5,
    seconds: 3,
    polishing: false,
    toggle: toggleMock,
    cancel: cancelMock,
  }),
}));

vi.mock("../../renderer/hooks/useVoiceEngine", () => ({
  useVoiceEngine: () => ({
    install: null,
    ensureReady: vi.fn().mockResolvedValue(true),
    confirmOpen: false,
    confirmDownload: vi.fn(),
    cancelDownload: vi.fn(),
  }),
}));

import { IdeaCaptureOverlay } from "../../renderer/components/IdeaCaptureOverlay";
import { useAppStore } from "../../renderer/store";
import { IDEA_CAPTURE_VOICE_OWNER } from "../../renderer/utils/voice/voice-owner";

let view: ReturnType<typeof setupDialogTest>;

beforeEach(() => {
  vi.clearAllMocks();
  voice.status = "recording";
  view = setupDialogTest();
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    ideas: { create: vi.fn(), list: vi.fn(), remove: vi.fn() },
    voice: { onEvent: () => () => undefined },
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

/** 向 window 派发键盘事件（按住说话就监听在那里）。 */
async function key(
  type: "keydown" | "keyup",
  init: KeyboardEventInit = {},
): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent(type, { bubbles: true, ...init }));
  });
}

/** 开着语音引擎的配置（`enabled` 是按住说话与气泡提示共同的门）。 */
function enableVoiceEngine(shortcut = "AltRight"): void {
  useAppStore.setState({
    appConfig: { voiceEngine: { enabled: true, shortcut } } as never,
  });
}

function pressEscape(): void {
  act(() => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

describe("浮层语音", () => {
  it("录音中保存被禁用", async () => {
    await view.render(<IdeaCaptureOverlay />);
    typeInto("半截转写");
    expect(view.buttonByLabel("capture.save").disabled).toBe(true);
  });

  it("卸载时仍在录音 → 调 cancel，不留悬空麦克风", async () => {
    // 单独建一个 root：afterEach 还要 teardown 一次，重复 unmount 会报警告。
    const ownContainer = document.createElement("div");
    document.body.appendChild(ownContainer);
    const ownRoot = createRoot(ownContainer);
    await act(async () => {
      ownRoot.render(<IdeaCaptureOverlay />);
    });
    act(() => ownRoot.unmount());
    ownContainer.remove();

    expect(cancelMock).toHaveBeenCalled();
  });

  it("录音时占用麦克风，卸载后释放", async () => {
    await view.render(<IdeaCaptureOverlay />);
    expect(useAppStore.getState().voiceInputOwner).toBe(
      IDEA_CAPTURE_VOICE_OWNER,
    );

    view.teardown();
    expect(useAppStore.getState().voiceInputOwner).toBeNull();
  });

  it("别人占着麦克风时，这一格是禁用的", async () => {
    voice.status = "idle";
    useAppStore.setState({ voiceInputOwner: "chat-input" });
    await view.render(<IdeaCaptureOverlay />);

    // 空闲态的麦克风按钮必须点不动，且可访问名报「另一处正在录音」。
    const mic = [...document.body.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "chat.voiceBusyElsewhere",
    );
    expect(mic, "应当有一颗报「另一处正在录音」的按钮").toBeTruthy();
    expect((mic as HTMLButtonElement).disabled).toBe(true);
  });

  it("录音期间的重渲染不许取消录音（依赖数组踩过的坑）", async () => {
    // useVoiceInput 每次渲染都返回新对象；清理函数若依赖它，就会每渲染一次跑一次 ——
    // 而录音时 setLevel / onText 一直在触发渲染，等于刚开录就被自己取消。
    await view.render(<IdeaCaptureOverlay />);
    typeInto("说了一半");
    typeInto("说了一半再改一下");
    expect(cancelMock).not.toHaveBeenCalled();
  });

  it("录音中 Esc 不关浮层（只取消录音）", async () => {
    await view.render(<IdeaCaptureOverlay />);
    pressEscape();
    expect(useAppStore.getState().ideaCaptureOpen).toBe(true);
    expect(view.shell()).toBeTruthy();
  });

  it("空闲时 Esc 正常关闭", async () => {
    voice.status = "idle";
    await view.render(<IdeaCaptureOverlay />);
    pressEscape();
    expect(useAppStore.getState().ideaCaptureOpen).toBe(false);
  });
});

describe("浮层里的按住说话", () => {
  it("按住右 Option 开始录音，松开结束（不只是那颗按钮）", async () => {
    voice.status = "idle";
    enableVoiceEngine();
    await view.render(<IdeaCaptureOverlay />);

    await key("keydown", { code: "AltRight", altKey: true });
    expect(toggleMock, "按住右 Option 应当开始录音").toHaveBeenCalledTimes(1);

    voice.status = "recording"; // 控制器真的开始录了
    await view.render(<IdeaCaptureOverlay />);
    await key("keyup", { code: "AltRight", altKey: false });
    expect(toggleMock, "松开应当停下").toHaveBeenCalledTimes(2);
  });

  it("别人占着麦克风时，按住 Option 不抢麦", async () => {
    voice.status = "idle";
    enableVoiceEngine();
    useAppStore.setState({ voiceInputOwner: "chat-input" });
    await view.render(<IdeaCaptureOverlay />);

    await key("keydown", { code: "AltRight", altKey: true });
    expect(toggleMock).not.toHaveBeenCalled();
  });

  it("引擎没启用时按住 Option 不监听（与气泡提不提这个键同源）", async () => {
    voice.status = "idle";
    enableVoiceEngine();
    useAppStore.setState({
      appConfig: {
        voiceEngine: { enabled: false, shortcut: "AltRight" },
      } as never,
    });
    await view.render(<IdeaCaptureOverlay />);

    await key("keydown", { code: "AltRight", altKey: true });
    expect(toggleMock).not.toHaveBeenCalled();
  });

  it("浮层关着时不监听（否则会和聊天框那一路同时开麦）", async () => {
    voice.status = "idle";
    enableVoiceEngine();
    useAppStore.setState({ ideaCaptureOpen: false });
    await view.render(<IdeaCaptureOverlay />);

    await key("keydown", { code: "AltRight", altKey: true });
    expect(toggleMock).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AskUserVoiceField } from "../../renderer/components/message/AskUserVoiceField";
import { useAppStore } from "../../renderer/store";

const { micMock } = vi.hoisted(() => ({ micMock: { start: vi.fn() } }));
vi.mock("../../renderer/utils/voice/mic-capture", () => ({
  MicError: class MicError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
  startMicCapture: micMock.start,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}|${JSON.stringify(values)}` : key,
  }),
}));

let voice: Record<string, ReturnType<typeof vi.fn>>;
let listeners: Array<(event: unknown) => void>;
let stopCapture: ReturnType<typeof vi.fn>;
let container: HTMLDivElement;
let root: Root;
let latest = "";

/** 派发给所有订阅者 —— 真事件总线是广播，不是只喂最后一个回调（多字段同卡时要能验出串写）。 */
const emit = (event: unknown) => {
  for (const cb of [...listeners]) cb(event);
};

const OWNER = "ask-user:t-1:text:0";

/** 受控宿主：跟卡片一样把文字存在自己这边，再把 value 传下去。 */
function Harness({ interactive = true }: { interactive?: boolean }) {
  const [value, setValue] = useState("");
  return (
    <AskUserVoiceField
      ownerId={OWNER}
      value={value}
      onChange={(text) => {
        latest = text;
        setValue(text);
      }}
      placeholder="请输入"
      interactive={interactive}
    />
  );
}

const input = () => container.querySelector("input") as HTMLInputElement;
const mic = () =>
  [...container.querySelectorAll("button")].find((b) =>
    b.getAttribute("aria-label")?.startsWith("chat.voice"),
  ) as HTMLButtonElement;

/** 受控 input：必须走原生 setter + input 事件，React 才认这次变更（同 ask-user-card.test.tsx）。 */
function typeInto(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  stopCapture = vi.fn();
  listeners = [];
  latest = "";
  voice = {
    start: vi.fn(async () => ({ ok: true, sessionId: "s1" })),
    pushAudio: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    polish: vi.fn(async () => ({ ok: true, text: "整理稿" })),
    install: vi.fn(),
    removeInstall: vi.fn(),
    getInstallState: vi.fn(async () => ({
      phase: "ready",
      percent: 100,
      installed: true,
    })),
    onEvent: vi.fn((cb: (event: unknown) => void) => {
      listeners.push(cb);
      return () => {
        listeners = listeners.filter((fn) => fn !== cb);
      };
    }),
  };
  (window as unknown as { electronAPI: unknown }).electronAPI = { voice };
  micMock.start.mockImplementation(
    async () => ({ stop: stopCapture }) as never,
  );
  useAppStore.setState({
    // appConfig 必须为「已启用」。useVoiceEngine.ensureReady 在「已装」分支返回的是
    // enableVoice()，而它看到 enabled 不为真就去写配置（window.electronAPI.config.save）——
    // 替身没有 config，TypeError 会被它自己的 catch 吃掉、ensureReady 返回 false，
    // 于是 start() 直接回到 idle：录音根本没起来，而失败信息会指向组件。
    appConfig: {
      voiceEngine: { enabled: true, shortcut: "disabled", autoPolish: true },
    } as never,
    voiceInputOwner: null,
    voiceModeOpen: false,
    globalNotice: null,
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  // 下载确认框经 Radix Portal 挂到 document.body（同 confirm-dialog.test.tsx 的清理）。
  document
    .querySelectorAll(
      '[role="alertdialog"], [data-radix-popper-content-wrapper]',
    )
    .forEach((el) => el.remove());
});

const render = (props: { interactive?: boolean } = {}) =>
  act(async () => root.render(<Harness {...props} />));

/** 点麦克风并等 start() 那条 promise 链落地（就绪门 → 采集 → 建会话）。 */
const startRecording = () =>
  act(async () => {
    mic().click();
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });

describe("AskUserVoiceField", () => {
  it("转写写进这个框：快照 + 全量文本", async () => {
    await render();
    await act(async () => typeInto(input(), "已有"));
    await startRecording();

    // partial 是「这一次说的话」，hook 负责在前面接上快照
    await act(async () =>
      emit({ type: "partial", sessionId: "s1", text: "你好" }),
    );

    expect(latest).toBe("已有你好");
  });

  it("超过 2000 字截断（主进程不校验长度）", async () => {
    await render();
    await startRecording();

    await act(async () =>
      emit({ type: "partial", sessionId: "s1", text: "x".repeat(2500) }),
    );

    expect(latest).toHaveLength(2000);
  });

  it("录音中卸载即取消：停采集 + 断会话", async () => {
    await render();
    await startRecording();
    expect(mic().getAttribute("aria-label")).toBe("chat.voiceStop");

    await act(async () => root.unmount());

    expect(stopCapture).toHaveBeenCalled();
    expect(voice.cancel).toHaveBeenCalledWith("s1");
    expect(useAppStore.getState().voiceInputOwner).toBe(null);
  });

  it("锁定（interactive 变假）时收掉录音", async () => {
    await render();
    await startRecording();

    await render({ interactive: false });

    expect(stopCapture).toHaveBeenCalled();
    expect(voice.cancel).toHaveBeenCalledWith("s1");
  });

  it("他处占用时麦克风点不动", async () => {
    useAppStore.setState({ voiceInputOwner: "chat-input" });
    await render();

    expect(mic().disabled).toBe(true);
    await startRecording();
    expect(voice.start).not.toHaveBeenCalled();
  });

  it("语音模式浮层开着时也一样（那边是 VAD 在听）", async () => {
    useAppStore.setState({ voiceModeOpen: true });
    await render();

    expect(mic().disabled).toBe(true);
  });

  it("同一帧里被别处抢走时，点击不再开第二路", async () => {
    await render();

    await act(async () => {
      // 不进单独的 act：这一格的重渲染还没落地，按钮看上去仍可点
      useAppStore.setState({ voiceInputOwner: "chat-input" });
      mic().click();
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });

    expect(voice.start).not.toHaveBeenCalled();
  });

  it("引擎没装：点麦克风先问下载，不开始录音", async () => {
    voice.getInstallState.mockResolvedValue({
      phase: "idle",
      percent: 0,
      installed: false,
    });
    await render();

    await startRecording();

    expect(voice.start).not.toHaveBeenCalled();
    // 确认框经 Portal 挂在 document.body 上，查询作用域不能只看 container
    expect(document.body.textContent).toContain("chat.voiceDownloadConfirm");
  });
});

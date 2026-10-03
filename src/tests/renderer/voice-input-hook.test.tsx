// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVoiceInput } from "../../renderer/hooks/useVoiceInput";

const { micMock } = vi.hoisted(() => ({ micMock: { start: vi.fn() } }));
vi.mock("../../renderer/utils/voice/mic-capture", () => ({
  MicError: class MicError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
  startMicCapture: micMock.start,
}));

let voice: Record<string, ReturnType<typeof vi.fn>>;
let emit: (event: unknown) => void;
let stopCapture: ReturnType<typeof vi.fn>;
let container: HTMLDivElement;
let root: Root;
let api: ReturnType<typeof useVoiceInput>;
// 输入框的替身：**有状态**。
//
// `onText` / `onRestore` 就是输入框的写入，`getSnapshot` 就是读它的当前内容。
// 早先的版本把 `getSnapshot` 写成常量 `() => "草稿"`，于是“用户手改输入框”根本
// 表达不出来 —— 静态的替身会把真实的竞态藏起来。
let draft = "";
const calls = {
  onText: vi.fn((text: string) => {
    draft = text;
  }),
  onRestore: vi.fn((text: string) => {
    draft = text;
  }),
  onBlocked: vi.fn(),
  onError: vi.fn(),
  onPolishFailed: vi.fn(),
  getSnapshot: vi.fn(() => draft),
};

let onSamplesRef: ((pcm: Int16Array, level: number) => void) | null = null;

function Probe() {
  api = useVoiceInput({ enabled: true, ...calls });
  return React.createElement("span", null, api.status);
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  stopCapture = vi.fn();
  emit = () => {};
  voice = {
    start: vi.fn(async () => ({ ok: true, sessionId: "s1" })),
    pushAudio: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    polish: vi.fn(async () => ({ ok: true, text: "整理后的文本" })),
    install: vi.fn(),
    removeInstall: vi.fn(),
    getInstallState: vi.fn(),
    onEvent: vi.fn((cb: (e: unknown) => void) => {
      emit = cb;
      return () => {};
    }),
  };
  (window as unknown as { electronAPI: unknown }).electronAPI = { voice };
  // 替身必须**真的调用** onSamples：以前它从不发声，于是
  // Int16Array → ArrayBuffer → IPC 那一段一次也没被执行过（和 worklet 那个 bug 同一种接缝形状）。
  onSamplesRef = null;
  micMock.start.mockImplementation(
    async (cb: (pcm: Int16Array, level: number) => void) => {
      onSamplesRef = cb;
      return { stop: stopCapture };
    },
  );
  // mockClear 只清调用记录、不清实现；mockReset 两者都清。
  // 这里必须 reset：某条用例给 polish 装了“挂住不返回”的实现，
  // 用 clear 的话它会泄漏到后面的用例里去。
  for (const spy of Object.values(calls)) spy.mockReset();
  draft = "草稿";
  calls.onText.mockImplementation((text: string) => {
    draft = text;
  });
  calls.onRestore.mockImplementation((text: string) => {
    draft = text;
  });
  calls.getSnapshot.mockImplementation(() => draft);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const render = async () =>
  act(async () => root.render(React.createElement(Probe)));

describe("useVoiceInput", () => {
  it("写入时用「快照 + 全量文本」，不做增量拼接", async () => {
    await render();
    await act(async () => api.toggle());

    await act(async () =>
      emit({ type: "partial", sessionId: "s1", text: "你好" }),
    );
    await act(async () =>
      emit({ type: "partial", sessionId: "s1", text: "你好世界" }),
    );

    expect(calls.onText).toHaveBeenLastCalledWith("草稿你好世界");
  });

  it("误触被丢弃时还原快照", async () => {
    await render();
    await act(async () => api.toggle());

    await act(async () =>
      emit({ type: "done", sessionId: "s1", text: "", discarded: true }),
    );

    expect(calls.onRestore).toHaveBeenCalledWith("草稿");
    expect(container.textContent).toBe("idle");
  });

  it("正常结束不回滚文本", async () => {
    await render();
    await act(async () => api.toggle());

    await act(async () =>
      emit({ type: "done", sessionId: "s1", text: "你好", discarded: false }),
    );

    expect(calls.onRestore).not.toHaveBeenCalled();
    expect(container.textContent).toBe("idle");
  });

  it("整理只替换本次语音那段，并记下原文以便还原", async () => {
    await render();
    await act(async () => api.toggle());
    await act(async () =>
      emit({
        type: "done",
        sessionId: "s1",
        text: "嗯那个今天天气不错",
        discarded: false,
      }),
    );

    const polished = await act(async () => api.polish());

    expect(voice.polish).toHaveBeenCalledWith("嗯那个今天天气不错", null);
    expect(polished).toBe(true);
  });

  it("整理期间用户改了输入框 → 丢弃结果，不覆盖他的编辑", async () => {
    await render();
    await act(async () => api.toggle());
    await act(async () =>
      emit({ type: "done", sessionId: "s1", text: "原文", discarded: false }),
    );

    // 发起整理，但在它返回前用户直接在输入框里改了字。
    // 注意是改 `getSnapshot` 的返回值，不是发语音事件 —— 用户手改走的是输入框
    // 自己的路径，永远不会经过 voice.event；用 partial 事件模拟的话，
    // 守着的是一个不可能发生的场景，真 bug 照样漏。
    let resolvePolish: (v: unknown) => void = () => {};
    voice.polish.mockImplementation(
      () =>
        new Promise((r) => {
          resolvePolish = r;
        }),
    );
    // 发起整理：它会挂着不返回，所以**不能 await** —— 把结果用 .then 接住。
    // 绝不在一个 act 里去 await 另一个 act() 的 promise：嵌套 act 会搞乱 act 队列，
    // 后面的用例就看不到状态刷新了（这两个用例的失败就是这么来的）。
    let polishedResult: boolean | undefined;
    await act(async () => {
      void api.polish().then((r) => {
        polishedResult = r;
      });
      await Promise.resolve();
    });

    // 用户手改输入框：直接把框里的内容换掉（不是发语音事件）
    draft = "草稿用户手改的";

    // 放行整理结果
    await act(async () => {
      resolvePolish({ ok: true, text: "整理后的文本" });
      await Promise.resolve();
    });

    expect(polishedResult).toBe(false);
    // 没把整理结果写进去（最后一次写入仍是 done 那次的「草稿原文」）
    expect(calls.onText).toHaveBeenLastCalledWith("草稿原文");
    expect(calls.onText).not.toHaveBeenCalledWith("草稿整理后的文本");
  });

  it("整理失败时保持原文", async () => {
    voice.polish.mockResolvedValue({ ok: false, reason: "suspicious" });
    await render();
    await act(async () => api.toggle());
    await act(async () =>
      emit({ type: "done", sessionId: "s1", text: "原文", discarded: false }),
    );

    const polished = await act(async () => api.polish());

    expect(polished).toBe(false);
    expect(calls.onText).toHaveBeenLastCalledWith("草稿原文");
  });

  it("整理失败时把原因报出去（但「用户改过字」不算失败）", async () => {
    // 钩子的 polish() 四种情况都返回 false，只有它分得清哪一种是真失败：
    // 在外面统一报「整理失败」会在用户自己打字时误报。
    voice.polish.mockResolvedValue({ ok: false, reason: "suspicious" });
    await render();
    await act(async () => api.toggle());
    await act(async () =>
      emit({ type: "done", sessionId: "s1", text: "原文", discarded: false }),
    );

    await act(async () => api.polish());

    expect(calls.onPolishFailed).toHaveBeenCalledWith("suspicious");
  });

  it("整理失败但原因不是 suspicious 时，报成 failed", async () => {
    voice.polish.mockResolvedValue({ ok: false, reason: "failed" });
    await render();
    await act(async () => api.toggle());
    await act(async () =>
      emit({ type: "done", sessionId: "s1", text: "原文", discarded: false }),
    );

    await act(async () => api.polish());

    expect(calls.onPolishFailed).toHaveBeenCalledWith("failed");
  });

  it("录音中按 Esc 取消：中断会话并还原快照", async () => {
    // 计划自带的 6 条用例里没列这个，但它是用户看得见的行为。
    await render();
    await act(async () => api.toggle());

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(voice.cancel).toHaveBeenCalledWith("s1");
    expect(calls.onRestore).toHaveBeenCalledWith("草稿");
    expect(container.textContent).toBe("idle");
  });

  it("会话结束后到达的迟到事件不改写输入框", async () => {
    // 回归测试：teardown 曾经不清 sessionRef，于是主进程那边一条迟到的事件
    // （或已结束会话的残余推送）会被当成当前会话处理，把已经结束的那段文字
    // 重新写回输入框。
    await render();
    await act(async () => api.toggle());
    await act(async () =>
      emit({ type: "done", sessionId: "s1", text: "最终", discarded: false }),
    );
    const afterDone = calls.onText.mock.calls.length;

    await act(async () =>
      emit({ type: "partial", sessionId: "s1", text: "最终加料" }),
    );

    expect(calls.onText.mock.calls.length).toBe(afterDone);
    expect(calls.onText).not.toHaveBeenCalledWith("草稿最终加料");
  });

  it("未启用时点按钮只提示，不碰麦克风", async () => {
    await act(async () => root.render(React.createElement(Probe2)));
    await act(async () => api.toggle());

    expect(calls.onBlocked).toHaveBeenCalled();
    expect(micMock.start).not.toHaveBeenCalled();
  });
});

function Probe2() {
  api = useVoiceInput({ enabled: false, ...calls });
  return React.createElement("span", null, api.status);
}

/**
 * 补一个真实存在的盲区：以前的替身从不调 `onSamples`，所以
 * 「采集帧 → ArrayBuffer → IPC」这条唯一的音频通路**一次也没被执行过**。
 * 这和 worklet 被 CSP 拦掉那个 bug 是同一种接缝形状 —— 替身恰好停在会坏的那条边界上。
 */
describe("useVoiceInput — 采集帧到 IPC 的真实通路", () => {
  const frame = (samples: number) => {
    const pcm = new Int16Array(samples);
    for (let i = 0; i < samples; i += 1) pcm[i] = i % 1000;
    return pcm;
  };

  it("把采集帧原样交给 pushAudio，载荷长度与采样数一致", async () => {
    await render();
    await act(async () => api.toggle());

    await act(async () => onSamplesRef?.(frame(1600), 0.5));

    expect(voice.pushAudio).toHaveBeenCalledTimes(1);
    const [sessionId, payload] = voice.pushAudio.mock.calls[0];
    expect(sessionId).toBe("s1");
    expect(payload).toBeInstanceOf(ArrayBuffer);
    // 1600 个 int16 = 3200 字节。截错 byteOffset 或漏乘 2 都会在这里现形。
    expect((payload as ArrayBuffer).byteLength).toBe(1600 * 2);
    const roundTrip = new Int16Array(payload as ArrayBuffer);
    expect(roundTrip[17]).toBe(17);
  });

  it("音量条在会话建好之前就响应 —— 按下即开始", async () => {
    await render();
    await act(async () => api.toggle());

    await act(async () => onSamplesRef?.(frame(1600), 0.8));

    expect(api.level).toBe(0.8);
  });

  it("会话建好前采到的帧被缓存、建好后按序冲入 —— 不切首字", async () => {
    // 让 voice.start 挂住，模拟引擎冷启动 / 首次权限弹窗那段时间
    let release: (value: unknown) => void = () => {};
    voice.start.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    await render();
    await act(async () => api.toggle());

    // 麦克风已经开了、已经出声，但会话还没建好
    await act(async () => onSamplesRef?.(frame(1600), 0.5));
    await act(async () => onSamplesRef?.(frame(1600), 0.5));
    expect(voice.pushAudio).not.toHaveBeenCalled();

    await act(async () => release({ ok: true, sessionId: "s1" }));

    expect(voice.pushAudio).toHaveBeenCalledTimes(2);
    // 顺序不能乱：识别器拿到的流必须是时间序
    expect(voice.pushAudio.mock.calls.map((call) => call[0])).toEqual([
      "s1",
      "s1",
    ]);
  });

  it("voice.start 被拒时不留开着采集，也不卡在 requesting", async () => {
    // handler 抛错会让 invoke reject。不接住的话状态卡在 requesting，
    // 而 requesting 下麦克风按钮是禁用的 —— 用户只能重开窗口。
    voice.start.mockRejectedValue(new Error("handler blew up"));

    await render();
    await act(async () => api.toggle());

    expect(stopCapture).toHaveBeenCalled();
    expect(calls.onError).toHaveBeenCalledWith("VOICE_ENGINE_FAILED");
    expect(container.textContent).toBe("idle");
  });
});

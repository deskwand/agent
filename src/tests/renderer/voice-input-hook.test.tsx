// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  POLISH_DEBOUNCE_MS,
  useVoiceInput,
} from "../../renderer/hooks/useVoiceInput";

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
/** 自动整理开关的替身（对应配置 `voiceEngine.autoPolish`，默认开）。 */
let autoPolishOn = true;
let draft = "";
const calls = {
  onText: vi.fn((text: string) => {
    draft = text;
  }),
  onRestore: vi.fn((text: string) => {
    draft = text;
  }),
  ensureReady: vi.fn(),
  onError: vi.fn(),
  getSnapshot: vi.fn(() => draft),
};

let onSamplesRef: ((pcm: Int16Array, level: number) => void) | null = null;

function Probe() {
  api = useVoiceInput({
    autoPolish: autoPolishOn,
    ...calls,
  });
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
  autoPolishOn = true;
  calls.onText.mockImplementation((text: string) => {
    draft = text;
  });
  calls.onRestore.mockImplementation((text: string) => {
    draft = text;
  });
  calls.getSnapshot.mockImplementation(() => draft);
  calls.ensureReady.mockImplementation(async () => true);
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

  it("控制器不再暴露手动整理接口", async () => {
    await render();

    expect(Object.keys(api).sort()).toEqual([
      "cancel",
      "level",
      "polishing",
      "seconds",
      "status",
      "toggle",
    ]);
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

  it("就绪检查期间算 requesting：手快连点不会起第二条采集", async () => {
    await render();
    let release: (ok: boolean) => void = () => {};
    calls.ensureReady.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        }),
    );

    await act(async () => api.toggle());
    expect(container.textContent).toBe("requesting");

    // 第二次点击（按钮这时是禁用的，但快捷键旁路还能走到 toggle）。
    await act(async () => api.toggle());

    await act(async () => release(true));

    expect(micMock.start).toHaveBeenCalledTimes(1);
    expect(voice.start).toHaveBeenCalledTimes(1);
  });

  it("没装模型（ensureReady 返回 false）：不碰麦克风，状态留在 idle", async () => {
    await render();
    calls.ensureReady.mockImplementation(async () => false);

    await act(async () => api.toggle());

    expect(micMock.start).not.toHaveBeenCalled();
    expect(container.textContent).toBe("idle");
  });

  it("先等 ensureReady（它可能在写配置、起下载），通过了才碰麦克风", async () => {
    await render();
    const order: string[] = [];
    calls.ensureReady.mockImplementation(async () => {
      order.push("ensureReady");
      return true;
    });
    micMock.start.mockImplementation(async () => {
      order.push("mic");
      return { stop: stopCapture };
    });

    await act(async () => api.toggle());

    expect(order).toEqual(["ensureReady", "mic"]);
  });
});

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

/**
 * `requesting` 是这条特性里最长的一段窗口：首次要加载 162MB 模型，实测 2.2~2.4 秒，
 * 首次用还要过系统权限弹窗。这段时间里 `sessionRef` 与 `captureRef` 都还是 null
 * （两者要等 await 回来才赋值），所以取消必须靠别的东西作废那次 start()。
 */
describe("requesting 期间的取消", () => {
  /** 让 voice.start 挂住，复现那段等待窗口。 */
  function hangStart() {
    let release: (value: { ok: true; sessionId: string }) => void = () => {};
    voice.start.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve as typeof release;
        }),
    );
    return () => release({ ok: true, sessionId: "s1" });
  }

  it("取消后那次 start() 回来时不建会话，也不复活成录音", async () => {
    const finishStart = hangStart();
    await render();
    await act(async () => {
      void api.toggle();
    });
    expect(api.status).toBe("requesting");

    // 用户按 Esc
    await act(async () => {
      api.cancel();
    });

    // 现在请求才回来 —— 它不能被当成一次有效录音
    await act(async () => {
      finishStart();
    });

    expect(voice.cancel).toHaveBeenCalledWith("s1");
    expect(stopCapture).toHaveBeenCalled();
    expect(container.textContent).toBe("idle");
  });

  it("取消不该回滚输入框 —— 那里面是用户自己的草稿，不是这次语音的产物", async () => {
    const finishStart = hangStart();
    await render();
    draft = "这是我自己打的草稿";
    await act(async () => {
      void api.toggle();
    });

    await act(async () => {
      api.cancel();
    });
    await act(async () => {
      finishStart();
    });

    // 回滚会把「开始录音前的快照」写回去，而 requesting 期间那个快照还是初始空串
    expect(calls.onRestore).not.toHaveBeenCalled();
  });
});

describe("voice.stop 被拒", () => {
  it("不把状态卡在 finishing —— 那个态下麦克风按钮是禁用的", async () => {
    voice.stop.mockRejectedValue(new Error("handler blew up"));
    await render();
    await act(async () => {
      void api.toggle();
    });
    expect(container.textContent).toBe("recording");

    await act(async () => {
      void api.toggle();
    });

    expect(container.textContent).toBe("idle");
    expect(calls.onError).toHaveBeenCalledWith("VOICE_ENGINE_FAILED");
  });
});

/**
 * 自动整理：收尾 900ms 后后台跑一次，草稿逐字没变才落地。
 * 手动「整理 / 还原」已删，所以这里断言的全是「输入框最后变成了什么」。
 */
describe("自动整理", () => {
  // 只伪造这两种定时器：录音计时用的 setInterval 与 promise 微任务不受影响。
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const sayDone = (text: string) =>
    act(async () =>
      emit({ type: "done", sessionId: "s1", text, discarded: false }),
    );

  /** 推进到防抖到点，并把整理请求的 promise 链跑完（两拍微任务）。 */
  const fireDebounce = () =>
    act(async () => {
      vi.advanceTimersByTime(POLISH_DEBOUNCE_MS);
      await Promise.resolve();
      await Promise.resolve();
    });

  /** 让下一次 polish 挂着不返回，用来观察「在飞 / 正在录音 / 已发送」这些窗口。 */
  const hangPolish = () => {
    let resolve: (value: unknown) => void = () => {};
    voice.polish.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    return (value: unknown) => resolve(value);
  };

  const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };

  it("说完 900ms 后自动整理，原地换成整理稿，麦克风全程可用", async () => {
    voice.polish.mockResolvedValue({
      ok: true,
      text: "我想想，明天下午三点开会吧。",
    });
    await render();
    await act(async () => api.toggle());
    await sayDone("嗯那个我想想明天下午三点开会吧");

    await act(async () => {
      vi.advanceTimersByTime(POLISH_DEBOUNCE_MS - 1);
    });
    expect(voice.polish).not.toHaveBeenCalled();

    await fireDebounce();

    expect(voice.polish).toHaveBeenCalledWith(
      "嗯那个我想想明天下午三点开会吧",
      null,
    );
    expect(draft).toBe("草稿我想想，明天下午三点开会吧。");
    // 整理期间 status 仍是 idle：麦克风没被锁
    expect(container.textContent).toBe("idle");
  });

  it("两段间隔小于防抖窗口时合并成一次调用", async () => {
    await render();
    await act(async () => api.toggle());
    await sayDone("第一段");

    await act(async () => {
      vi.advanceTimersByTime(POLISH_DEBOUNCE_MS - 500);
    });
    await act(async () => api.toggle());
    await sayDone("第二段");

    await fireDebounce();

    expect(voice.polish).toHaveBeenCalledTimes(1);
    expect(voice.polish).toHaveBeenCalledWith("第一段第二段", null);
    expect(draft).toBe("草稿整理后的文本");
  });

  it("在飞期间又说了新的一段：旧结果不落地，按合并文本补跑一次", async () => {
    const resolveFirst = hangPolish();
    await render();
    await act(async () => api.toggle());
    await sayDone("第一段");
    await fireDebounce();
    expect(voice.polish).toHaveBeenCalledTimes(1);

    // 用户马上又说了一句（第一次请求还挂在半路）
    await act(async () => api.toggle());
    await sayDone("第二段");
    expect(draft).toBe("草稿第一段第二段");

    await act(async () => {
      resolveFirst({ ok: true, text: "只盖住第一段的整理稿" });
      await flush();
    });

    // 旧结果作废（草稿已经不是它认得的那一份），并按合并后的文本补跑了一次
    expect(voice.polish).toHaveBeenCalledTimes(2);
    expect(voice.polish).toHaveBeenLastCalledWith("第一段第二段", null);
    expect(draft).toBe("草稿整理后的文本");
  });

  it("整理期间用户动手打字：结果丢弃，也不再补跑", async () => {
    const resolvePolish = hangPolish();
    await render();
    await act(async () => api.toggle());
    await sayDone("嗯那个原文");
    await fireDebounce();

    // 用户手改输入框：走的是输入框自己的路径，永远不经过 voice.event
    draft = "草稿我自己改的";
    await act(async () => {
      resolvePolish({ ok: true, text: "整理稿" });
      await flush();
    });

    expect(draft).toBe("草稿我自己改的");
    expect(voice.polish).toHaveBeenCalledTimes(1);
  });

  it("结果回来时正在录音：不落地（否则会被这次录音的收尾覆盖），收尾后整段重跑", async () => {
    const resolvePolish = hangPolish();
    await render();
    await act(async () => api.toggle());
    await sayDone("第一段");
    await fireDebounce();

    await act(async () => api.toggle()); // 用户紧接着又开录
    await act(async () => {
      resolvePolish({ ok: true, text: "整理稿" });
      await flush();
    });
    expect(draft).toBe("草稿第一段");

    await sayDone("第二段");
    await fireDebounce();

    expect(voice.polish).toHaveBeenLastCalledWith("第一段第二段", null);
    expect(draft).toBe("草稿整理后的文本");
  });

  it("发送先于落地：草稿被清空，结果不落地也不补跑", async () => {
    const resolvePolish = hangPolish();
    await render();
    await act(async () => api.toggle());
    await sayDone("原文");
    await fireDebounce();

    draft = ""; // 宿主发送成功后清空输入框
    // 发送不叫停环：那次请求还在飞，环一直亮到它收敛为止。
    // 这就是设计 §6 风险 1 里那条「≤900ms」之外的长尾：请求最长 15 秒（POLISH_TIMEOUT_MS）。
    expect(api.polishing).toBe(true);
    await act(async () => {
      resolvePolish({ ok: true, text: "整理稿" });
      await flush();
    });

    expect(draft).toBe("");
    expect(voice.polish).toHaveBeenCalledTimes(1);
    expect(api.polishing).toBe(false);
  });

  it("开关关掉之后一次都不整理", async () => {
    autoPolishOn = false;
    await render();
    await act(async () => api.toggle());
    await sayDone("嗯那个原文");

    await fireDebounce();

    expect(voice.polish).not.toHaveBeenCalled();
    expect(draft).toBe("草稿嗯那个原文");
  });

  it("整理失败静默：保留原文，不报错也不再重跑", async () => {
    voice.polish.mockResolvedValue({ ok: false, reason: "suspicious" });
    await render();
    await act(async () => api.toggle());
    await sayDone("原文");

    await fireDebounce();

    expect(draft).toBe("草稿原文");
    expect(calls.onError).not.toHaveBeenCalled();
    expect(voice.polish).toHaveBeenCalledTimes(1);
  });
  it("到点时正在录音、这次录音又没吐出文字：整理不丢，收尾后补跑", async () => {
    await render();
    await act(async () => api.toggle());
    await sayDone("第一段");

    // 计时器到点前又按了一下麦克风
    await act(async () => {
      vi.advanceTimersByTime(POLISH_DEBOUNCE_MS - 300);
    });
    await act(async () => api.toggle());
    await fireDebounce();
    expect(voice.polish).not.toHaveBeenCalled();

    // 这次是误触（一个字都没吐）—— 它自己不会重起计时器
    await act(async () =>
      emit({ type: "done", sessionId: "s1", text: "", discarded: true }),
    );
    await fireDebounce();

    expect(voice.polish).toHaveBeenCalledTimes(1);
    expect(voice.polish).toHaveBeenCalledWith("第一段", null);
    expect(draft).toBe("草稿整理后的文本");
  });

  it("到点时正在录音、这次被 Esc 取消：整理同样补跑", async () => {
    await render();
    await act(async () => api.toggle());
    await sayDone("第一段");

    await act(async () => {
      vi.advanceTimersByTime(POLISH_DEBOUNCE_MS - 300);
    });
    await act(async () => api.toggle());
    await fireDebounce();
    expect(voice.polish).not.toHaveBeenCalled();

    await act(async () => api.cancel());
    await fireDebounce();

    expect(voice.polish).toHaveBeenCalledWith("第一段", null);
    expect(draft).toBe("草稿整理后的文本");
  });

  it("卸载后到点不再发起整理", async () => {
    await render();
    await act(async () => api.toggle());
    await sayDone("第一段");

    await act(async () => root.unmount());
    await act(async () => {
      vi.advanceTimersByTime(POLISH_DEBOUNCE_MS);
      await flush();
    });

    expect(voice.polish).not.toHaveBeenCalled();
  });
  it("两段之间用户改了字：重新锚定，只整理新的一段", async () => {
    await render();
    await act(async () => api.toggle());
    await sayDone("第一段");

    // 用户在下一段之前自己改了这个框 —— 连续段的不变式破了
    draft = "草稿第一段我自己补的字";
    await act(async () => api.toggle());
    await sayDone("第二段");
    await fireDebounce();

    // 不以「草稿 + 第一段」为范围重发：那段文字里已经有用户的字
    expect(voice.polish).toHaveBeenCalledTimes(1);
    expect(voice.polish).toHaveBeenCalledWith("第二段", null);
    expect(draft).toBe("草稿第一段我自己补的字整理后的文本");
  });

  it("在飞期间关掉开关：结果不落地", async () => {
    const resolvePolish = hangPolish();
    await render();
    await act(async () => api.toggle());
    await sayDone("原文");
    await fireDebounce();

    autoPolishOn = false;
    await render(); // 让 optionsRef 拿到新值（渲染期同步）
    await act(async () => {
      resolvePolish({ ok: true, text: "整理稿" });
      await flush();
    });

    expect(draft).toBe("草稿原文");
  });

  it("说完就亮：防抖还没到点，polishing 已是 true；落地后熄灭", async () => {
    voice.polish.mockResolvedValue({ ok: true, text: "整理稿" });
    await render();
    await act(async () => api.toggle());
    await sayDone("嗯那个原文");

    expect(api.polishing).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(POLISH_DEBOUNCE_MS - 1);
    });
    expect(api.polishing).toBe(true);

    await fireDebounce();

    expect(draft).toBe("草稿整理稿");
    expect(api.polishing).toBe(false);
  });

  it("开关关着时不亮：这次不会有整理发生", async () => {
    autoPolishOn = false;
    await render();
    await act(async () => api.toggle());
    await sayDone("原文");

    expect(api.polishing).toBe(false);

    await fireDebounce();

    expect(api.polishing).toBe(false);
    expect(voice.polish).not.toHaveBeenCalled();
  });

  it("失败后熄灭：一次机会不重试，环不停留", async () => {
    voice.polish.mockResolvedValue({ ok: false, reason: "failed" });
    await render();
    await act(async () => api.toggle());
    await sayDone("原文");

    expect(api.polishing).toBe(true);

    await fireDebounce();

    expect(api.polishing).toBe(false);
    expect(voice.polish).toHaveBeenCalledTimes(1);
  });

  it("落地前用户动手打字：环随那次作废一起熄灭，不补跑", async () => {
    const resolvePolish = hangPolish();
    await render();
    await act(async () => api.toggle());
    await sayDone("原文");
    await fireDebounce();
    expect(api.polishing).toBe(true);

    // 用户接管文字：不变式破了
    draft = "我自己写的";
    await act(async () => {
      resolvePolish({ ok: true, text: "整理稿" });
      await flush();
    });

    expect(draft).toBe("我自己写的");
    expect(api.polishing).toBe(false);
    expect(voice.polish).toHaveBeenCalledTimes(1);
  });

  it("在飞期间又来一段：环一路不灭，直到补跑的那次落地", async () => {
    const resolveFirst = hangPolish();
    await render();
    await act(async () => api.toggle());
    await sayDone("第一段");
    await fireDebounce();
    expect(api.polishing).toBe(true);

    await act(async () => api.toggle());
    await sayDone("第二段");
    expect(api.polishing).toBe(true);

    await act(async () => {
      resolveFirst({ ok: true, text: "只盖住第一段的整理稿" });
      await flush();
    });

    expect(voice.polish).toHaveBeenCalledTimes(2);
    expect(draft).toBe("草稿整理后的文本");
    expect(api.polishing).toBe(false);
  });

  it("到点时正在录音、那次又没吐字：收尾补跑时环重新亮起", async () => {
    await render();
    await act(async () => api.toggle());
    await sayDone("第一段");
    expect(api.polishing).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(POLISH_DEBOUNCE_MS - 300);
    });
    await act(async () => api.toggle()); // 又开录
    await fireDebounce(); // 这次发起被录音挡下

    expect(voice.polish).not.toHaveBeenCalled();
    expect(api.polishing).toBe(false);

    // 误触（一个字都没吐）：自己的 done 不会重起计时器，靠 reschedulePolishIfDue 补
    await act(async () =>
      emit({ type: "done", sessionId: "s1", text: "", discarded: true }),
    );
    expect(api.polishing).toBe(true);

    await fireDebounce();

    expect(draft).toBe("草稿整理后的文本");
    expect(api.polishing).toBe(false);
  });

  it("Esc 取消这次录音：已进框的那段照旧等整理，环不灭", async () => {
    await render();
    await act(async () => api.toggle());
    await sayDone("第一段");
    expect(api.polishing).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(POLISH_DEBOUNCE_MS - 300);
    });
    await act(async () => api.toggle()); // 开录
    await act(async () => api.cancel()); // Esc

    expect(api.polishing).toBe(true);

    await fireDebounce();

    expect(voice.polish).toHaveBeenCalledWith("第一段", null);
    expect(api.polishing).toBe(false);
  });

  it("这次一个字都没吐（空结果）：不武装计时器，环也不亮", async () => {
    await render();
    await act(async () => api.toggle());
    await sayDone("");

    expect(api.polishing).toBe(false);
  });
});

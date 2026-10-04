import { describe, it, expect, vi } from "vitest";
import { createVoiceConversation } from "../../renderer/hooks/useVoiceConversation";
import type {
  VadEdge,
  VadProfile,
  VoiceEvent,
  VoiceStartResult,
} from "../../shared/ipc-types";
import type { StreamingSpeech } from "../../renderer/hooks/useStreamingSpeech";

/**
 * VAD 的边沿由**主进程**给（`main/voice/vad-engine.ts`），所以测试推事件而不是
 * 喂电平。原来那些"150ms 才触发""回答期阈值更高"的用例已经作废 —— 那些判定
 * 搬进主进程了，这里只验"收到边沿之后状态机怎么走"。
 */
function harness(start?: () => Promise<VoiceStartResult>) {
  let samplesCb: ((pcm: Int16Array, level: number) => void) | null = null;
  let voiceCb: ((event: VoiceEvent) => void) | null = null;
  const pushed: ArrayBuffer[] = [];
  const states: string[] = [];
  const questions: string[] = [];
  const errors: string[] = [];
  const monitorCalls = {
    started: 0,
    stopped: 0,
    resets: 0,
    profiles: [] as VadProfile[],
    frames: 0,
  };
  let drainedCb: (() => void) | null = null;
  /** 本轮 ASR 的 partial。判"说完了吗"读它。 */
  let partial = "";
  /** 被关闭的会话。用来验证"没说完就不关"。 */
  const voiceStops: string[] = [];
  const speech = {
    begin: vi.fn(),
    push: vi.fn(),
    end: vi.fn(),
    stop: vi.fn(),
    onSentence: vi.fn(),
    onDrained: (cb: () => void) => {
      drainedCb = cb;
    },
    failedCount: () => 0,
  } as unknown as StreamingSpeech;

  const cancel = vi.fn(async (_id: string) => {});
  const conv = createVoiceConversation({
    startCapture: async (cb) => {
      samplesCb = cb;
      return { stop: () => {} };
    },
    voice: {
      start: start ?? (async () => ({ ok: true, sessionId: "s1" })),
      pushAudio: async (_id, pcm) => {
        pushed.push(pcm);
      },
      stop: async (id) => {
        voiceStops.push(id);
      },
      cancel,
      onEvent: (cb) => {
        voiceCb = cb;
        return () => {};
      },
    },
    monitor: {
      start: () => {
        monitorCalls.started += 1;
      },
      audio: () => {
        monitorCalls.frames += 1;
      },
      profile: (p) => {
        monitorCalls.profiles.push(p);
      },
      reset: () => {
        monitorCalls.resets += 1;
      },
      stop: () => {
        monitorCalls.stopped += 1;
      },
    },
    speech,
    sendQuestion: (t) => questions.push(t),
    silenceMs: 1200,
    currentPartial: () => partial,
    onState: (s) => states.push(s),
    onLevel: () => {},
    onTranscript: () => {},
    onQuestion: () => {},
    onSentence: () => {},
    onError: (c) => errors.push(c),
  });

  return {
    conv,
    cancel,
    pushed,
    states,
    questions,
    errors,
    monitorCalls,
    speech,
    voiceStops,
    fireDrained: () => drainedCb?.(),
    // 每帧之间让出一个微任务：真实世界里帧间隔 100ms，会话建立（voice.start）
    // 的 await 早就完成了；测试若同步连发，会在 sessionId 还没设上时就判定静音。
    feed: async (level: number, frames = 1) => {
      for (let i = 0; i < frames; i += 1) {
        samplesCb?.(new Int16Array(1600), level);
        await Promise.resolve();
      }
    },
    voice: (event: VoiceEvent) => voiceCb?.(event),
    /** 推一个 VAD 边沿。它不带 sessionId，与 ASR 事件走同一条通道。 */
    vad: (edge: VadEdge) => voiceCb?.({ type: "vad", edge }),
    /** 模拟 ASR 吐 partial。 */
    setPartial: (text: string) => {
      partial = text;
    },
  };
}

async function started() {
  const h = harness();
  await h.conv.start();
  return h;
}

/** 走完一轮「开口 → 静音 → 识别出问题」，停在 answering。 */
async function answeringRound(h: ReturnType<typeof harness>, text = "问题") {
  h.vad("speech-start");
  await h.feed(0.5, 1);
  h.vad("speech-end");
  h.voice({ type: "done", sessionId: "s1", text, discarded: false });
}

describe("createVoiceConversation", () => {
  it("start 之后直接进 listening，不再有标定期", async () => {
    const h = await started();
    expect(h.states.at(-1)).toBe("listening");
    expect(h.monitorCalls.started).toBe(1);
  });

  it("speech-start 才开会话，不是听到声音就开", async () => {
    const h = await started();
    await h.feed(0.9, 3);
    // 渲染层不再判电平：没有边沿就不该开会话
    expect(h.states.at(-1)).toBe("listening");

    h.vad("speech-start");
    await h.feed(0.9, 1);
    expect(h.states.at(-1)).toBe("capturing");
  });

  it("每一片音频都转发给主进程的 VAD，安静时也转", async () => {
    const h = await started();
    await h.feed(0.02, 3);
    expect(h.monitorCalls.frames).toBe(3);
  });

  it("静音后把问题发出去并进入 thinking", async () => {
    const h = await started();
    h.vad("speech-start");
    await h.feed(0.9, 3);
    h.vad("speech-end");
    h.voice({
      type: "done",
      sessionId: "s1",
      text: "端口被占用了",
      discarded: false,
    });
    expect(h.questions).toEqual(["端口被占用了"]);
    expect(h.speech.begin).toHaveBeenCalled();
    expect(h.states.at(-1)).toBe("thinking");
  });

  it("什么都没识别出来就回到 listening", async () => {
    const h = await started();
    h.vad("speech-start");
    await h.feed(0.9, 3);
    h.vad("speech-end");
    h.voice({ type: "done", sessionId: "s1", text: "", discarded: false });
    expect(h.questions).toEqual([]);
    expect(h.speech.begin).not.toHaveBeenCalled();
    expect(h.states.at(-1)).toBe("listening");
  });

  // 回补缓冲是"不切掉开头半个字"的唯一保障，而它很容易被提前清掉还不报错。
  it("新会话带上说话之前采到的音频", async () => {
    const h = await started();
    await h.feed(0.02, 4); // 说话前的 400ms：应当进回补缓冲
    h.vad("speech-start");
    await h.feed(0.9, 1);
    await Promise.resolve();
    expect(h.pushed.length).toBeGreaterThan(0);
  });

  // 上一轮 stop 已发、done 未到时用户又开口：新音频不能推进那条已 closed 的流。
  it("上一轮 done 未到就又开口时开一条新会话", async () => {
    const h = await started();
    h.vad("speech-start");
    await h.feed(0.9, 3);
    h.vad("speech-end"); // 静音 → stop(s1)，等 done
    const before = h.pushed.length;
    h.vad("speech-start");
    await h.feed(0.9, 1);
    await Promise.resolve();
    expect(h.states.at(-1)).toBe("capturing");
    expect(h.pushed.length).toBeGreaterThan(before);
  });

  it("回答期切到 barge-in profile，朗读播完切回来", async () => {
    const h = await started();
    await answeringRound(h);
    expect(h.monitorCalls.profiles).toContain("barge-in");

    h.conv.sendAnswerDelta("第一句。", false);
    h.fireDrained();
    expect(h.monitorCalls.profiles.at(-1)).toBe("interactive");
  });

  it("回答期开口打断朗读", async () => {
    const h = await started();
    await answeringRound(h);
    h.conv.sendAnswerDelta("第一句。", false);
    vi.mocked(h.speech.stop).mockClear();

    h.vad("speech-start");
    await h.feed(0.9, 1);
    expect(h.speech.stop).toHaveBeenCalled();
    expect(h.states.at(-1)).toBe("capturing");
  });

  // 朗读期没有 ASR 会话，而那时正是最需要判断"用户开口没有"的时刻。
  it("朗读期的 VAD 事件照样送达（无会话也要打断）", async () => {
    const h = await started();
    await answeringRound(h);
    h.conv.sendAnswerDelta("第一句。", false);
    vi.mocked(h.speech.stop).mockClear();

    // 会话已随 done 收尾，此时并没有打开的 ASR 会话
    h.vad("speech-start");
    expect(h.speech.stop).toHaveBeenCalled();
  });

  // 固定静音阈值在"停顿被切"与"响应太慢"之间只能二选一。标点判据把这两端
  // 分开：句中停顿不关会话，句末标点立即关。
  describe("轮次判定", () => {
    it("partial 停在句中标点时不关会话", async () => {
      const h = await started();
      h.vad("speech-start");
      await h.feed(0.5, 1);
      h.setPartial("我想想，");
      h.vad("speech-end");
      h.setPartial("我想想，");
      expect(h.voiceStops).toEqual([]);
    });

    it("partial 以句末标点结尾时立即关会话", async () => {
      const h = await started();
      h.vad("speech-start");
      await h.feed(0.5, 1);
      h.setPartial("就这样吧。");
      h.vad("speech-end");
      expect(h.voiceStops).toEqual(["s1"]);
    });

    it("一直没说完时，硬上限强制关会话", async () => {
      vi.useFakeTimers();
      try {
        const h = await started();
        h.vad("speech-start");
        await h.feed(0.5, 1);
        h.setPartial("那个……");
        h.vad("speech-end");
        expect(h.voiceStops).toEqual([]);

        vi.advanceTimersByTime(1200);
        expect(h.voiceStops).toEqual(["s1"]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("继续说会重置硬上限计时", async () => {
      vi.useFakeTimers();
      try {
        const h = await started();
        h.vad("speech-start");
        await h.feed(0.5, 1);
        h.setPartial("那个……");
        h.vad("speech-end");
        vi.advanceTimersByTime(900);
        expect(h.voiceStops).toEqual([]);

        // 用户又开口了：计时从头算
        h.vad("speech-start");
        await h.feed(0.5, 1);
        h.vad("speech-end");
        vi.advanceTimersByTime(900);
        expect(h.voiceStops).toEqual([]);

        vi.advanceTimersByTime(400);
        expect(h.voiceStops).toEqual(["s1"]);
      } finally {
        vi.useRealTimers();
      }
    });

    // 压缩期就是不该发新问题。计时器不停的话，它到期会关掉会话、把问题发出去。
    it("进入压缩期会停掉硬上限计时", async () => {
      vi.useFakeTimers();
      try {
        const h = await started();
        h.vad("speech-start");
        await h.feed(0.5, 1);
        h.setPartial("那个……");
        h.vad("speech-end");

        h.conv.setBlocked(true);
        vi.advanceTimersByTime(5000);
        expect(h.voiceStops).toEqual([]);
        expect(h.states.at(-1)).toBe("blocked");
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("压缩期拒绝新问题", async () => {
    const h = await started();
    h.conv.setBlocked(true);
    expect(h.states.at(-1)).toBe("blocked");
    h.vad("speech-start");
    await h.feed(0.9, 3);
    expect(h.states.at(-1)).toBe("blocked");
  });

  it("解封会复位 VAD 并回到接收期", async () => {
    const h = await started();
    h.conv.setBlocked(true);
    const before = h.monitorCalls.resets;
    h.conv.setBlocked(false);
    expect(h.monitorCalls.resets).toBe(before + 1);
    expect(h.states.at(-1)).toBe("listening");
  });

  it("stop 释放麦克风与 VAD", async () => {
    const h = await started();
    h.conv.stop();
    expect(h.states.at(-1)).toBe("stopped");
    expect(h.monitorCalls.stopped).toBe(1);
  });

  // 打断是单程票：说一声"嗯"、或被扬声器泄漏触发一次，答案就永久丢失。
  // 这两条用例盯的就是"能回头"。
  describe("打断可恢复", () => {
    it("识别出附和：恢复朗读，不发送问题", async () => {
      const h = await started();
      await answeringRound(h, "打开设置");
      h.conv.sendAnswerDelta("答案第一句。答案第二句。", false);
      expect(h.questions).toEqual(["打开设置"]);

      const beginsBefore = vi.mocked(h.speech.begin).mock.calls.length;

      // 打断，然后这一轮只识别出"嗯"
      h.vad("speech-start");
      await h.feed(0.5, 1);
      h.vad("speech-end");
      h.voice({ type: "done", sessionId: "s1", text: "嗯", discarded: false });

      // 没有第二个问题发出去
      expect(h.questions).toEqual(["打开设置"]);
      // 又调了一次 begin：恢复朗读
      expect(vi.mocked(h.speech.begin).mock.calls.length).toBe(
        beginsBefore + 1,
      );
      expect(h.states.at(-1)).toBe("speaking");
    });

    it("什么都没识别出来也恢复（扬声器泄漏走的就是这条）", async () => {
      const h = await started();
      await answeringRound(h, "打开设置");
      h.conv.sendAnswerDelta("答案第一句。", false);
      const beginsBefore = vi.mocked(h.speech.begin).mock.calls.length;

      h.vad("speech-start");
      await h.feed(0.5, 1);
      h.vad("speech-end");
      h.voice({ type: "done", sessionId: "s1", text: "", discarded: true });

      expect(h.questions).toEqual(["打开设置"]);
      expect(vi.mocked(h.speech.begin).mock.calls.length).toBe(
        beginsBefore + 1,
      );
    });

    it("识别出真内容：发送问题，答案作废", async () => {
      const h = await started();
      await answeringRound(h, "打开设置");
      h.conv.sendAnswerDelta("答案第一句。答案第二句。", false);

      h.vad("speech-start");
      await h.feed(0.5, 1);
      h.vad("speech-end");
      h.voice({
        type: "done",
        sessionId: "s1",
        text: "帮我换个说法",
        discarded: false,
      });

      expect(h.questions).toEqual(["打开设置", "帮我换个说法"]);
      expect(h.states.at(-1)).toBe("thinking");
    });

    it("没打断过的一轮不因为短文本而被当成附和", async () => {
      // 「嗯」在没有打断的上下文里就是一句正常提问，应当发出去。
      const h = await started();
      h.vad("speech-start");
      await h.feed(0.5, 1);
      h.vad("speech-end");
      h.voice({ type: "done", sessionId: "s1", text: "嗯", discarded: false });
      expect(h.questions).toEqual(["嗯"]);
    });

    // 打断标记必须按轮生命周期，不能跨轮。跨轮的效果是：下一轮的一句"嗯"
    // 会去恢复念一段早就作废的答案，而这一轮的真问题被丢掉。
    it("打断后没等到 done 又开一轮，标记不跨轮生效", async () => {
      const h = await started();
      await answeringRound(h, "打开设置");
      h.conv.sendAnswerDelta("旧答案。", false);

      // 1）打断
      h.vad("speech-start");
      await h.feed(0.5, 1);
      // 2）还没等到 done，用户又说了一句 → 新的一轮
      h.vad("speech-start");
      await h.feed(0.5, 1);
      h.vad("speech-end");
      h.voice({ type: "done", sessionId: "s1", text: "嗯", discarded: false });

      // 这一轮没被打断过，所以"嗯"就是一句正常提问，不该去恢复念旧答案
      expect(h.questions).toEqual(["打开设置", "嗯"]);
    });
  });
});

it.each([true, false])(
  "cleans up a late ASR start (success=%s)",
  async (ok) => {
    let resolve!: (value: VoiceStartResult) => void;
    const h = harness(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    await h.conv.start();
    h.vad("speech-start");
    h.conv.stop();
    resolve(
      ok
        ? { ok: true, sessionId: "late-asr" }
        : { ok: false, code: "VOICE_CAPTURE_FAILED" },
    );
    await Promise.resolve();
    if (ok) expect(h.cancel).toHaveBeenCalledExactlyOnceWith("late-asr");
    else expect(h.cancel).not.toHaveBeenCalled();
    expect(h.pushed).toEqual([]);
    expect(h.questions).toEqual([]);
  },
);

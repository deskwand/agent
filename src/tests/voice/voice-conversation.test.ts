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
  /** 每一片进入 ASR 的音频，带会话标识。回补只发一次、顺序不变靠它验。 */
  const pushedFrames: Array<{ sessionId: string; pcm: number[] }> = [];
  /** 默认启动器：每次开会话都给一个新标识，与主进程行为一致。 */
  let nextSession = 0;
  let lastSession = "";
  const startSpy = vi.fn(
    start ??
      (async () => {
        lastSession = `s${++nextSession}`;
        return { ok: true as const, sessionId: lastSession };
      }),
  );
  const states: string[] = [];
  /** 每次上报的音量。用来盯住「静音时球不该还在跟环境声闪」。 */
  const levels: number[] = [];
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
  /** 宿主收不收这一轮。语音模式被关掉时它返回 false。 */
  let acceptQuestions = true;
  const conv = createVoiceConversation({
    startCapture: async (cb) => {
      samplesCb = cb;
      return { stop: () => {} };
    },
    voice: {
      start: startSpy,
      pushAudio: async (id, pcm) => {
        pushed.push(pcm);
        pushedFrames.push({
          sessionId: id,
          pcm: Array.from(new Int16Array(pcm)),
        });
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
    sendQuestion: (t) => {
      questions.push(t);
      return acceptQuestions;
    },
    silenceMs: 1200,
    onState: (s) => states.push(s),
    onLevel: (level) => levels.push(level),
    onTranscript: () => {},
    onQuestion: () => {},
    onSentence: () => {},
    onError: (c) => errors.push(c),
  });

  return {
    conv,
    cancel,
    rejectQuestions: () => {
      acceptQuestions = false;
    },
    startSpy,
    currentSessionId: () => lastSession,
    pushedFrames,
    clearPushed: () => {
      pushed.length = 0;
      pushedFrames.length = 0;
    },
    /** 直接喂 PCM，不经过电平：验的是"片子进没进会话"，不是触发条件。 */
    feedPcm: (pcm: Int16Array) => samplesCb?.(pcm, 0.5),
    pushed,
    states,
    levels,
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
  h.voice({
    type: "done",
    sessionId: h.currentSessionId(),
    text,
    discarded: false,
  });
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
  it("上一轮 done 未到就又开口时取消旧会话并开一条新会话", async () => {
    vi.useFakeTimers();
    try {
      const h = await started();
      h.vad("speech-start");
      await h.feed(0.9, 1);
      const first = h.currentSessionId();
      h.vad("speech-end");
      vi.advanceTimersByTime(1200); // 静音到期 → stop(first)，等 done
      expect(h.voiceStops).toEqual([first]);

      h.vad("speech-start");
      await h.feed(0.9, 1);
      const second = h.currentSessionId();
      expect(second).not.toBe(first);
      expect(h.cancel).toHaveBeenCalledWith(first);
      expect(h.states.at(-1)).toBe("capturing");

      // 旧会话的 done 已经不作数
      h.voice({
        type: "done",
        sessionId: first,
        text: "旧话",
        discarded: false,
      });
      expect(h.questions).toEqual([]);

      h.vad("speech-end");
      vi.advanceTimersByTime(1200);
      expect(h.voiceStops).toEqual([first, second]);
      h.voice({
        type: "done",
        sessionId: second,
        text: "新话",
        discarded: false,
      });
      expect(h.questions).toEqual(["新话"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("回答期切到 barge-in profile，朗读播完切回来", async () => {
    const h = await started();
    await answeringRound(h);
    expect(h.monitorCalls.profiles).toContain("barge-in");

    h.conv.sendAnswerDelta("第一句。", false);
    h.fireDrained();
    expect(h.monitorCalls.profiles.at(-1)).toBe("interactive");
  });

  // 开口不等于打断：VAD 的起点只说明"有声音"，咳嗽、键盘声、附和词都会触发它。
  // 判决挪到 ASR 的最终结果 —— 代价是打断慢一点，换来的是不误杀回答。
  it("回答期开口只开候选识别，播放继续", async () => {
    const h = await started();
    await answeringRound(h);
    h.conv.sendAnswerDelta("第一句。", false);
    vi.mocked(h.speech.stop).mockClear();

    h.vad("speech-start");
    await h.feed(0.9, 1);
    expect(h.startSpy).toHaveBeenCalledTimes(2); // 候选也要一条 ASR 会话
    expect(h.speech.stop).not.toHaveBeenCalled();
    expect(h.states.at(-1)).toBe("speaking");
  });

  // 朗读期没有 ASR 会话，而那时正是最需要判断"用户开口没有"的时刻。
  it("朗读期的 VAD 事件照样送达（会话已收尾也要听见用户）", async () => {
    const h = await started();
    await answeringRound(h);
    h.conv.sendAnswerDelta("第一句。", false);
    vi.mocked(h.speech.stop).mockClear();

    // 会话已随 done 收尾，此时并没有打开的 ASR 会话
    h.vad("speech-start");
    expect(h.startSpy).toHaveBeenCalledTimes(2);
    expect(h.speech.stop).not.toHaveBeenCalled();
  });

  // 标点判据已删：句末标点只说明这一句说完了，不说明用户说完了。
  // 现在唯一的判据是静音时长 —— 等满它才收尾，期间续说就接着用同一条会话。
  describe("轮次判定", () => {
    it("停顿不立即关会话，等满静音时长", async () => {
      const h = await started();
      h.vad("speech-start");
      await h.feed(0.5, 1);
      h.vad("speech-end");
      expect(h.voiceStops).toEqual([]);
    });

    // 标点只说明"这句话说完了"，不说明"轮次结束了"。用户接着说下一句是常态，
    // 所以句末标点也必须等满静音时长。
    it("句末标点仍等待完整静音时长", async () => {
      vi.useFakeTimers();
      try {
        const h = await started();
        h.vad("speech-start");
        await h.feed(0.5, 1);
        h.vad("speech-end");
        expect(h.voiceStops).toEqual([]);

        vi.advanceTimersByTime(1199);
        expect(h.voiceStops).toEqual([]);
        vi.advanceTimersByTime(1);
        expect(h.voiceStops).toEqual([h.currentSessionId()]);

        // 只关一次：计时器没被重挂
        vi.advanceTimersByTime(5000);
        expect(h.voiceStops).toEqual([h.currentSessionId()]);
      } finally {
        vi.useRealTimers();
      }
    });

    // 停顿里的音频走回补缓冲（speaking 已经是 false），复用会话时必须补进去。
    // 只"取消计时器"的话，用户续说的开头几个字会被丢掉。
    it("续说复用同一条会话，并回补停顿期间的音频", async () => {
      vi.useFakeTimers();
      try {
        const h = await started();
        h.vad("speech-start");
        await h.feed(0.5, 1);
        const id = h.currentSessionId();
        h.clearPushed();
        h.feedPcm(new Int16Array([101]));

        h.vad("speech-end");
        vi.advanceTimersByTime(900);
        h.feedPcm(new Int16Array([202])); // 停顿期间：只进回补缓冲
        expect(h.pushedFrames.map((frame) => frame.pcm)).toEqual([[101]]);

        h.vad("speech-start"); // 续说
        h.feedPcm(new Int16Array([303]));
        expect(h.pushedFrames).toEqual([
          { sessionId: id, pcm: [101] },
          { sessionId: id, pcm: [202] },
          { sessionId: id, pcm: [303] },
        ]);
        expect(h.startSpy).toHaveBeenCalledTimes(1);
        expect(h.cancel).not.toHaveBeenCalled();

        // 再停一次、再说：缺口只在复用那一刻补一次，不会重复补
        h.vad("speech-end");
        vi.advanceTimersByTime(900);
        h.vad("speech-start");
        expect(h.pushedFrames).toEqual([
          { sessionId: id, pcm: [101] },
          { sessionId: id, pcm: [202] },
          { sessionId: id, pcm: [303] },
        ]);

        // 合并成一次收尾，完整句子只提交一次
        h.vad("speech-end");
        vi.advanceTimersByTime(1200);
        expect(h.voiceStops).toEqual([id]);
        h.voice({
          type: "done",
          sessionId: id,
          text: "我想先打开设置再换模型",
          discarded: false,
        });
        expect(h.questions).toEqual(["我想先打开设置再换模型"]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("一直没说完时，硬上限强制关会话", async () => {
      vi.useFakeTimers();
      try {
        const h = await started();
        h.vad("speech-start");
        await h.feed(0.5, 1);
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

  // 启动是异步的：用户可能在 voice.start 解析之前就把话说完。
  describe("启动期间的静音收尾", () => {
    it("启动完成后只等剩下的静音时长", async () => {
      vi.useFakeTimers();
      try {
        let resolve!: (value: VoiceStartResult) => void;
        const h = harness(
          () => new Promise<VoiceStartResult>((r) => (resolve = r)),
        );
        await h.conv.start();
        h.vad("speech-start");
        h.vad("speech-end");
        vi.advanceTimersByTime(500);

        resolve({ ok: true, sessionId: "late" });
        await Promise.resolve();
        await Promise.resolve();
        expect(h.voiceStops).toEqual([]);

        vi.advanceTimersByTime(699);
        expect(h.voiceStops).toEqual([]);
        vi.advanceTimersByTime(1);
        expect(h.voiceStops).toEqual(["late"]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("静音等待已经到期时，启动完成即收尾", async () => {
      vi.useFakeTimers();
      try {
        let resolve!: (value: VoiceStartResult) => void;
        const h = harness(
          () => new Promise<VoiceStartResult>((r) => (resolve = r)),
        );
        await h.conv.start();
        h.vad("speech-start");
        h.vad("speech-end");
        vi.advanceTimersByTime(1200);

        resolve({ ok: true, sessionId: "late" });
        await Promise.resolve();
        await Promise.resolve();
        expect(h.voiceStops).toEqual(["late"]);
      } finally {
        vi.useRealTimers();
      }
    });

    // 停止/压缩让本次启动作废：迟到的会话没人再用，必须自己取消。
    it.each([true, false])("停止后迟到的启动被清理（成功=%s）", async (ok) => {
      let resolve!: (value: VoiceStartResult) => void;
      const h = harness(
        () => new Promise<VoiceStartResult>((r) => (resolve = r)),
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
      await Promise.resolve();

      if (ok) expect(h.cancel).toHaveBeenCalledWith("late-asr");
      else expect(h.cancel).not.toHaveBeenCalled();
      expect(h.questions).toEqual([]);
      expect(h.errors).toEqual([]);
      expect(h.states.at(-1)).toBe("stopped");
    });
  });

  // 语音模式可能已经被关掉。宿主不收这一轮时，状态机不能再开一条
  // 没人铺答案的朗读 —— 那会让球一直停在 thinking。
  it("宿主拒收时不开朗读，回到 listening", async () => {
    const h = await started();
    h.rejectQuestions();
    h.vad("speech-start");
    await h.feed(0.5, 1);
    h.vad("speech-end");
    h.voice({
      type: "done",
      sessionId: h.currentSessionId(),
      text: "这句话没人接",
      discarded: false,
    });

    expect(h.speech.begin).not.toHaveBeenCalled();
    expect(h.states.at(-1)).toBe("listening");
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
  // 现在判决等最终识别结果，无效的候选什么都不改。
  describe("打断确认", () => {
    it("识别出真内容：停止播放并提交新问题", async () => {
      const h = await started();
      await answeringRound(h);
      h.conv.sendAnswerDelta("答案第一句。", false);
      vi.mocked(h.speech.stop).mockClear();

      h.vad("speech-start");
      await h.feed(0.5, 1);
      h.vad("speech-end");
      h.voice({
        type: "done",
        sessionId: h.currentSessionId(),
        text: "帮我换个说法",
        discarded: false,
      });

      expect(h.speech.stop).toHaveBeenCalledTimes(1);
      expect(h.questions).toEqual(["问题", "帮我换个说法"]);
      expect(h.states.at(-1)).toBe("thinking");
    });

    it.each([
      { text: "", discarded: false },
      { text: "杂音", discarded: true },
      { text: "嗯", discarded: false },
    ])(
      "无效候选不改变播放（text=$text discarded=$discarded）",
      async ({ text, discarded }) => {
        const h = await started();
        await answeringRound(h);
        h.conv.sendAnswerDelta("原回答。", false);
        const begins = vi.mocked(h.speech.begin).mock.calls.length;
        vi.mocked(h.speech.stop).mockClear();

        h.vad("speech-start");
        await h.feed(0.5, 1);
        h.vad("speech-end");
        h.voice({
          type: "done",
          sessionId: h.currentSessionId(),
          text,
          discarded,
        });

        expect(h.speech.stop).not.toHaveBeenCalled();
        expect(vi.mocked(h.speech.begin).mock.calls.length).toBe(begins);
        expect(h.questions).toEqual(["问题"]);
        expect(h.states.at(-1)).toBe("speaking");
      },
    );

    // 候选只是"同时在听"，回答该说的还得说完。
    it("候选期间的回答增量照常送入播放", async () => {
      const h = await started();
      await answeringRound(h);
      h.conv.sendAnswerDelta("第一句。", false);

      h.vad("speech-start");
      await h.feed(0.5, 1);
      h.conv.sendAnswerDelta("第一句。第二句。", false);
      expect(h.speech.push).toHaveBeenLastCalledWith("第一句。第二句。");
    });

    it("候选期间续说不改变候选身份", async () => {
      const h = await started();
      await answeringRound(h);
      h.conv.sendAnswerDelta("原回答。", false);

      h.vad("speech-start");
      await h.feed(0.5, 1);
      h.vad("speech-start"); // 停顿一下接着说
      await h.feed(0.5, 1);
      h.vad("speech-end");
      h.voice({
        type: "done",
        sessionId: h.currentSessionId(),
        text: "嗯",
        discarded: false,
      });

      expect(h.questions).toEqual(["问题"]);
      expect(h.states.at(-1)).toBe("speaking");
    });

    it("播放结束后收到有效结果：提交一次", async () => {
      const h = await started();
      await answeringRound(h);
      h.conv.sendAnswerDelta("最后一句话。", false);
      h.vad("speech-start");
      await h.feed(0.5, 1);

      h.fireDrained(); // 回答播完，但候选会话还开着
      expect(h.states.at(-1)).toBe("capturing");
      expect(h.questions).toEqual(["问题"]);

      h.vad("speech-end");
      h.voice({
        type: "done",
        sessionId: h.currentSessionId(),
        text: "等一下",
        discarded: false,
      });
      expect(h.questions).toEqual(["问题", "等一下"]);
      expect(h.states.at(-1)).toBe("thinking");
    });

    it("播放结束后收到无效结果：回到 listening", async () => {
      const h = await started();
      await answeringRound(h);
      h.conv.sendAnswerDelta("最后一句话。", false);
      h.vad("speech-start");
      await h.feed(0.5, 1);
      h.fireDrained();

      h.vad("speech-end");
      h.voice({
        type: "done",
        sessionId: h.currentSessionId(),
        text: "嗯",
        discarded: false,
      });
      expect(h.questions).toEqual(["问题"]);
      expect(h.states.at(-1)).toBe("listening");
    });

    it("候选识别报错不打断仍在播放的回答", async () => {
      const h = await started();
      await answeringRound(h);
      h.conv.sendAnswerDelta("第一句。", false);
      vi.mocked(h.speech.stop).mockClear();

      h.vad("speech-start");
      await h.feed(0.5, 1);
      h.voice({
        type: "error",
        sessionId: h.currentSessionId(),
        code: "VOICE_ENGINE_FAILED",
        message: "asr failed",
      });

      expect(h.errors).toEqual(["VOICE_ENGINE_FAILED"]);
      expect(h.speech.stop).not.toHaveBeenCalled();
      expect(h.states.at(-1)).toBe("speaking");
    });

    it("播放结束后识别报错：回到 listening", async () => {
      const h = await started();
      await answeringRound(h);
      h.conv.sendAnswerDelta("最后一句话。", false);
      h.vad("speech-start");
      await h.feed(0.5, 1);
      h.fireDrained();

      h.voice({
        type: "error",
        sessionId: h.currentSessionId(),
        code: "VOICE_ENGINE_FAILED",
        message: "asr failed",
      });
      expect(h.states.at(-1)).toBe("listening");
    });

    // 一句话说到一半，播放正好播完：这一整段话仍然是打断候选。
    // 中途改判的话，跟在后面的"嗯"会被当成新问题发出去。
    it("播放播完后接着说的续话仍是候选", async () => {
      const h = await started();
      await answeringRound(h);
      h.conv.sendAnswerDelta("第一句。", false);

      h.vad("speech-start");
      await h.feed(0.5, 1);
      h.fireDrained(); // 播放播完，候选会话还开着
      h.vad("speech-end");

      h.vad("speech-start"); // 接着说
      await h.feed(0.5, 1);
      h.vad("speech-end");
      h.voice({
        type: "done",
        sessionId: h.currentSessionId(),
        text: "嗯",
        discarded: false,
      });

      expect(h.questions).toEqual(["问题"]);
      expect(h.states.at(-1)).toBe("listening");
    });

    // 「嗯」在没有打断的上下文里就是一句正常提问，应当发出去。
    it("普通收音中的短词照常提交", async () => {
      const h = await started();
      h.vad("speech-start");
      await h.feed(0.5, 1);
      h.vad("speech-end");
      h.voice({
        type: "done",
        sessionId: h.currentSessionId(),
        text: "嗯",
        discarded: false,
      });
      expect(h.questions).toEqual(["嗯"]);
    });
  });

  it("静音后不再送音频给 VAD 与 ASR，在收的一轮被丢掉", async () => {
    const h = await started();
    h.vad("speech-start");
    await h.feed(0.5, 1);
    const framesBefore = h.pushedFrames.length;
    expect(framesBefore).toBeGreaterThan(0);
    const monitorBefore = h.monitorCalls.frames;

    const stopsBefore = vi.mocked(h.speech.stop).mock.calls.length;

    h.conv.setMuted(true);

    expect(h.states.at(-1)).toBe("muted");
    expect(h.cancel).toHaveBeenCalledTimes(1);
    // 静音只关麦克风：正在播的回答不停
    expect(vi.mocked(h.speech.stop).mock.calls.length).toBe(stopsBefore);

    await h.feed(0.5, 3);
    expect(h.monitorCalls.frames).toBe(monitorBefore);
    expect(h.pushedFrames.length).toBe(framesBefore);
    expect(h.questions).toEqual([]);
    // 音量也归零：否则球还在跟着环境声闪，看着就像还在听
    expect(h.levels.at(-1)).toBe(0);
  });

  it("解除静音先复位 VAD，随后的第一句立刻进 ASR", async () => {
    const h = await started();
    h.conv.setMuted(true);
    const resets = h.monitorCalls.resets;

    h.conv.setMuted(false);

    expect(h.monitorCalls.resets).toBe(resets + 1);
    expect(h.states.at(-1)).toBe("listening");

    h.vad("speech-start");
    await h.feed(0.5, 1);
    expect(h.pushedFrames.length).toBeGreaterThan(0);
  });
});

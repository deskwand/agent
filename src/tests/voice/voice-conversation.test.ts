import { describe, it, expect, vi } from "vitest";
import { createVoiceConversation } from "../../renderer/hooks/useVoiceConversation";
import type { VoiceEvent } from "../../shared/ipc-types";
import type { StreamingSpeech } from "../../renderer/hooks/useStreamingSpeech";

function harness() {
  let samplesCb: ((pcm: Int16Array, level: number) => void) | null = null;
  let voiceCb: ((event: VoiceEvent) => void) | null = null;
  const pushed: ArrayBuffer[] = [];
  const states: string[] = [];
  const questions: string[] = [];
  const errors: string[] = [];
  let drainedCb: (() => void) | null = null;
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

  const conv = createVoiceConversation({
    startCapture: async (cb) => {
      samplesCb = cb;
      return { stop: () => {} };
    },
    voice: {
      start: async () => ({ ok: true, sessionId: "s1" }),
      pushAudio: async (_id, pcm) => {
        pushed.push(pcm);
      },
      stop: async () => {},
      cancel: async () => {},
      onEvent: (cb) => {
        voiceCb = cb;
        return () => {};
      },
    },
    speech,
    sendQuestion: (t) => questions.push(t),
    silenceMs: 800,
    onState: (s) => states.push(s),
    onLevel: () => {},
    onTranscript: () => {},
    onQuestion: () => {},
    onSentence: () => {},
    onError: (c) => errors.push(c),
  });

  return {
    conv,
    pushed,
    states,
    fireDrained: () => drainedCb?.(),
    questions,
    errors,
    speech,
    // 每帧之间让出一个微任务：真实世界里帧间隔 100ms，会话建立（voice.start）
    // 的 await 早就完成了；测试若同步连发，会在 sessionId 还没设上时就判定静音。
    feed: async (level: number, frames = 1) => {
      for (let i = 0; i < frames; i += 1) {
        samplesCb?.(new Int16Array(1600), level);
        await Promise.resolve();
      }
    },
    voice: (event: VoiceEvent) => voiceCb?.(event),
  };
}

async function calibrated() {
  const h = harness();
  await h.conv.start();
  await h.feed(0.02, 8); // 800ms 噪声底
  return h;
}

describe("createVoiceConversation", () => {
  it("calibrates for 800ms then listens", async () => {
    const h = await calibrated();
    expect(h.states.at(-1)).toBe("listening");
  });

  it("starts a round only after 150ms of speech", async () => {
    const h = await calibrated();
    await h.feed(0.9, 1);
    expect(h.states.at(-1)).toBe("listening");
    await h.feed(0.9, 1);
    expect(h.states.at(-1)).toBe("capturing");
  });

  it("sends the transcript after silence and enters thinking", async () => {
    const h = await calibrated();
    await h.feed(0.9, 3);
    await h.feed(0.02, 8);
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

  it("goes back to listening when nothing was recognised", async () => {
    const h = await calibrated();
    await h.feed(0.9, 3);
    await h.feed(0.02, 8);
    h.voice({ type: "done", sessionId: "s1", text: "", discarded: false });
    expect(h.questions).toEqual([]);
    expect(h.speech.begin).not.toHaveBeenCalled();
    expect(h.states.at(-1)).toBe("listening");
  });

  // 回补缓冲是"不切掉开头半个字"的唯一保障，而它很容易被提前清掉还不报错。
  it("prefills the new session with audio captured before speech started", async () => {
    const h = await calibrated();
    await h.feed(0.02, 4); // 说话前的 400ms 静音：应当进回补缓冲
    await h.feed(0.9, 2); // 说话起点
    await Promise.resolve();
    expect(h.pushed.length).toBeGreaterThan(0);
  });

  // 上一轮 stop 已发、done 未到时用户又开口：新音频不能推进那条已 closed 的流。
  it("starts a fresh round when speech resumes before the previous done arrives", async () => {
    const h = await calibrated();
    await h.feed(0.9, 3);
    await h.feed(0.02, 8); // 静音 → stop(s1)，等 done
    const before = h.pushed.length;
    await h.feed(0.9, 2);
    await Promise.resolve();
    expect(h.states.at(-1)).toBe("capturing");
    expect(h.pushed.length).toBeGreaterThan(before);
  });

  // 打断朗读比主动开口更需要确认：咳嗽、关门、拖椅子这类噪声常常刚过 150ms。
  // 时长挡的是短促噪声，阈值挡的是识别不出内容的弱信号（扬声器残留、混响）。
  // 只调其中一个，另一种照样会打断朗读 —— 而打断后 ASR 又什么都识别不出来。
  it("raises the level threshold while answering, not just the duration", async () => {
    const h = await calibrated();
    // 静音室标定：噪声底 0.02 → 阈值取下限 0.25
    await h.feed(0.9, 3);
    await h.feed(0.02, 8);
    h.voice({ type: "done", sessionId: "s1", text: "问题", discarded: false });
    vi.mocked(h.speech.stop).mockClear();

    // 回答期阈值是 0.25 + 0.15 = 0.40。0.30 在接收期够触发，在回答期不够。
    await h.feed(0.3, 6);
    expect(h.speech.stop).not.toHaveBeenCalled();

    // 朗读播完 → 回到接收期，同样的电平又能触发（说明是阈值在变，不是永久失灵）
    h.fireDrained();
    await h.feed(0.3, 3);
    expect(h.states.at(-1)).toBe("capturing");
  });

  it("needs a longer confirmation to interrupt while answering", async () => {
    const h = await calibrated();
    await h.feed(0.9, 3);
    await h.feed(0.02, 8);
    h.voice({ type: "done", sessionId: "s1", text: "问题", discarded: false });
    h.conv.sendAnswerDelta("第一句。", false); // 进入回答期
    vi.mocked(h.speech.stop).mockClear(); // 前面建会话时也 stop 过，这里只看打断

    await h.feed(0.9, 2); // 200ms：过了 150ms 的开口阈值，但没过 300ms 的打断阈值
    expect(h.speech.stop).not.toHaveBeenCalled();

    await h.feed(0.9, 2); // 累计 400ms → 这时才该打断
    expect(h.speech.stop).toHaveBeenCalled();
  });

  it("interrupts playback when the user speaks during speaking", async () => {
    const h = await calibrated();
    await h.feed(0.9, 3);
    await h.feed(0.02, 8);
    h.voice({ type: "done", sessionId: "s1", text: "问题", discarded: false });
    h.conv.sendAnswerDelta("第一句。", false);
    await h.feed(0.9, 3); // 打断按 300ms 判定，不是开口的 150ms
    expect(h.speech.stop).toHaveBeenCalled();
    expect(h.states.at(-1)).toBe("capturing");
  });

  it("blocked state refuses new questions", async () => {
    const h = await calibrated();
    h.conv.setBlocked(true);
    expect(h.states.at(-1)).toBe("blocked");
    await h.feed(0.9, 3);
    expect(h.states.at(-1)).toBe("blocked");
  });

  it("stop releases the microphone", async () => {
    const h = await calibrated();
    h.conv.stop();
    expect(h.states.at(-1)).toBe("stopped"); // 收尾态：不再监听
  });
});

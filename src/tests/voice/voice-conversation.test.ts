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
  const speech = {
    begin: vi.fn(),
    push: vi.fn(),
    end: vi.fn(),
    stop: vi.fn(),
    onSentence: vi.fn(),
    onDrained: vi.fn(),
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

  it("interrupts playback when the user speaks during speaking", async () => {
    const h = await calibrated();
    await h.feed(0.9, 3);
    await h.feed(0.02, 8);
    h.voice({ type: "done", sessionId: "s1", text: "问题", discarded: false });
    h.conv.sendAnswerDelta("第一句。", false);
    await h.feed(0.9, 2);
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

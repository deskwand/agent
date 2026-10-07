// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  createReadAloudController,
  type ReadAloudDeps,
} from "../../renderer/hooks/useReadAloud";
import type { SpeakStreamHandlers } from "../../renderer/utils/tts/speak-stream";
import type { SpeechTarget } from "../../renderer/utils/tts/speech-text";

function fakeDeps() {
  const requested: string[] = [];
  const streams: SpeakStreamHandlers[] = [];
  const cancelled: string[] = [];
  const enqueued: Array<{ sentenceIndex: number; samples: Float32Array }> = [];
  const highlights: Array<SpeechTarget | null> = [];
  let markLastCalls = 0;
  let onDrained: (() => void) | null = null;
  let onSentenceStart: ((index: number) => void) | null = null;

  const deps: ReadAloudDeps = {
    setState: vi.fn(),
    applyHighlight: (target) => {
      highlights.push(target);
    },
    speak: (text, handlers) => {
      requested.push(text);
      streams.push(handlers);
      return () => {
        cancelled.push(text);
      };
    },
    createQueue: () => ({
      enqueue: (item) => enqueued.push(item),
      markLast: () => {
        markLastCalls += 1;
      },
      // controller 只靠它更新 currentIndex 与高亮
      onSentenceStart: (cb) => {
        onSentenceStart = cb;
      },
      onDrained: (cb) => {
        onDrained = cb;
      },
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(),
      playing: () => true,
    }),
  };
  return {
    deps,
    requested,
    enqueued,
    cancelled,
    highlights,
    streamAt: (i: number) => streams[i],
    markLastCalls: () => markLastCalls,
    drain: () => onDrained?.(),
    fireSentenceStart: (index: number) => onSentenceStart?.(index),
  };
}

const chunk = (length = 10) => ({
  samples: new Float32Array(length),
  sampleRate: 44100,
});

function messageRoot() {
  const root = document.createElement("div");
  root.innerHTML = "<p>第一句。第二句。第三句。</p>";
  document.body.appendChild(root);
  return root;
}

/** 20 句的正文：每句 4 字，5 块正好落在 4 句一块的边界上。 */
function longRoot(count: number) {
  const root = document.createElement("div");
  root.innerHTML = `<p>${Array.from(
    { length: count },
    (_, i) => `第${i + 1}句。`,
  ).join("")}</p>`;
  document.body.appendChild(root);
  return root;
}

describe("朗读会话", () => {
  it("开始后进入准备态，拿到第一句就开播", async () => {
    const harness = fakeDeps();
    const controller = createReadAloudController(harness.deps);

    controller.start("m1", messageRoot());
    expect(controller.getState().status).toBe("preparing");

    harness.streamAt(0).onChunk(chunk());
    await vi.waitFor(() =>
      expect(controller.getState().status).toBe("playing"),
    );
    expect(harness.enqueued).toHaveLength(1);
  });

  it("短消息（≤4 句）仍然只发一次请求", () => {
    const harness = fakeDeps();
    const controller = createReadAloudController(harness.deps);

    controller.start("m1", messageRoot());

    expect(harness.requested).toEqual(["第一句。第二句。第三句。"]);
    harness.streamAt(0).onChunk(chunk());
    harness.streamAt(0).onDone();
    expect(harness.markLastCalls()).toBe(1);
  });

  it("长消息分块读到底：20 句 → 5 块，全部播完才收尾", () => {
    const harness = fakeDeps();
    const controller = createReadAloudController(harness.deps);

    controller.start("m1", longRoot(20));
    expect(harness.requested[0]).toBe("第1句。第2句。第3句。第4句。");

    // 一块一块走完 —— 旧实现只发第 1 块（pump 只被 index 0 调过）
    for (let i = 0; i < 5; i++) {
      harness.streamAt(i).onChunk(chunk());
      harness.streamAt(i).onDone();
    }
    expect(harness.requested).toHaveLength(5);
    expect(harness.requested[4]).toBe("第17句。第18句。第19句。第20句。");
    expect(harness.markLastCalls()).toBe(1); // 只有最后一块打标
    harness.drain();
    expect(controller.getState().status).toBe("idle");
    expect(controller.getState().messageId).toBeNull();
  });

  it("串行抢跑：上一块合成结束才发下一块，不出声就最多一个在飞", () => {
    const harness = fakeDeps();
    const controller = createReadAloudController(harness.deps);
    controller.start("m1", longRoot(8)); // 2 块

    // 第 1 块开始出声：这时**不该**有第 2 个请求（串行，不是并发）
    harness.streamAt(0).onChunk(chunk());
    expect(harness.requested).toHaveLength(1);

    // 第 1 块合成结束 → 第 2 块立刻发（不等第 1 块播完）
    harness.streamAt(0).onDone();
    expect(harness.requested).toHaveLength(2);
    expect(harness.requested[1]).toBe("第5句。第6句。第7句。第8句。");
  });

  it("进度按句上报，不按块", () => {
    const harness = fakeDeps();
    const controller = createReadAloudController(harness.deps);
    controller.start("m1", longRoot(8));

    expect(controller.getState().total).toBe(8);

    harness.streamAt(0).onChunk(chunk());
    harness.fireSentenceStart(0);
    expect(controller.getState().currentIndex).toBe(0);

    harness.streamAt(0).onDone();
    harness.streamAt(1).onChunk(chunk());
    harness.fireSentenceStart(1);
    expect(controller.getState().currentIndex).toBe(4); // 第 2 块从第 5 句开始
  });

  it("高亮按块推进，不是整条一次亮", () => {
    const harness = fakeDeps();
    const controller = createReadAloudController(harness.deps);
    controller.start("m1", longRoot(8));

    harness.streamAt(0).onChunk(chunk());
    harness.fireSentenceStart(0);
    harness.streamAt(0).onDone();
    harness.streamAt(1).onChunk(chunk());
    harness.fireSentenceStart(1);

    // 两块各有自己的 target（spanSpeechTargets 每块新建一个对象）：整条一次亮会两次相同。
    // reset 会先把高亮清成 null，所以只看非 null 的那两次。
    const lit = harness.highlights.filter((target) => target !== null);
    expect(lit).toHaveLength(2);
    expect(lit[1]).not.toBe(lit[0]);
  });

  it("合成失败进错误态并停止", async () => {
    const harness = fakeDeps();
    const controller = createReadAloudController(harness.deps);
    controller.start("m1", messageRoot());

    harness.streamAt(0).onError("model file missing");
    await vi.waitFor(() => expect(controller.getState().status).toBe("error"));
    expect(controller.getState().error).toContain("missing");
  });

  it("停止会清空当前朗读", () => {
    const harness = fakeDeps();
    const controller = createReadAloudController(harness.deps);
    controller.start("m1", messageRoot());

    controller.stop();
    expect(controller.getState().status).toBe("idle");
    expect(controller.getState().messageId).toBeNull();
  });

  it("读 A 时开始读 B：A 的旧结果作废，不污染 B 的队列", async () => {
    const harness = fakeDeps();
    const controller = createReadAloudController(harness.deps);
    const a = messageRoot();
    const b = messageRoot();

    controller.start("mA", a);
    expect(controller.getState().messageId).toBe("mA");

    controller.start("mB", b);
    expect(controller.getState().messageId).toBe("mB");

    // A 的第 1 句迟到了：它现在属于上一个场次，必须被丢弃
    harness.streamAt(0).onChunk(chunk());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.enqueued).toHaveLength(0);
    expect(harness.cancelled).toEqual(["第一句。第二句。第三句。"]); // 切换时取消在飞的流（现在是整条）
    harness.drain(); // 清掉 B 之前那段旧队列
    harness.enqueued.length = 0;

    // 而 B 的第 1 句仍然要正常入队 —— 这条才是「切换没把新会话弄坏」的证据
    harness.streamAt(1).onChunk(chunk());
    await vi.waitFor(() => expect(harness.enqueued).toHaveLength(1));
    expect(harness.enqueued[0].sentenceIndex).toBe(0);
    expect(controller.getState().messageId).toBe("mB");
  });

  it("停止后迟到的合成结果不再入队", async () => {
    const harness = fakeDeps();
    const controller = createReadAloudController(harness.deps);
    controller.start("m1", messageRoot());

    controller.stop();
    harness.streamAt(0).onChunk(chunk());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.enqueued).toHaveLength(0);
    expect(controller.getState().status).toBe("idle");
  });

  it("没有可读文字的段落不开播", () => {
    const harness = fakeDeps();
    const controller = createReadAloudController(harness.deps);
    const empty = document.createElement("div");
    empty.innerHTML = "<pre></pre>";
    document.body.appendChild(empty);

    controller.start("m1", empty);
    // 纯空代码块 → 「代码块，共 0 行」也被过滤掉
    expect(harness.requested).toHaveLength(0);
  });
});

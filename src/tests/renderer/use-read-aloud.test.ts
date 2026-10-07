// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  createReadAloudController,
  type ReadAloudDeps,
} from "../../renderer/hooks/useReadAloud";
import type { SpeakStreamHandlers } from "../../renderer/utils/tts/speak-stream";

function fakeDeps() {
  const requested: string[] = [];
  const streams: SpeakStreamHandlers[] = [];
  const cancelled: string[] = [];
  const enqueued: Array<{ sentenceIndex: number; samples: Float32Array }> = [];
  let markLastCalls = 0;
  let onDrained: (() => void) | null = null;

  const deps: ReadAloudDeps = {
    setState: vi.fn(),
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
      // 高亮回调这里不关心 —— controller 只靠它更新 currentIndex
      onSentenceStart: () => {},
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
    streamAt: (i: number) => streams[i],
    markLastCalls: () => markLastCalls,
    drain: () => onDrained?.(),
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

  it("整条消息一次请求：一次合成覆盖全部句子（换音色的边界归零）", async () => {
    const harness = fakeDeps();
    const controller = createReadAloudController(harness.deps);

    controller.start("m1", messageRoot());

    // 关键：只发一次，且文本是拼好的整条 —— 最佳档每次请求都重新采样，
    // 请求越少、句子之间换音色的机会越少。
    expect(harness.requested).toEqual(["第一句。第二句。第三句。"]);

    harness.streamAt(0).onChunk(chunk());
    harness.streamAt(0).onDone();
    await vi.waitFor(() => expect(harness.enqueued).toHaveLength(1));
  });

  it("全部播完回到 idle 并清掉消息归属", async () => {
    const harness = fakeDeps();
    const controller = createReadAloudController(harness.deps);
    controller.start("m1", messageRoot());

    // 现在是整条一次请求：一条流走完就该收尾
    harness.streamAt(0).onChunk(chunk());
    await vi.waitFor(() => expect(harness.enqueued.length).toBeGreaterThan(0));
    harness.streamAt(0).onDone();
    expect(harness.markLastCalls()).toBe(1); // 整条打一次标
    harness.drain();
    expect(controller.getState().status).toBe("idle");
    expect(controller.getState().messageId).toBeNull();
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

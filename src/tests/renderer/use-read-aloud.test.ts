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
  const contexts: Array<{ segmentCount: number }> = [];
  const enqueued: Array<{ sentenceIndex: number; samples: Float32Array }> = [];
  let markLastCalls = 0;
  let onDrained: (() => void) | null = null;

  const deps: ReadAloudDeps = {
    setState: vi.fn(),
    speak: (text, handlers, context) => {
      requested.push(text);
      contexts.push(context);
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
    contexts,
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
  it("把整篇段数交给 speak：默认实现据此在多段时让位给均衡档", async () => {
    const harness = fakeDeps();
    const controller = createReadAloudController(harness.deps);
    const root = document.createElement("div");
    root.innerHTML = "<p>第一段。</p><p>第二段。</p>";
    document.body.appendChild(root);

    controller.start("m1", root);
    // 流水线：先发第一段，第一段结束才发第二段 —— 两段拿到的都是"整篇 2 段"
    expect(harness.contexts.map((c) => c.segmentCount)).toEqual([2]);
    harness.streamAt(0).onDone();
    expect(harness.contexts.map((c) => c.segmentCount)).toEqual([2, 2]);

    // 单段时报告 1 —— 没有跨段漂移问题，仍然是用户选的档。
    // 注意 `extractSpeechSegments` 是**按句**切的：一个 <p> 里三句话就是 3 段，
    // 所以"一句话"才是单段。
    const single = fakeDeps();
    const one = document.createElement("div");
    one.innerHTML = "<p>只有一句话。</p>";
    document.body.appendChild(one);
    createReadAloudController(single.deps).start("m2", one);
    expect(single.contexts[0].segmentCount).toBe(1);
  });

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

  it("第一句还在播时就请求第二句（流水线）", async () => {
    const harness = fakeDeps();
    const controller = createReadAloudController(harness.deps);

    controller.start("m1", messageRoot());
    harness.streamAt(0).onChunk(chunk());
    harness.streamAt(0).onDone();
    await vi.waitFor(() => expect(harness.requested).toHaveLength(2));
    // 第二句还没播（第一句没结束），但已经发出去了
    expect(harness.enqueued).toHaveLength(1);
  });

  it("全部播完回到 idle 并清掉消息归属", async () => {
    const harness = fakeDeps();
    const controller = createReadAloudController(harness.deps);
    controller.start("m1", messageRoot());

    for (let i = 0; i < 3; i++) {
      harness.streamAt(i).onChunk(chunk());
      await vi.waitFor(() =>
        expect(harness.enqueued.length).toBeGreaterThan(i),
      );
      harness.streamAt(i).onDone();
    }
    expect(harness.markLastCalls()).toBe(1); // 只有最后一段打标
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
    expect(harness.cancelled).toEqual(["第一句。"]); // 切换时要取消在飞的流
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

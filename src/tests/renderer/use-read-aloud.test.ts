// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  createReadAloudController,
  type ReadAloudDeps,
} from "../../renderer/hooks/useReadAloud";

function fakeDeps() {
  const requested: string[] = [];
  const resolvers: Array<(value: unknown) => void> = [];
  const enqueued: Array<{ index: number; samples: Float32Array }> = [];
  let onDrained: (() => void) | null = null;

  const deps: ReadAloudDeps = {
    setState: vi.fn(),
    speak: (text) => {
      requested.push(text);
      return new Promise((resolve) => {
        resolvers.push((value) => resolve(value as never));
      }) as never;
    },
    createQueue: () => ({
      enqueue: (item) => enqueued.push(item),
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
    resolveNext: () =>
      resolvers.shift()?.({
        ok: true,
        samples: new Float32Array(10),
        sampleRate: 44100,
      }),
    failNext: (error: string) => resolvers.shift()?.({ ok: false, error }),
    drain: () => onDrained?.(),
  };
}

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

    harness.resolveNext();
    await vi.waitFor(() =>
      expect(controller.getState().status).toBe("playing"),
    );
    expect(harness.enqueued).toHaveLength(1);
  });

  it("第一句还在播时就请求第二句（流水线）", async () => {
    const harness = fakeDeps();
    const controller = createReadAloudController(harness.deps);

    controller.start("m1", messageRoot());
    harness.resolveNext();
    await vi.waitFor(() => expect(harness.requested).toHaveLength(2));
    // 第二句还没播（第一句没结束），但已经发出去了
    expect(harness.enqueued).toHaveLength(1);
  });

  it("全部播完回到 idle 并清掉消息归属", async () => {
    const harness = fakeDeps();
    const controller = createReadAloudController(harness.deps);
    controller.start("m1", messageRoot());

    for (let i = 0; i < 3; i++) {
      harness.resolveNext();
      await vi.waitFor(() =>
        expect(harness.enqueued.length).toBeGreaterThan(i),
      );
    }
    harness.drain();
    expect(controller.getState().status).toBe("idle");
    expect(controller.getState().messageId).toBeNull();
  });

  it("合成失败进错误态并停止", async () => {
    const harness = fakeDeps();
    const controller = createReadAloudController(harness.deps);
    controller.start("m1", messageRoot());

    harness.failNext("model file missing");
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
    harness.resolveNext();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.enqueued).toHaveLength(0);

    // 而 B 的第 1 句仍然要正常入队 —— 这条才是「切换没把新会话弄坏」的证据
    harness.resolveNext();
    await vi.waitFor(() => expect(harness.enqueued).toHaveLength(1));
    expect(harness.enqueued[0].index).toBe(0);
    expect(controller.getState().messageId).toBe("mB");
  });

  it("停止后迟到的合成结果不再入队", async () => {
    const harness = fakeDeps();
    const controller = createReadAloudController(harness.deps);
    controller.start("m1", messageRoot());

    controller.stop();
    harness.resolveNext();
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

// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  createFeedListenController,
  type FeedListenDeps,
} from "../../renderer/hooks/useFeedListen";
import type { SpeakStreamHandlers } from "../../renderer/utils/tts/speak-stream";

function fakeDeps() {
  const requested: string[] = [];
  const streams: SpeakStreamHandlers[] = [];
  const enqueued: Array<{ sentenceIndex: number; samples: Float32Array }> = [];
  const closed: number[] = [];
  let markLastCalls = 0;
  let stopCalls = 0;
  let pauseCalls = 0;
  let resumeCalls = 0;
  let onDrained: (() => void) | null = null;
  let onSentenceStart: ((index: number) => void) | null = null;

  const queue = {
    enqueue: (entry: { sentenceIndex: number; samples: Float32Array }) =>
      enqueued.push(entry),
    markLast: () => {
      markLastCalls += 1;
    },
    onSentenceStart: (cb: (index: number) => void) => {
      onSentenceStart = cb;
    },
    onDrained: (cb: () => void) => {
      onDrained = cb;
    },
    pause: () => {
      pauseCalls += 1;
    },
    resume: () => {
      resumeCalls += 1;
    },
    stop: () => {
      stopCalls += 1;
    },
    playing: () => true,
  };
  const createQueue = vi.fn(() => queue);
  const deps: FeedListenDeps = {
    setState: vi.fn(),
    createContext: () =>
      ({
        close: async () => {
          closed.push(closed.length);
        },
      }) as unknown as AudioContext,
    createQueue,
    speak: (text, handlers) => {
      requested.push(text);
      streams.push(handlers);
      return () => {};
    },
  };
  return {
    deps,
    requested,
    enqueued,
    closed,
    createQueueCalls: () => createQueue.mock.calls.length,
    streamAt: (i: number) => streams[i]!,
    markLastCalls: () => markLastCalls,
    stopCalls: () => stopCalls,
    pauseCalls: () => pauseCalls,
    resumeCalls: () => resumeCalls,
    drain: () => onDrained?.(),
    fireSentenceStart: (index: number) => onSentenceStart?.(index),
  };
}

function item(id: string, script: string) {
  return { id, title: id, sourceHost: "a.com", imageUrl: null, script };
}

/** 让第 i 个请求出声并结束。 */
function finish(fake: ReturnType<typeof fakeDeps>, i: number): void {
  fake.streamAt(i).onChunk({ samples: new Float32Array(4), sampleRate: 1 });
  fake.streamAt(i).onDone();
}

describe("feed listen controller（核心）", () => {
  it("跨条目抢跑：上一条最后一块合成结束，立刻发下一条第一块", () => {
    const fake = fakeDeps();
    const controller = createFeedListenController(fake.deps);
    controller.start([item("a", "一。二。三。四。五。"), item("b", "六。")]);

    expect(fake.requested).toHaveLength(1); // 一次只有一个请求在飞
    finish(fake, 0); // 块 1（四句）
    expect(fake.requested).toHaveLength(2);
    finish(fake, 1); // 块 2（一句）
    expect(fake.requested).toHaveLength(3);
    expect(fake.requested[2]).toContain("六。"); // 已经是下一条的稿子
    finish(fake, 2); // 下一条也出声
    // 入队的句子序号：条内按块递增、跨条回到 0（进度条按句推进的地基）
    expect(fake.enqueued.map((entry) => entry.sentenceIndex)).toEqual([
      0, 1, 2,
    ]);
  });

  it("全场最后一块结束时才 markLast，队列播空即收尾并关掉 context", () => {
    const fake = fakeDeps();
    const controller = createFeedListenController(fake.deps);
    controller.start([item("a", "一。"), item("b", "二。")]);

    finish(fake, 0);
    expect(fake.markLastCalls()).toBe(0); // 后面还有人
    finish(fake, 1);
    expect(fake.markLastCalls()).toBe(1);

    fake.drain();
    expect(controller.getState().session).toBeNull();
    expect(fake.closed).toHaveLength(1);
  });

  it("卡片/跟随/已读都跟着**正在播的那一条**走，不是跟着合成走的", () => {
    const fake = fakeDeps();
    const controller = createFeedListenController(fake.deps);
    const changed: string[] = [];
    const finished: string[] = [];
    controller.start([item("a", "一。"), item("b", "二。")], {
      onItemChanged: (id) => changed.push(id),
      onItemFinished: (id) => finished.push(id),
    });
    expect(changed).toEqual(["a"]);

    // 合成跑在播放前面：a 的块合成完，pump 已经把 b 也发出去了 —— 但 a 还没出声
    finish(fake, 0);
    expect(fake.requested).toHaveLength(2);
    expect(controller.getState().session?.index).toBe(0);
    expect(changed).toEqual(["a"]);
    expect(finished).toEqual([]);

    // a 的那块开始播：显示仍是 a
    fake.fireSentenceStart(0);
    expect(controller.getState().session?.index).toBe(0);

    // b 的第一块开始播 —— 到这一刻才算「a 播完了」并且卡片切到 b
    fake.fireSentenceStart(1);
    expect(controller.getState().session?.index).toBe(1);
    expect(changed).toEqual(["a", "b"]);
    expect(finished).toEqual(["a"]);
  });

  it("每一条的逐句进度都跟着播放推（不被队列的去重吞掉）", () => {
    const fake = fakeDeps();
    const controller = createFeedListenController(fake.deps);
    controller.start([item("a", "一。二。"), item("b", "三。四。五。")]);
    finish(fake, 0); // a 合成完 → 请求 b
    finish(fake, 1);

    fake.fireSentenceStart(0); // a 第 1 块开始播
    expect(controller.getState().progress).toEqual({ current: 0, total: 2 });
    fake.fireSentenceStart(1); // b 第 1 块开始播
    expect(controller.getState().session?.index).toBe(1);
    expect(controller.getState().progress).toEqual({ current: 0, total: 3 });
  });

  it("极短稿子（一句、无句末标点）也能播完：不会在出声前就被判读完", () => {
    const fake = fakeDeps();
    const controller = createFeedListenController(fake.deps);
    controller.start([item("a", "只有一句话没有结束标点")]);
    expect(fake.streamAt(0)).toBeDefined();
    finish(fake, 0);
    expect(fake.markLastCalls()).toBe(1);
    fake.drain();
    expect(controller.getState().status).toBe("idle");
  });

  it("stop() 关掉 context 并清空会话；暂停/恢复真的走队列", () => {
    const fake = fakeDeps();
    const controller = createFeedListenController(fake.deps);
    controller.start([item("a", "一。二。")]);
    controller.toggle();
    expect(controller.getState().status).toBe("paused");
    expect(fake.pauseCalls()).toBe(1); // 只翻状态不算暂停：必须真的挂起队列
    controller.toggle();
    expect(controller.getState().status).toBe("playing");
    expect(fake.resumeCalls()).toBe(1);
    controller.stop();
    expect(controller.getState().session).toBeNull();
    expect(fake.closed).toHaveLength(1);
  });

  it("连做 3 场会话，每场都关掉自己的 context", () => {
    const fake = fakeDeps();
    const controller = createFeedListenController(fake.deps);
    for (let i = 0; i < 3; i += 1) {
      controller.start([item(`i${i}`, "一。")]);
      controller.stop();
    }
    expect(fake.closed).toHaveLength(3);
  });

  it("一场会话只建一条队列（条目边界不换队列 —— 无缝的前提）", () => {
    const fake = fakeDeps();
    const controller = createFeedListenController(fake.deps);
    controller.start([item("a", "一。"), item("b", "二。")]);
    finish(fake, 0);
    finish(fake, 1);
    expect(fake.createQueueCalls()).toBe(1);
    expect(fake.stopCalls()).toBe(0); // 条目之间不停队列
  });

  it("进度按句推进：队列报哪一块开始播，progress 就跟到那块的首句", () => {
    const fake = fakeDeps();
    const controller = createFeedListenController(fake.deps);
    // 5 句 → 2 块：第 0 块首句 0，第 1 块首句 4
    controller.start([item("a", "一。二。三。四。五。")]);
    fake.fireSentenceStart(0);
    expect(controller.getState().progress).toEqual({ current: 0, total: 5 });
    finish(fake, 0); // 第 0 块合成完 → 第 1 块（全局 1）开始合成
    fake.fireSentenceStart(1);
    expect(controller.getState().progress).toEqual({ current: 4, total: 5 });
  });

  it("会话用快照：start 之后外部改数组不影响播放内容", () => {
    const fake = fakeDeps();
    const controller = createFeedListenController(fake.deps);
    const items = [item("a", "一。"), item("b", "二。")];
    controller.start(items);
    items.splice(1, 1); // 模拟 store 列表被整体替换 / 条目消失
    finish(fake, 0);
    expect(fake.requested[1]).toContain("二。");
  });
});

describe("失败分级与跳过", () => {
  it("开场第一条就失败 → 停会话 + error（多半是引擎没装好，不装作在播）", () => {
    const fake = fakeDeps();
    const controller = createFeedListenController(fake.deps);
    controller.start([item("a", "一。"), item("b", "二。")]);
    fake.streamAt(0).onError("model not installed");
    expect(controller.getState().status).toBe("error");
    expect(controller.getState().session).toBeNull();
    expect(fake.closed).toHaveLength(1);
  });

  it("已经播过声音之后，单条失败 → 跳过该条继续，skipped 计数，且那条不写已读", () => {
    const fake = fakeDeps();
    const controller = createFeedListenController(fake.deps);
    const finished: string[] = [];
    controller.start(
      [item("a", "一。"), item("b", "二。"), item("c", "三。")],
      {
        onItemFinished: (id) => finished.push(id),
      },
    );
    finish(fake, 0);
    fake.fireSentenceStart(0); // a 真的播了
    fake.streamAt(1).onError("boom"); // b 首块就失败 → 跳过
    finish(fake, 2); // c 合成完
    expect(controller.getState().skipped).toBe(1);
    // c 开始播 → 到这一刻才算 a 播完；被跳过的 b 永远不写已读
    fake.fireSentenceStart(2);
    expect(controller.getState().session?.index).toBe(2);
    expect(finished).toEqual(["a"]);
  });

  it("块已出声后失败 → 当这一块结束、继续下一条（不弹错误，用户已经听到了）", () => {
    const fake = fakeDeps();
    const controller = createFeedListenController(fake.deps);
    controller.start([item("a", "一。"), item("b", "二。")]);
    fake.streamAt(0).onChunk({ samples: new Float32Array(4), sampleRate: 1 });
    fake.streamAt(0).onError("late failure");
    expect(controller.getState().status).not.toBe("error");
    expect(fake.requested[1]).toContain("二。"); // 已经进下一条
  });

  it("末条失败也能收尾：播放条不会永远挂着", () => {
    const fake = fakeDeps();
    const controller = createFeedListenController(fake.deps);
    controller.start([item("a", "一。"), item("b", "二。")]);
    finish(fake, 0);
    fake.streamAt(1).onError("boom");
    expect(fake.markLastCalls()).toBe(1);
    fake.drain();
    expect(controller.getState().session).toBeNull();
    expect(fake.closed).toHaveLength(1);
  });

  it("下一条：立刻停当前音频、切到下一条开头，且不写已读", () => {
    const fake = fakeDeps();
    const controller = createFeedListenController(fake.deps);
    const finished: string[] = [];
    controller.start([item("a", "一。二。三。四。五。"), item("b", "六。")], {
      onItemFinished: (id) => finished.push(id),
    });
    controller.next();
    expect(finished).toEqual([]); // 没播完就不算已读
    expect(fake.stopCalls()).toBe(1); // 已排期的旧音频被停掉
    expect(fake.requested[1]).toContain("六。");
    expect(controller.getState().session?.index).toBe(1);
  });

  it("上一条：回到上一条的开头；已是首条时不动作", () => {
    const fake = fakeDeps();
    const controller = createFeedListenController(fake.deps);
    controller.start([item("a", "一。"), item("b", "二。")]);
    finish(fake, 0); // 到 b
    controller.prev();
    expect(controller.getState().session?.index).toBe(0);
    expect(fake.requested.at(-1)).toContain("一。");
    controller.prev();
    expect(controller.getState().session?.index).toBe(0);
  });

  it("暂停时按「下一条」保持暂停；末条按「下一条」等于结束会话", () => {
    const fake = fakeDeps();
    const controller = createFeedListenController(fake.deps);
    controller.start([item("a", "一。"), item("b", "二。")]);
    controller.toggle(); // 暂停
    controller.next();
    expect(controller.getState().session?.index).toBe(1);
    expect(controller.getState().status).toBe("paused"); // 不擅自开始播
    expect(fake.pauseCalls()).toBe(2); // 一次 toggle、一次切条后重新挂起

    controller.next(); // 末条没有下一条：结束会话
    expect(controller.getState().session).toBeNull();
    expect(fake.closed).toHaveLength(1);
  });

  it("迟到的旧回调不会污染新条目（generation 守卫）", () => {
    const fake = fakeDeps();
    const controller = createFeedListenController(fake.deps);
    controller.start([item("a", "一。"), item("b", "二。")]);
    const stale = fake.streamAt(0);
    controller.next();
    stale.onDone(); // 切走之后旧请求才结束
    expect(controller.getState().session?.index).toBe(1);
    expect(fake.requested).toHaveLength(2); // 没有被旧回调再推一次
  });

  it("next / prev 不换 context（一场会话只建一个）", () => {
    const fake = fakeDeps();
    const controller = createFeedListenController(fake.deps);
    controller.start([item("a", "一。"), item("b", "二。"), item("c", "三。")]);
    controller.next();
    controller.next();
    controller.prev();
    controller.stop();
    expect(fake.closed).toHaveLength(1);
  });
});

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../renderer/store";
import {
  setFeedListenControllerForTests,
  type FeedListenCallbacks,
  type FeedListenController,
  type FeedListenStartResult,
  type FeedListenState,
} from "../../renderer/hooks/useFeedListen";
import type { FeedItemWithMeta } from "../../shared/feed";

function feedItem(overrides: Partial<FeedItemWithMeta> = {}): FeedItemWithMeta {
  return {
    id: "a",
    run_id: "r1",
    title: "A",
    summary: null,
    url: "https://a.com/1",
    url_key: "a.com/1",
    source_host: "a.com",
    topic: null,
    relevance: null,
    body_status: "ok",
    image_url: null,
    image_file: null,
    image_status: "none",
    created_at: 1,
    published_at: null,
    read_at: null,
    dismissed_at: null,
    unprocessed: 0,
    imageUrl: null,
    ...overrides,
  };
}

/** 假控制器：只记录 start 调用，并把回调交给测试手动触发 —— 不碰 AudioContext。 */
function fakeController() {
  const state: FeedListenState = {
    session: null,
    status: "idle",
    progress: null,
    skipped: 0,
  };
  let started: {
    items: Array<{ id: string }>;
    callbacks?: FeedListenCallbacks;
  } | null = null;
  const start = vi.fn(
    (
      items: Array<{ id: string }>,
      callbacks?: FeedListenCallbacks,
    ): FeedListenStartResult => {
      started = { items, callbacks };
      // 与真控制器的语义一致：空队列 = "empty"
      return items.length === 0 ? "empty" : "started";
    },
  );
  const controller: FeedListenController = {
    getState: () => state,
    start,
    toggle: vi.fn(),
    next: vi.fn(),
    prev: vi.fn(),
    stop: vi.fn(),
  };
  return {
    controller,
    start,
    startedItems: () => started?.items.map((i) => i.id) ?? [],
    fireChanged: (id: string) => started?.callbacks?.onItemChanged?.(id),
    fireFinished: (id: string) => started?.callbacks?.onItemFinished?.(id),
    fireAborted: (error: string) => started?.callbacks?.onAborted?.(error),
  };
}

let fake = fakeController();

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  fake = fakeController();
  setFeedListenControllerForTests(fake.controller);
});

describe("startFeedListen", () => {
  it("「听全部」从第一条未读起，最多 20 条，只取有稿的", async () => {
    useAppStore.setState({
      feedItems: [
        feedItem({ id: "read", read_at: 5 }),
        feedItem({ id: "u1", url_key: "b" }),
        feedItem({ id: "u2", url_key: "c" }),
      ],
    });
    const getScripts = vi.fn(async () => ({ u1: "稿子一", u2: null }));
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      feed: { getScripts },
    };

    await useAppStore.getState().startFeedListen();

    expect(getScripts).toHaveBeenCalledWith(["u1", "u2"]);
    expect(fake.startedItems()).toEqual(["u1"]);
  });

  it("从给定条目起播（右栏「听这条」）", async () => {
    useAppStore.setState({
      feedItems: [
        feedItem({ id: "a", read_at: 1 }),
        feedItem({ id: "b", url_key: "b" }),
      ],
    });
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      feed: { getScripts: vi.fn(async () => ({ a: "稿A", b: "稿B" })) },
    };
    await useAppStore.getState().startFeedListen({ fromItemId: "b" });
    expect(fake.startedItems()).toEqual(["b"]);
  });

  it("队列上限 20 条：列表里有 25 条时只取前 20 条的稿子", async () => {
    const items = Array.from({ length: 25 }, (_, i) =>
      feedItem({ id: `i${i}`, url_key: `example.com/${i}` }),
    );
    useAppStore.setState({ feedItems: items });
    const getScripts = vi.fn(
      async (_ids: string[]): Promise<Record<string, string | null>> => ({}),
    );
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      feed: { getScripts },
    };

    await useAppStore.getState().startFeedListen();

    const ids = getScripts.mock.calls[0]![0] as string[];
    expect(ids).toHaveLength(20);
    expect(ids[0]).toBe("i0");
    expect(ids.at(-1)).toBe("i19");
  });

  it("一条有稿的都没有 → 交给控制器判空，给一次性空态", async () => {
    useAppStore.setState({ feedItems: [feedItem({ id: "a" })] });
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      feed: { getScripts: vi.fn(async () => ({ a: null })) },
    };
    await useAppStore.getState().startFeedListen();
    // store 不再自己复制一套「什么叫可播」：空队列交给控制器，返回值决定提示
    expect(fake.startedItems()).toEqual([]);
    expect(useAppStore.getState().feedListenNotice).toBe("empty");
  });

  it("会话进行中再点入口 → 重建会话（控制器 start 会先 reset）", async () => {
    useAppStore.setState({ feedItems: [feedItem({ id: "a" })] });
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      feed: { getScripts: vi.fn(async () => ({ a: "稿A" })) },
    };
    await useAppStore.getState().startFeedListen();
    await useAppStore.getState().startFeedListen();
    expect(fake.start).toHaveBeenCalledTimes(2);
  });

  it("连点两个入口：后点的那次说话，IPC 完成顺序不影响起点", async () => {
    useAppStore.setState({
      feedItems: [
        feedItem({ id: "a" }),
        feedItem({ id: "b", url_key: "example.com/b" }),
      ],
    });
    const pendingResolvers: Array<
      (value: Record<string, string | null>) => void
    > = [];
    const getScripts = vi.fn(
      (ids: string[]): Promise<Record<string, string | null>> =>
        new Promise((resolve) => {
          if (ids[0] === "a") {
            // 先点的那次故意晚回来
            pendingResolvers.push(resolve);
            return;
          }
          resolve({ b: "稿B" });
        }),
    );
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      feed: { getScripts },
    };

    const first = useAppStore.getState().startFeedListen({ fromItemId: "a" });
    const second = useAppStore.getState().startFeedListen({ fromItemId: "b" });
    await second;
    pendingResolvers[0]?.({ a: "稿A" });
    await first;

    expect(fake.startedItems()).toEqual(["b"]);
  });
});

describe("会话回调", () => {
  beforeEach(async () => {
    useAppStore.setState({ feedItems: [feedItem({ id: "a" })] });
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      feed: {
        getScripts: vi.fn(async () => ({ a: "稿A" })),
        markRead: vi.fn(async () => 0),
        getBody: vi.fn(async () => ({
          body: "正文",
          bodyStatus: "ok",
          excerpt: "摘录",
          hasScript: true,
        })),
        list: vi.fn(async () => null),
      },
    };
    await useAppStore.getState().startFeedListen();
  });

  it("条目切换 → 右栏跟随，但不写已读", () => {
    fake.fireChanged("a");
    expect(useAppStore.getState().feedOpenId).toBe("a");
    expect(
      (window as unknown as { electronAPI: { feed: { markRead: () => void } } })
        .electronAPI.feed.markRead,
    ).not.toHaveBeenCalled();
  });

  it("条目已经被清掉 → 不跟随，也不抛错", () => {
    useAppStore.setState({ feedItems: [] });
    expect(() => fake.fireChanged("a")).not.toThrow();
    expect(useAppStore.getState().feedOpenId).toBeNull();
  });

  it("条目自然播完 → 写已读", () => {
    fake.fireFinished("a");
    const markRead = (
      window as unknown as {
        electronAPI: { feed: { markRead: () => unknown } };
      }
    ).electronAPI.feed.markRead;
    expect(markRead).toHaveBeenCalledWith("a");
  });

  it("开场失败 → 弹全局错误提示，而不是静默无声", () => {
    fake.fireAborted("model not installed");
    expect(useAppStore.getState().globalNotice?.messageKey).toBe(
      "feed.listenFailed",
    );
    expect(useAppStore.getState().globalNotice?.type).toBe("error");
  });

  it("开播前先停掉消息朗读（两路音频不共存）", async () => {
    useAppStore.setState({
      readAloud: {
        ...useAppStore.getState().readAloud,
        messageId: "m1",
        status: "playing",
      },
    });
    await useAppStore.getState().startFeedListen(); // 再开一次：开播前会 stopReadAloud()
    expect(useAppStore.getState().readAloud.status).toBe("idle");
  });
});

describe("openFeedItem 的已读开关", () => {
  it("markRead:false 不调用 feed.markRead（右栏跟随用）", async () => {
    const markRead = vi.fn(async () => 0);
    const getBody = vi.fn(async () => ({
      body: "b",
      bodyStatus: "ok",
      excerpt: "e",
      hasScript: true,
    }));
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      // list 必备：openFeedItem 末尾会 refreshFeed()
      feed: { markRead, getBody, list: vi.fn(async () => null) },
    };
    useAppStore.setState({ feedItems: [feedItem({ id: "a" })] });
    await useAppStore.getState().openFeedItem("a", { markRead: false });
    expect(markRead).not.toHaveBeenCalled();
    expect(useAppStore.getState().feedOpenId).toBe("a");
  });
});

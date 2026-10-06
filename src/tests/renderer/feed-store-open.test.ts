// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAppStore } from "../../renderer/store";

// 整行都是点击区之后，openFeedItem 会被连点。两个必须锁住的行为：
//   1. 重复点同一条：早退，不重复标记已读、不重复打三次 IPC
//   2. 点在前的、慢在后：过期结果必须丢掉，否则右栏出现「B 的标题 + A 的正文」
function setWindowApi(feed: Record<string, unknown>) {
  (window as unknown as { electronAPI: Record<string, unknown> }).electronAPI =
    {
      openExternal: vi.fn(),
      feed: {
        list: vi.fn(async () => ({
          enabled: true,
          items: [],
          unreadCount: 0,
          lastRun: null,
        })),
        ...feed,
      },
    };
}

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
});

describe("openFeedItem", () => {
  it("重复点同一条只打一次 markRead 与 getBody", async () => {
    const markRead = vi.fn(async () => 0);
    const getBody = vi.fn(async () => ({ body: "正文", bodyStatus: "ok" }));
    setWindowApi({ markRead, getBody });

    await useAppStore.getState().openFeedItem("i1");
    await useAppStore.getState().openFeedItem("i1");

    expect(markRead).toHaveBeenCalledTimes(1);
    expect(getBody).toHaveBeenCalledTimes(1);
  });

  it("先点 A 再点 B，A 的正文晚回来也不会盖在 B 上面", async () => {
    let resolveA: (value: {
      body: string;
      bodyStatus: string;
    }) => void = () => {};
    const getBody = vi.fn(async (id: string) => {
      if (id === "A") {
        return new Promise<{ body: string; bodyStatus: string }>((resolve) => {
          resolveA = resolve;
        });
      }
      return { body: "B 的正文", bodyStatus: "ok" };
    });
    setWindowApi({ markRead: vi.fn(async () => 0), getBody });

    const openingA = useAppStore.getState().openFeedItem("A");
    await useAppStore.getState().openFeedItem("B");
    resolveA({ body: "A 的正文", bodyStatus: "ok" });
    await openingA;

    expect(useAppStore.getState().feedOpenId).toBe("B");
    expect(useAppStore.getState().feedBody?.body).toBe("B 的正文");
  });
});

// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    // 把插值参数拼进文本，否则「nextUpdate 传了空串」这种错断言不出来
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
  }),
}));

import { FeedView } from "../../renderer/components/FeedView";
import { useAppStore } from "../../renderer/store";
import { FEED_PHASES } from "../../shared/feed";
import type { FeedItemWithMeta, FeedRunSummary } from "../../shared/feed";

let container: HTMLDivElement;
let root: Root;

function makeItem(overrides: Partial<FeedItemWithMeta> = {}): FeedItemWithMeta {
  return {
    id: "i1",
    run_id: "r1",
    title: "第一条",
    summary: "摘要",
    url: "https://a.com/1",
    url_key: "a.com/1",
    source_host: "a.com",
    topic: "T",
    relevance: "r",
    body_status: "ok",
    image_url: null,
    image_file: null,
    image_status: "none",
    created_at: Date.now(),
    read_at: null,
    dismissed_at: null,
    unprocessed: 0,
    imageUrl: null,
    ...overrides,
  };
}

function makeRun(overrides: Partial<FeedRunSummary> = {}): FeedRunSummary {
  return {
    id: "r1",
    started_at: Date.now(),
    finished_at: Date.now(),
    status: "ok",
    error: null,
    queries: "[]",
    candidate_count: 1,
    item_count: 1,
    ...overrides,
  };
}

function snapshot(
  enabled: boolean,
  items: FeedItemWithMeta[] = [],
  lastRun: FeedRunSummary | null = null,
) {
  return {
    enabled,
    items,
    unreadCount: items.filter((item) => item.read_at === null).length,
    lastRun,
  };
}

function setWindowApi(
  listResult: unknown,
  overrides: Record<string, unknown> = {},
) {
  (window as unknown as { electronAPI: Record<string, unknown> }).electronAPI =
    {
      // 真机上 openExternal 就在顶层（preload/index.ts:301），不在 shell 下
      openExternal: vi.fn(),
      feed: {
        list: vi.fn(async () => listResult),
        getBody: vi.fn(async () => ({ body: "正文", bodyStatus: "ok" })),
        setEnabled: vi.fn(async () => ({ enabled: true, started: true })),
        markRead: vi.fn(async () => 0),
        markAllRead: vi.fn(async () => 0),
        dismiss: vi.fn(async () => 0),
        clearAll: vi.fn(async () => ({ unreadCount: 0 })),
        refreshNow: vi.fn(async () => ({ started: true })),
        setBlockedTopics: vi.fn(async () => ({ blockedTopics: [] })),
        ...overrides,
      },
    };
}

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  container = document.createElement("div");
  document.body.innerHTML = "";
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render() {
  await act(async () => {
    root.render(React.createElement(FeedView));
  });
}

describe("未启用（默认状态）", () => {
  it("显示引导与「打开动态」，且没有刷新按钮、没有筛选条", async () => {
    setWindowApi(snapshot(false));
    await render();
    expect(container.textContent).toContain("feed.onboardingTitle");
    expect(container.textContent).toContain("feed.onboardingCta");
    expect(container.querySelector('[data-testid="feed-refresh"]')).toBeNull();
    expect(container.querySelector('[data-testid="feed-filters"]')).toBeNull();
  });

  it("引导页也留了返回聊天的入口（与其它整页视图一致）", async () => {
    setWindowApi(snapshot(false));
    useAppStore.setState({ activeView: "feed" });
    await render();
    await act(async () => {
      (
        container.querySelector('[data-testid="feed-back"]') as HTMLElement
      ).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(useAppStore.getState().activeView).toBe("chat");
  });

  it("点「打开动态」调 setEnabled(true)", async () => {
    const setEnabled = vi.fn(async () => ({ enabled: true, started: true }));
    setWindowApi(snapshot(false), { setEnabled });
    await render();
    await act(async () => {
      (
        container.querySelector('[data-testid="feed-enable"]') as HTMLElement
      ).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(setEnabled).toHaveBeenCalledWith(true);
  });
});

describe("已启用但没条目", () => {
  it("显示空提示与「立即更新」", async () => {
    setWindowApi(snapshot(true));
    await render();
    expect(container.textContent).toContain("feed.emptyTitle");
    expect(
      container.querySelector('[data-testid="feed-refresh"]'),
    ).toBeTruthy();
  });
});

describe("已启用且有条目", () => {
  it("头部有返回聊天的入口，点了切回 chat（与 Vault / 用量页同一套）", async () => {
    setWindowApi(snapshot(true, [makeItem()], makeRun()));
    useAppStore.setState({ activeView: "feed" });
    await render();
    await act(async () => {
      (
        container.querySelector('[data-testid="feed-back"]') as HTMLElement
      ).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(useAppStore.getState().activeView).toBe("chat");
  });

  it("显示标题、筛选条与依据区折叠入口", async () => {
    setWindowApi(snapshot(true, [makeItem()], makeRun()));
    await render();
    expect(container.textContent).toContain("第一条");
    expect(
      container.querySelector('[data-testid="feed-filters"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("feed.reasonsTitle");
  });

  it("关闭自动更新时头部显示「自动更新已关闭」，但列表与刷新按钮仍在", async () => {
    setWindowApi(snapshot(false, [makeItem()], makeRun()));
    await render();
    expect(container.textContent).toContain("feed.autoOff");
    expect(
      container.querySelector('[data-testid="feed-refresh"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("第一条");
  });

  it("点「立即更新」调 refreshNow", async () => {
    const refreshNow = vi.fn(async () => ({ started: true }));
    setWindowApi(snapshot(true, [makeItem()], makeRun()), { refreshNow });
    await render();
    await act(async () => {
      (
        container.querySelector('[data-testid="feed-refresh"]') as HTMLElement
      ).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(refreshNow).toHaveBeenCalled();
  });

  it("两栏常驻：未选中时右栏是占位，点条目后换成正文摘录", async () => {
    setWindowApi(snapshot(true, [makeItem()], makeRun()));
    await render();
    // 右栏从默一就在，不靠选中才出现 —— 否则点一下列表会突然变窄
    expect(container.querySelector('[data-testid="feed-reader"]')).toBeTruthy();
    expect(
      container.querySelector('[data-testid="feed-reader-empty"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("feed.readerEmpty");

    await act(async () => {
      (
        container.querySelector('[data-testid="feed-title"]') as HTMLElement
      ).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(
      container.querySelector('[data-testid="feed-reader-empty"]'),
    ).toBeNull();
    expect(container.textContent).toContain("正文");
    expect(
      container.querySelector('[data-testid="feed-open-browser"]'),
    ).toBeTruthy();
  });

  it("没条目时不摆右栏（避免两边都是空状态）", async () => {
    setWindowApi(snapshot(true, [], makeRun()));
    await render();
    expect(container.querySelector('[data-testid="feed-reader"]')).toBeNull();
  });

  it("最近一次 run 是失败时，头部出现错误条与「重试」", async () => {
    setWindowApi(
      snapshot(
        true,
        [makeItem()],
        makeRun({ status: "failed", error: "boom" }),
      ),
    );
    await render();
    expect(container.querySelector('[data-testid="feed-error"]')).toBeTruthy();
    expect(container.textContent).toContain("feed.errorRetry");
  });

  it("最近一次 run 是 partial 时只说「没找到新的」，不当错误", async () => {
    setWindowApi(
      snapshot(
        true,
        [makeItem()],
        makeRun({ status: "partial", item_count: 0 }),
      ),
    );
    await render();
    expect(container.textContent).toContain("feed.partial");
    expect(container.querySelector('[data-testid="feed-error"]')).toBeNull();
  });

  it("头部显示真实的下次更新时间（上次成功 + 24h）", async () => {
    const startedAt = Date.now() - 60 * 60 * 1000; // 一小时前
    setWindowApi(
      snapshot(true, [makeItem()], makeRun({ started_at: startedAt })),
    );
    await render();
    // 传了插值参数（不是空串）
    expect(container.textContent).toMatch(/feed\.nextUpdate:\{/);
  });

  it("依据区展开后能屏蔽主题", async () => {
    const setBlockedTopics = vi.fn(async () => ({ blockedTopics: ["T"] }));
    setWindowApi(
      snapshot(
        true,
        [makeItem()],
        makeRun({
          queries: JSON.stringify([{ q: "tokio", topic: "T", reason: "r" }]),
        }),
      ),
      { setBlockedTopics },
    );
    await render();
    await act(async () => {
      (
        container.querySelector(
          '[data-testid="feed-reasons-toggle"]',
        ) as HTMLElement
      ).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const blockButton = container.querySelector(
      '[data-testid="feed-block-T"]',
    ) as HTMLElement | null;
    expect(blockButton).toBeTruthy();
    await act(async () => {
      blockButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(setBlockedTopics).toHaveBeenCalledWith(["T"]);
  });

  it("「⋯」菜单里能暂停自动更新", async () => {
    const setEnabled = vi.fn(async () => ({ enabled: true, started: false }));
    setWindowApi(snapshot(true, [makeItem()], makeRun()), { setEnabled });
    await render();
    await act(async () => {
      (
        container.querySelector('[data-testid="feed-more"]') as HTMLElement
      ).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      (
        container.querySelector(
          '[data-testid="feed-toggle-auto"]',
        ) as HTMLElement
      ).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(setEnabled).toHaveBeenCalledWith(false);
  });

  it("清空要二次确认", async () => {
    const clearAll = vi.fn(async () => ({ unreadCount: 0 }));
    setWindowApi(snapshot(true, [makeItem()], makeRun()), { clearAll });
    await render();
    await act(async () => {
      (
        container.querySelector('[data-testid="feed-more"]') as HTMLElement
      ).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      (
        container.querySelector('[data-testid="feed-clear-all"]') as HTMLElement
      ).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(clearAll).not.toHaveBeenCalled();
    expect(
      container.querySelector('[data-testid="feed-clear-confirm"]'),
    ).toBeTruthy();
    await act(async () => {
      (
        container.querySelector(
          '[data-testid="feed-clear-confirm"]',
        ) as HTMLElement
      ).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(clearAll).toHaveBeenCalled();
  });

  it("生成中能显示「写摘录」这个阶段名", async () => {
    setWindowApi(snapshot(true, [makeItem()], makeRun()));
    await render();
    await act(async () => {
      useAppStore.setState({ feedGenPhase: "excerpt" });
    });
    expect(container.textContent).toContain("feed.phaseExcerpt");
  });

  it("每个阶段都与自己的文案一一对应（忘了加 case 的会静默显示成「配图」）", async () => {
    setWindowApi(snapshot(true, [makeItem()], makeRun()));
    await render();
    const expected: Record<string, string> = {
      signals: "feed.phaseSignals",
      queries: "feed.phaseQueries",
      collect: "feed.phaseCollect",
      fetch: "feed.phaseFetch",
      compose: "feed.phaseCompose",
      excerpt: "feed.phaseExcerpt",
      image: "feed.phaseImage",
    };
    for (const phase of FEED_PHASES) {
      await act(async () => {
        useAppStore.setState({ feedGenPhase: phase });
      });
      const matched = /feed\.phase[A-Za-z]+/.exec(container.textContent ?? "");
      // 断言精确配对，而不是「互不相同」—— 只证明互不相同的话，把两个 case 的返回写反了照样绿
      expect(matched?.[0] ?? null, `阶段 ${phase} 的文案`).toBe(
        expected[phase],
      );
    }
  });
});

describe("筛选后的空列表不能说成「还没有内容」", () => {
  it("选了「未读」但没有未读条目时显示的是筛选为空", async () => {
    setWindowApi(
      snapshot(true, [makeItem({ read_at: Date.now() })], makeRun()),
    );
    await render();
    await act(async () => {
      const buttons = Array.from(container.querySelectorAll("button"));
      const unreadFilter = buttons.find((button) =>
        button.textContent?.startsWith("feed.filterUnread"),
      );
      unreadFilter?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.textContent).toContain("feed.filterEmpty");
    expect(container.textContent).not.toContain("feed.emptyTitle");
    // §8.4：有条目就不能把右栏收起来（否则筛一下布局就跳）
    expect(container.querySelector('[data-testid="feed-reader"]')).toBeTruthy();
    expect(
      container.querySelector('[data-testid="feed-reader-empty"]'),
    ).toBeTruthy();
  });
});

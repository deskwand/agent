// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    // 把插值参数拼进文本，否则「nextUpdate 传了空串」这种错断言不出来
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
    i18n: { resolvedLanguage: "en" },
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
    published_at: null,
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

/** 菜单内容经 Radix Portal 挂到 document.body —— 不在本文件的 container 里。 */
function menu(): Element | null {
  return document.body.querySelector('[role="menu"]');
}

function bodyTestId(testId: string): HTMLElement | null {
  return document.body.querySelector(`[data-testid="${testId}"]`);
}

/** Radix 的菜单触发器只认左键 pointerdown（无 ctrl）—— 旧的 onClick toggle 已删。 */
async function pointerDown(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.dispatchEvent(
      new MouseEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        ctrlKey: false,
      }),
    );
  });
}

/** 打开 ⋯ 菜单（portal 在 body）。 */
async function openMoreMenu(): Promise<void> {
  await pointerDown(
    container.querySelector('[data-testid="feed-more"]') as HTMLElement,
  );
}

async function keyDown(el: Element, key: string): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

/** Radix 的焦点移动/回焦都在 setTimeout(0) 里 —— 断言前得把这批任务跑完。 */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
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

  it("顶栏给出「听全部」，按下后走 startFeedListen", async () => {
    const startFeedListen = vi.fn(async () => {});
    useAppStore.setState({ startFeedListen });
    setWindowApi(snapshot(true, [makeItem()], makeRun()));
    await render();
    const button = container.querySelector(
      '[data-testid="feed-listen-all"]',
    ) as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    await act(async () => button?.click());
    expect(startFeedListen).toHaveBeenCalled();
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

  it("列表列宽：跟字号缩放、有比例上限，且不低于原来的 400", async () => {
    setWindowApi(snapshot(true, [makeItem()], makeRun()));
    await render();
    const list = container.querySelector(
      '[data-testid="feed-list-column"]',
    ) as HTMLElement | null;
    expect(list).not.toBeNull();
    // 断整条 utility，不断子串：否则把 floor 与 target 对调（行为完全不同）也照样全绿。
    // 用 rem 而不是 px：字号调大时列表跟着变宽，每行装的中文字数才不变
    // （520px 在 16px 根字号下 = 32.5rem）
    expect(list?.className).toContain("w-[min(32.5rem,40%)]");
    // 下限也得受比例约束：min-width 赢 width，写死 25rem 的话字号拉大后
    // 它会吃掉 77% 的页宽、把右栏压到 6.6 字/行（真实浏览器实测）
    expect(list?.className).toContain("min-w-[min(25rem,50%)]");
  });

  it("「全部已读」收进 ⋯ 菜单，不在顶栏（顶栏只留一个主操作）", async () => {
    const markAllRead = vi.fn(async () => 0);
    setWindowApi(snapshot(true, [makeItem()], makeRun()), { markAllRead });
    await render();
    // 菜单没打开时它不在 DOM 里
    expect(
      container.querySelector('[data-testid="feed-mark-all-read"]'),
    ).toBeNull();
    expect(container.textContent).not.toContain("feed.markAllRead");

    await openMoreMenu();
    const entry = bodyTestId("feed-mark-all-read") as HTMLElement;
    expect(entry).not.toBeNull();
    await act(async () => {
      entry.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(markAllRead).toHaveBeenCalled();
  });

  it("右栏底部：相关性与出口同排，且不再重复摘录标签", async () => {
    setWindowApi(
      snapshot(
        true,
        [makeItem({ relevance: "因为你上周问过这个" })],
        makeRun(),
      ),
      {
        getBody: vi.fn(async () => ({
          body: "正文",
          bodyStatus: "ok",
          excerpt: "摘录",
        })),
      },
    );
    await render();
    await act(async () => {
      (
        container.querySelector('[data-testid="feed-title"]') as HTMLElement
      ).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const reader = container.querySelector('[data-testid="feed-reader"]');
    // 「正文摘录 · 本地化」只出现在元信息行，底部那次已删
    const occurrences =
      reader?.textContent?.split("feed.readerExcerptLocalized").length ?? 0;
    expect(occurrences - 1).toBe(1);
    // 相关性与「打开原文」同在一个底部行里
    const open = reader?.querySelector(
      '[data-testid="feed-open-browser"]',
    ) as HTMLElement;
    expect(open.parentElement?.textContent).toContain("因为你上周问过这个");
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
    await openMoreMenu();
    await act(async () => {
      (bodyTestId("feed-toggle-auto") as HTMLElement).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(setEnabled).toHaveBeenCalledWith(false);
  });

  it("清空要二次确认：弹窗在 body 且焦点可达，确认一次、取消零次", async () => {
    const clearAll = vi.fn(async () => ({ unreadCount: 0 }));
    setWindowApi(snapshot(true, [makeItem()], makeRun()), { clearAll });
    await render();
    await openMoreMenu();
    await act(async () => {
      (bodyTestId("feed-clear-all") as HTMLElement).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(clearAll).not.toHaveBeenCalled();
    const dialog = document.body.querySelector('[role="alertdialog"]');
    expect(dialog).toBeTruthy();
    // 确认框的初始焦点落在自己的取消键上（可键盘操作）
    expect(dialog?.contains(document.activeElement)).toBe(true);
    // 取消：关窗、不调 clearAll
    const cancel = bodyTestId("feed-clear-cancel") as HTMLElement;
    await act(async () => {
      cancel.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
    expect(clearAll).not.toHaveBeenCalled();
    // 确认：关窗、clearAll 一次
    await openMoreMenu();
    await act(async () => {
      (bodyTestId("feed-clear-all") as HTMLElement).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await act(async () => {
      (bodyTestId("feed-clear-confirm") as HTMLElement).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(clearAll).toHaveBeenCalledTimes(1);
  });

  it("⋯ 菜单：键盘只派发 ArrowDown 就能打开，ArrowDown/Enter 让动作恰一次", async () => {
    const markAllRead = vi.fn(async () => 0);
    setWindowApi(snapshot(true, [makeItem()], makeRun()), { markAllRead });
    await render();
    const trigger = container.querySelector(
      '[data-testid="feed-more"]',
    ) as HTMLElement;
    await act(async () => {
      trigger.focus();
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(menu()).not.toBeNull();
    // 打开即聚焦首项（全部已读）
    expect(document.activeElement?.textContent?.trim()).toBe(
      "feed.markAllRead",
    );
    // ArrowDown 移到第二项，再回到首项，Enter 执行它 —— 恰好一次
    await keyDown(document.activeElement as Element, "ArrowDown");
    await flush();
    expect(document.activeElement?.textContent?.trim()).toBe("feed.pauseAuto");
    await keyDown(document.activeElement as Element, "ArrowUp");
    await flush();
    expect(document.activeElement?.textContent?.trim()).toBe(
      "feed.markAllRead",
    );
    await keyDown(document.activeElement as Element, "Enter");
    await act(async () => {});
    expect(markAllRead).toHaveBeenCalledTimes(1);
  });

  it("⋯ 菜单：Escape 关闭并把焦点还给触发器", async () => {
    setWindowApi(snapshot(true, [makeItem()], makeRun()));
    await render();
    const trigger = container.querySelector(
      '[data-testid="feed-more"]',
    ) as HTMLElement;
    await pointerDown(trigger);
    expect(menu()).not.toBeNull();
    await act(async () => {
      (document.activeElement ?? document.body).dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await flush();
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger);
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

  it("清空确认框的确认键保留危险皮肤（迁移前锁的是内边距，改锁变体）", async () => {
    // 2026-10-10：取消键原先只写 `h-auto` ⇒ `cn` 合并后 base 的 `px-4 py-2` 留下 ⇒ 32px 高，
    // 而确认键是 `px-3 py-1.5`（28px）⇒ 两个键不齐 ✗。修法是给取消键补同样的内边距 ✓。
    // 迁到 Radix AlertDialog 后两键的尺寸由同一套变体控制 ⇒ 内边距不再是可守的等价条件，
    // 改锁「确认键仍是危险变体」这个语义。
    setWindowApi(snapshot(true, [makeItem()], makeRun()));
    await render();
    await openMoreMenu();
    await act(async () => {
      (bodyTestId("feed-clear-all") as HTMLElement).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    const confirm = bodyTestId("feed-clear-confirm") as HTMLElement;
    const cancel = bodyTestId("feed-clear-cancel") as HTMLElement;
    expect(confirm.className).toContain("bg-destructive");
    expect(cancel.className).not.toContain("bg-destructive");
  });
});

describe("未读数对眼睛的去处", () => {
  it("筛选条上的「未读」chip 带真实数字（图标栏角标去掉数字后，这是唯一的可见去处）", async () => {
    // 2026-10-10：动态的 rail 角标从「数字 pill」降成「无数字圆点」⇒ 未读几条对眼睛只剩这里。
    // 上面那条用例只用 startsWith("feed.filterUnread") 找 chip，把 {count: unread} 去掉照样绿。
    setWindowApi(
      snapshot(true, [makeItem(), makeItem({ id: "i2" })], makeRun()),
    );
    await render();
    expect(container.textContent).toContain('feed.filterUnread:{"count":2}');
  });
});

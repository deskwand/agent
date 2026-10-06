// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { FeedItemRow } from "../../renderer/components/FeedItemRow";
import type { FeedItemWithMeta } from "../../shared/feed";

const item: FeedItemWithMeta = {
  id: "i1",
  run_id: "r1",
  title: "标题",
  summary: "摘要有两句话。第二句在这里。",
  url: "https://a.com/1",
  url_key: "a.com/1",
  source_host: "a.com",
  topic: "主题",
  relevance: "理由",
  body_status: "ok",
  image_url: "https://a.com/x.jpg",
  image_file: "f.jpg",
  image_status: "ok",
  created_at: 1,
  read_at: null,
  dismissed_at: null,
  unprocessed: 0,
  imageUrl: "deskwand-feed-image://local/f.jpg",
};

let container: HTMLDivElement;
let root: Root;
const noop = () => {};

beforeEach(() => {
  container = document.createElement("div");
  document.body.innerHTML = "";
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(
  props: Partial<React.ComponentProps<typeof FeedItemRow>> = {},
) {
  await act(async () => {
    root.render(
      React.createElement(FeedItemRow, {
        item,
        selected: false,
        onOpen: noop,
        onRead: noop,
        onDismiss: noop,
        ...props,
      } as React.ComponentProps<typeof FeedItemRow>),
    );
  });
}

describe("FeedItemRow", () => {
  it("有图时渲染缩略图，src 用主进程给的 URL", async () => {
    await render();
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("deskwand-feed-image://local/f.jpg");
  });

  it("没有图时整列不渲染（不留空框）", async () => {
    await render({ item: { ...item, imageUrl: null } });
    expect(container.querySelector("img")).toBeNull();
  });

  it("列表里不显示长句理由", async () => {
    await render();
    expect(container.textContent).not.toContain("理由");
  });

  it("未读时标题加粗且带未读点（不靠颜色单一维度）", async () => {
    await render();
    const title = container.querySelector(
      '[data-testid="feed-title"]',
    ) as HTMLElement;
    expect(title.className).toContain("font-semibold");
    expect(
      container.querySelector('[data-testid="feed-unread-dot"]'),
    ).toBeTruthy();
  });

  it("已读时没有未读点，标题也不是 semibold", async () => {
    await render({ item: { ...item, read_at: 5 } });
    expect(
      container.querySelector('[data-testid="feed-unread-dot"]'),
    ).toBeNull();
    const title = container.querySelector(
      '[data-testid="feed-title"]',
    ) as HTMLElement;
    expect(title.className).not.toContain("font-semibold");
  });

  it("次要操作默认 opacity 0（用 opacity 而不是 display 隐藏）", async () => {
    await render();
    const actions = container.querySelector(
      '[data-testid="feed-actions"]',
    ) as HTMLElement;
    expect(actions.style.opacity).toBe("0");
    expect(container.textContent).toContain("feed.itemRead");
  });

  it("showActionsAlways 时次要操作可见（首屏教用户）", async () => {
    await render({ showActionsAlways: true });
    const actions = container.querySelector(
      '[data-testid="feed-actions"]',
    ) as HTMLElement;
    expect(actions.style.opacity).toBe("1");
  });

  it("点标题触发 onOpen，点操作按钮不触发 onOpen", async () => {
    const onOpen = vi.fn();
    const onRead = vi.fn();
    await render({ onOpen, onRead });
    await act(async () => {
      (container.querySelector('[data-testid="feed-title"]') as HTMLElement)
        .closest("button")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onOpen).toHaveBeenCalledWith("i1");
    await act(async () => {
      (
        container.querySelector('[data-testid="feed-read"]') as HTMLElement
      ).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onRead).toHaveBeenCalledWith("i1");
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("摘要容器带两行截断", async () => {
    await render();
    const summary = container.querySelector(
      '[data-testid="feed-summary"]',
    ) as HTMLElement;
    expect(
      summary.style.webkitLineClamp ||
        summary.style.getPropertyValue("-webkit-line-clamp"),
    ).toBe("2");
  });

  it("摘要行高 ≥ 1.75、标题 12.5px（设计 §8.8 的中文排版数值）", async () => {
    await render();
    const summary = container.querySelector(
      '[data-testid="feed-summary"]',
    ) as HTMLElement;
    expect(Number.parseFloat(summary.style.lineHeight)).toBeGreaterThanOrEqual(
      1.75,
    );
    const title = container.querySelector(
      '[data-testid="feed-title"]',
    ) as HTMLElement;
    expect(title.className).toContain("text-[12.5px]");
  });

  it("未加工条目带标记", async () => {
    await render({ item: { ...item, unprocessed: 1 } });
    expect(container.textContent).toContain("feed.itemUnprocessed");
  });
});

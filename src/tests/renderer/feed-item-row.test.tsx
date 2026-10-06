// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import fs from "node:fs";
import path from "node:path";
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

  it("点行内空白也打开条目 —— 整行是点击区（设计 §8.3「点条目」）", async () => {
    const onOpen = vi.fn();
    await render({ onOpen });
    await act(async () => {
      (
        container.querySelector('[data-testid="feed-meta"]') as HTMLElement
      ).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onOpen).toHaveBeenCalledWith("i1");
  });

  it("不感兴趣也 stopPropagation，不会顺带打开右栏", async () => {
    const onOpen = vi.fn();
    const onDismiss = vi.fn();
    await render({ onOpen, onDismiss });
    await act(async () => {
      (
        container.querySelector('[data-testid="feed-dismiss"]') as HTMLElement
      ).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onDismiss).toHaveBeenCalledWith("i1");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("摘要行高 ≥ 1.75", async () => {
    await render();
    const summary = container.querySelector(
      '[data-testid="feed-summary"]',
    ) as HTMLElement;
    expect(Number.parseFloat(summary.style.lineHeight)).toBeGreaterThanOrEqual(
      1.75,
    );
  });

  it("字号只用应用 token：标题 text-base、摘要 text-sm、元信息 text-xs", async () => {
    await render();
    const title = container.querySelector(
      '[data-testid="feed-title"]',
    ) as HTMLElement;
    const summary = container.querySelector(
      '[data-testid="feed-summary"]',
    ) as HTMLElement;
    const meta = container.querySelector(
      '[data-testid="feed-meta"]',
    ) as HTMLElement;
    expect(title.className).toContain("text-base");
    expect(summary.className).toContain("text-sm");
    expect(meta.className).toContain("text-xs");
    expect(title.className).toContain("leading-[1.4]");
    expect(meta.className).toContain("leading-[1.75]");
    // 写死的 px 字号不乘 --ui-font-scale，会让整行不跟随「设置 → 字号」
    expect(container.innerHTML).not.toMatch(/text-\[[0-9.]+px\]/);
  });

  it("未加工条目带标记", async () => {
    await render({ item: { ...item, unprocessed: 1 } });
    expect(container.textContent).toContain("feed.itemUnprocessed");
  });

  it("拖拽选中文字时不打开条目（否则复制会吃掉未读状态）", async () => {
    const onOpen = vi.fn();
    await render({ onOpen });
    const selection = vi
      .spyOn(window, "getSelection")
      .mockReturnValue({ isCollapsed: false } as unknown as Selection);
    await act(async () => {
      (
        container.querySelector('[data-testid="feed-summary"]') as HTMLElement
      ).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // 标题按钮（键盘入口）同样要拦：拖到标题上松手也会走 click
    await act(async () => {
      (
        container.querySelector('[data-testid="feed-title"]') as HTMLElement
      ).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onOpen).not.toHaveBeenCalled();
    selection.mockRestore();
  });

  it("未读时有无障碍文字，不只靠蓝点与加粗", async () => {
    await render();
    expect(container.textContent).toContain("feed.itemUnread");
    await render({ item: { ...item, read_at: 5 } });
    expect(container.textContent).not.toContain("feed.itemUnread");
  });
});

// 写死 px 的字号不乘 --ui-font-scale（App.tsx:320），所以调「设置 → 字号」时
// 全应用都变大、只有动态页不动。按目录扫，不写死文件名（否则新增一个 Feed*.tsx 就漏掉）。
describe("动态页排版不写死 px 字号", () => {
  const dir = path.join(__dirname, "../../renderer/components");
  const components = fs
    .readdirSync(dir)
    .filter((name) => /^Feed.*\.tsx$/.test(name));

  it("目录里确实扫到了 Feed 组件（扫空了要报错，不许静默通过）", () => {
    expect(components.length).toBeGreaterThanOrEqual(3);
  });

  for (const name of components) {
    it(`${name} 只用应用 token`, () => {
      const source = fs.readFileSync(path.join(dir, name), "utf8");
      // 任何带数值的 text-[...] 都不行：px 不跟随字号设置，rem 数值则是绕过 token 阶梯
      expect(source).not.toMatch(/text-\[[0-9.]/);
      // style={{ fontSize: 11 }} / fontSize: "11px" 都算（数字会被 React 当成 px）
      expect(source).not.toMatch(/fontSize:\s*"?\d/);
    });
  }
});

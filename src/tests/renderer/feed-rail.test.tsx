// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  // 必须给全 `i18n`（不只是 `t`）：树里会读模块级 i18n 实例的工具
  //（utils/i18n-format.ts 读 resolvedLanguage / language），以及后续迁移进来的
  // 弹窗（UpdateConfirmDialog 取 i18n.language）。缺它会让整棵渲染树炸掉。
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
}));

import { AppRail } from "../../renderer/components/AppRail";
import { useAppStore } from "../../renderer/store";
import { RAIL_ITEMS } from "../../renderer/utils/nav-rail";

let container: HTMLDivElement;
let root: Root;

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

describe("动态入口", () => {
  it("图标栏里排在 chat 之后", () => {
    expect(RAIL_ITEMS.map((item) => item.view).slice(0, 2)).toEqual([
      "chat",
      "feed",
    ]);
  });

  it("未读为 0 时不渲染任何角标", async () => {
    await act(async () => root.render(React.createElement(AppRail)));
    expect(container.querySelector('[data-testid="feed-badge"]')).toBeNull();
  });

  it("有未读时角标存在，但不含任何数字", async () => {
    await act(async () => {
      useAppStore.setState({ feedUnread: 5 });
      root.render(React.createElement(AppRail));
    });
    const badge = container.querySelector('[data-testid="feed-badge"]');
    expect(badge).toBeTruthy();
    expect(badge?.textContent).toBe("");
  });

  it("角标的几何与配色仍与目视验收时实测的那串 class 一致", async () => {
    // 2026-10-10：6px 圆点的大小/位置/色量只有真机能量（jsdom 无布局引擎）——
    // 目视记录里的实测值（36,122 6×6、与图标框角相切）只对下面这串 class 成立。
    // 单测量不到几何 ⇒ 锁「class 集合」这个等价条件，否则 h-1.5 被写成 h-15 也是 9 条全绿。
    await act(async () => {
      useAppStore.setState({ feedUnread: 5 });
      root.render(React.createElement(AppRail));
    });
    const cls = (
      container.querySelector('[data-testid="feed-badge"]') as HTMLElement
    ).className;
    for (const token of [
      "right-0.5",
      "top-0.5",
      "h-1.5",
      "w-1.5",
      "rounded-full",
      "bg-primary/70",
    ]) {
      expect(cls, token).toContain(token);
    }
  });

  it("有未读时 aria-label 仍带数字", async () => {
    await act(async () => {
      useAppStore.setState({ feedUnread: 5 });
      root.render(React.createElement(AppRail));
    });
    expect(
      container.querySelector(
        'button[aria-label="feed.railLabelUnread:{\\"count\\":5}"]',
      ),
    ).toBeTruthy();
  });

  it("未读再多也不进 DOM（101 只出现在 aria-label 里）", async () => {
    await act(async () => {
      useAppStore.setState({ feedUnread: 101 });
      root.render(React.createElement(AppRail));
    });
    expect(
      container.querySelector('[data-testid="feed-badge"]')?.textContent,
    ).toBe("");
    expect(
      container.querySelector(
        'button[aria-label="feed.railLabelUnread:{\\"count\\":101}"]',
      ),
    ).toBeTruthy();
  });

  it("未读为 0 时 aria-label 用不带数字的那条", async () => {
    await act(async () => {
      useAppStore.setState({ feedUnread: 0 });
      root.render(React.createElement(AppRail));
    });
    expect(
      container.querySelector('button[aria-label="navRail.feed"]'),
    ).toBeTruthy();
  });

  it("其余入口的 aria-label 与角标不受影响", async () => {
    await act(async () => {
      useAppStore.setState({ feedUnread: 5 });
      root.render(React.createElement(AppRail));
    });
    expect(
      container.querySelector('button[aria-label="help.label"]'),
    ).toBeTruthy();
    expect(
      container.querySelectorAll('[data-testid="feed-badge"]'),
    ).toHaveLength(1);
  });

  it("已经在动态视图里时不渲染角标（读屏标签仍带数字）", async () => {
    await act(async () => {
      useAppStore.setState({ feedUnread: 5, activeView: "feed" });
      root.render(React.createElement(AppRail));
    });
    expect(container.querySelector('[data-testid="feed-badge"]')).toBeNull();
    expect(
      container.querySelector(
        'button[aria-label="feed.railLabelUnread:{\\"count\\":5}"]',
      ),
    ).toBeTruthy();
  });

  it("离开动态视图后只要还有未读，角标就回来", async () => {
    await act(async () => {
      useAppStore.setState({ feedUnread: 5, activeView: "feed" });
      root.render(React.createElement(AppRail));
    });
    expect(container.querySelector('[data-testid="feed-badge"]')).toBeNull();
    await act(async () => {
      useAppStore.setState({ activeView: "chat" });
    });
    expect(container.querySelector('[data-testid="feed-badge"]')).toBeTruthy();
  });
});

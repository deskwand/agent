// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
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

  it("未读为 5 时角标显示 5，aria-label 带数字", async () => {
    await act(async () => {
      useAppStore.setState({ feedUnread: 5 });
      root.render(React.createElement(AppRail));
    });
    const badge = container.querySelector('[data-testid="feed-badge"]');
    expect(badge?.textContent).toBe("5");
    expect(
      container.querySelector(
        'button[aria-label="feed.railLabelUnread:{\\"count\\":5}"]',
      ),
    ).toBeTruthy();
  });

  it("未读超过 99 显示 99+", async () => {
    await act(async () => {
      useAppStore.setState({ feedUnread: 101 });
      root.render(React.createElement(AppRail));
    });
    expect(
      container.querySelector('[data-testid="feed-badge"]')?.textContent,
    ).toBe("99+");
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
});

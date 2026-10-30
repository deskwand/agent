// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "../../renderer/store";

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
});

describe("右栏宽度按面板各存一份", () => {
  it("keeps the dragged browser width off the shared context width", () => {
    const store = useAppStore.getState();
    store.toggleBrowserPanel();
    store.setBrowserWidth(760);
    store.setBrowserWidthManual(true);

    expect(useAppStore.getState().browserWidth).toBe(760);
    // 概览 / 文件浏览器读的共用宽度不受影响：先开浏览器只会污染这一格
    expect(useAppStore.getState().contextPanelWidth).toBe(288);
  });

  it("reopens the browser at the default half width", () => {
    const store = useAppStore.getState();
    store.toggleBrowserPanel();
    store.setBrowserWidth(760);
    store.setBrowserWidthManual(true);

    store.toggleBrowserPanel(); // 关
    store.toggleBrowserPanel(); // 再开

    const state = useAppStore.getState();
    expect(state.browserWidth).toBeNull();
    expect(state.browserWidthManual).toBe(false);
  });
});

// @vitest-environment jsdom
//
// 用真实 store 挂载真实 AppRail：resolveRailClick 有单测，但「图标栏点了以后
// 到底动了什么」只有端到端点一遍才能锁住（源码字符串断言在分支被写反时照样通过）。

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { AppRail } from "../../renderer/components/AppRail";
import { RAIL_ITEMS } from "../../renderer/utils/nav-rail";
import { useAppStore } from "../../renderer/store";

let container: HTMLDivElement;
let root: Root;

function buttonFor(labelKey: string): HTMLButtonElement {
  const element = container.querySelector(`button[aria-label="${labelKey}"]`);
  expect(element, labelKey).toBeTruthy();
  return element as HTMLButtonElement;
}

async function mountRail(
  activeView: "chat" | "apps" | "settings" = "chat",
): Promise<void> {
  await act(async () => {
    useAppStore.setState({ activeView });
    root.render(React.createElement(AppRail));
  });
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

describe("AppRail 点击路由", () => {
  it("图标栏每一项都渲染出图标", async () => {
    await mountRail();
    for (const item of RAIL_ITEMS) {
      expect(
        buttonFor(item.labelKey).querySelector("svg"),
        item.key,
      ).toBeTruthy();
    }
    expect(buttonFor("sidebar.settings").querySelector("svg")).toBeTruthy();
  });

  it("聊天视图点「聊天」只开合侧栏，不切视图", async () => {
    await mountRail("chat");
    expect(useAppStore.getState().sidebarCollapsed).toBe(false);

    await act(async () => buttonFor("navRail.chat").click());

    expect(useAppStore.getState().sidebarCollapsed).toBe(true);
    expect(useAppStore.getState().activeView).toBe("chat");
  });

  it("点其它项切视图，且不动侧栏", async () => {
    await mountRail("chat");

    await act(async () => buttonFor("sidebar.apps").click());

    expect(useAppStore.getState().activeView).toBe("apps");
    expect(useAppStore.getState().sidebarCollapsed).toBe(false);
  });

  it("从非聊天视图点「聊天」回到聊天，不顺手收起侧栏", async () => {
    await mountRail("apps");

    await act(async () => buttonFor("navRail.chat").click());

    expect(useAppStore.getState().activeView).toBe("chat");
    expect(useAppStore.getState().sidebarCollapsed).toBe(false);
  });

  it("点当前已激活的设置齿轮是 no-op（不会收起侧栏）", async () => {
    await mountRail("settings");

    await act(async () => buttonFor("sidebar.settings").click());

    expect(useAppStore.getState().activeView).toBe("settings");
    expect(useAppStore.getState().sidebarCollapsed).toBe(false);
  });
});

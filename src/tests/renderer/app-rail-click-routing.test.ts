// @vitest-environment jsdom
//
// 用真实 store 挂载真实 AppRail：「图标栏点了以后到底动了什么」只有端到端点一遍
// 才能锁住（源码字符串断言在分支被写反时照样通过）。
// 注意：侧栏开合**不在**这里——它由顶栏的专用按钮负责（见 titlebar-left-cluster.test.ts）。

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  // 必须给全 `i18n`（不只是 `t`）：树里会读模块级 i18n 实例的工具（utils/i18n-format.ts）
  // 以及后续迁移进来的弹窗（UpdateConfirmDialog 取 i18n.language 挑语种）都靠它。
  // 缺它时 `i18n.language` 会读到 undefined 并炸掉整棵渲染树 ——
  // 而修法不该是去改生产代码迁就 mock（见 progress.md 的 Task 7 Ruling）。
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
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

async function mountRail(activeView: "chat" | "apps" = "chat"): Promise<void> {
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
    expect(buttonFor("help.label").querySelector("svg")).toBeTruthy();
    expect(buttonFor("sidebar.user")).toBeTruthy();
  });

  it("点其它项切视图，且不动侧栏", async () => {
    await mountRail("chat");

    await act(async () => buttonFor("sidebar.apps").click());

    expect(useAppStore.getState().activeView).toBe("apps");
    expect(useAppStore.getState().sidebarCollapsed).toBe(false);
  });

  it("点聊天项只切视图，不碰侧栏状态", async () => {
    await mountRail("chat");
    useAppStore.setState({ sidebarCollapsed: true });

    await act(async () => buttonFor("navRail.chat").click());
    expect(useAppStore.getState().activeView).toBe("chat");
    expect(useAppStore.getState().sidebarCollapsed).toBe(true);

    await mountRail("apps");
    await act(async () => buttonFor("navRail.chat").click());

    expect(useAppStore.getState().activeView).toBe("chat");
    expect(useAppStore.getState().sidebarCollapsed).toBe(true);
  });

  it("点灵感那颗不让点击把焦点留在按钮上（不然 hover 卡片会赖着不消失）", async () => {
    // 卡片按 `group-focus-within` 展开，而 `:focus-within` **不区分焦点怎么来的**：
    // 鼠标点一下也会留下焦点 ⇒ 卡片在鼠标移开后继续可见（浏览器实测见
    // design-docs/mockups/_repro-rail-card-focus.html）。挡掉 mousedown 的默认行为即可，
    // click 照常触发、Tab / 回车一概不受影响。
    await mountRail("chat");
    const ideas = buttonFor("navRail.ideas");
    const down = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    await act(async () => ideas.dispatchEvent(down));
    expect(down.defaultPrevented, "灵感这一格要挡掉 mousedown 的默认焦点").toBe(
      true,
    );

    // 别的格子没有卡片，不必跟着改行为
    const chat = buttonFor("navRail.chat");
    const other = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    await act(async () => chat.dispatchEvent(other));
    expect(other.defaultPrevented, "其他格子保持原样").toBe(false);
  });

  it("点过灵感就立刻收起卡片：指针没离开也算", async () => {
    await mountRail("chat");
    const card = container.querySelector('[data-testid="ideas-rail-card"]')!;
    const reveal = () => card.className.includes("group-hover:visible");
    expect(reveal(), "初始应当带着展开类（悬停/聚焦时才真正显示）").toBe(true);

    // 指针点击：detail > 0
    const pointerClick = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      detail: 1,
    });
    await act(async () =>
      buttonFor("navRail.ideas").dispatchEvent(pointerClick),
    );
    expect(reveal(), "点过之后要摘掉展开类（卡片立刻消失）").toBe(false);

    // 指针离开这一格 → 复位，重新悬停照旧展开。
    // React 的 onMouseLeave 走 `mouseout` 委托（和 onBlur 走 focusout 一样），
    // 裸派发 mouseleave 收不到；relatedTarget 落在格子外面才会被合成成 leave。
    const cell = card.parentElement!;
    await act(async () =>
      cell.dispatchEvent(
        new MouseEvent("mouseout", {
          bubbles: true,
          relatedTarget: document.body,
        }),
      ),
    );
    expect(reveal(), "离开后要复位").toBe(true);

    // 再点一次 → 又立刻收起（同样要 bubbles：React 的 onClick 是根上的委托）
    await act(async () =>
      buttonFor("navRail.ideas").dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }),
      ),
    );
    expect(reveal(), "第二次点击同样要收起").toBe(false);

    // 键盘焦点回到这一格 → 复位（否则"先用鼠标点过、再改用键盘"的人再也看不到卡片）
    await act(async () => buttonFor("navRail.ideas").focus());
    expect(reveal(), "聚焦要能把它找回来").toBe(true);
  });

  it("键盘激活（detail === 0）不摘展开类：Shift+Tab 回来卡片还在", async () => {
    await mountRail("chat");
    const card = container.querySelector('[data-testid="ideas-rail-card"]')!;
    await act(async () =>
      buttonFor("navRail.ideas").dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 }),
      ),
    );
    expect(card.className, "回车/空格激活不该被当成指针点击").toContain(
      "group-hover:visible",
    );
  });
});

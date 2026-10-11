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
    // 带 options 的 key（固定/取消固定的可达名）必须把插值拼进去 ——
    // 否则图钉的 aria-label 里看不到那一项的名字，pinFor 找不到它。
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
}));

import { AppRail } from "../../renderer/components/AppRail";
import type { ActiveView } from "../../renderer/store";
import { RAIL_PRIMARY_ITEMS } from "../../renderer/utils/nav-rail";
import { useAppStore } from "../../renderer/store";

let container: HTMLDivElement;
let root: Root;

function buttonFor(labelKey: string): HTMLButtonElement {
  const element = container.querySelector(`button[aria-label="${labelKey}"]`);
  expect(element, labelKey).toBeTruthy();
  return element as HTMLButtonElement;
}

function buttonOrNull(labelKey: string): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(
    `button[aria-label="${labelKey}"]`,
  );
}

/** 栏上带 data-rail-key 的按钮（导航项 + 「更多」），按 DOM 顺序。 */
function railKeys(): string[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>("nav [data-rail-key]"),
  ).map((el) => el.dataset.railKey ?? "");
}

/** 卡片里按行名取「行本体」那颗按钮（它没有 aria-label，靠文字认）。
 *
 * 「更多」自 2026-10-11 起是**悬停卡片**（与灵感那张同一族），不再是点开的菜单 ——
 * 卡片与行一直在 DOM 里，靠 `invisible` / 展开类切换可见性，所以直接查 DOM 就行，
 * 没有「先点开菜单」那一步（旧版的 `openMoreMenu()` 已删）。 */
function moreRowFor(labelKey: string): HTMLElement {
  const card = container.querySelector('[data-testid="rail-more-card"]');
  expect(card, "「更多」卡片必须在 DOM 里").toBeTruthy();
  const row = Array.from(card!.querySelectorAll<HTMLElement>("button")).find(
    (el) =>
      el.getAttribute("aria-label") === null &&
      el.textContent?.trim() === labelKey,
  );
  expect(row, labelKey).toBeTruthy();
  return row!;
}

/** 取某一行右侧那颗图钉（不能直接取第一颗，见 rail-more-menu.test.tsx 里那段说明）。 */
function pinFor(labelKey: string): HTMLElement {
  const pin = Array.from(
    document.querySelectorAll<HTMLElement>('[aria-label^="navRail.pinItem"]'),
  ).find((el) => el.getAttribute("aria-label")?.includes(labelKey));
  expect(pin, labelKey).toBeTruthy();
  return pin!;
}

async function mountRail(activeView: ActiveView = "chat"): Promise<void> {
  await act(async () => {
    useAppStore.setState({ activeView });
    root.render(React.createElement(AppRail));
  });
}

beforeEach(() => {
  // AppRail 现在会读固定集合：上下文不清会造成用例间串味
  localStorage.clear();
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
  it("常驻项都渲染出图标", async () => {
    await mountRail();
    for (const item of RAIL_PRIMARY_ITEMS) {
      expect(
        buttonFor(item.labelKey).querySelector("svg"),
        item.key,
      ).toBeTruthy();
    }
    expect(buttonFor("help.label").querySelector("svg")).toBeTruthy();
    expect(buttonFor("sidebar.user")).toBeTruthy();
  });

  it("长尾项未固定时栏上**没有**它那颗按钮（防止「改了却没真接上」假绿）", async () => {
    await mountRail();
    expect(buttonOrNull("sidebar.vault")).toBeNull();
    expect(railKeys()).toEqual(["chat", "ideas", "feed", "more"]);
  });

  it("长尾项从卡片切视图（apps），且不动侧栏", async () => {
    await mountRail("chat");

    await act(async () => moreRowFor("sidebar.apps").click());

    expect(useAppStore.getState().activeView).toBe("apps");
    expect(useAppStore.getState().sidebarCollapsed).toBe(false);
  });

  it("固定之后栏上多一格，点它切视图，并落进 localStorage", async () => {
    await mountRail();
    const pin = pinFor("sidebar.vault");
    // 必须派发**指针**点击（`detail > 0`）：`.click()` 的 detail 是 0，那被当成键盘激活，
    // 按设计不收起卡片。这条同时也钉住了「收起只在指针点击时发生」。
    await act(async () =>
      pin.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }),
      ),
    );

    const pinned = buttonFor("sidebar.vault");
    expect(pinned.querySelector("svg")).toBeTruthy();
    // 顺序：固定的项落在「更多」**下方**（D4）
    expect(railKeys()).toEqual(["chat", "ideas", "feed", "more", "vault"]);
    expect(localStorage.getItem("deskwand.railPins")).toBe(
      JSON.stringify(["vault"]),
    );

    // 真实挂载路径下也要收起：单测里 onTogglePin 是 vi.fn()、不会触发父级重渲染，
    // 这里点的是真图钉、父级 state 真的会变（评审 2026-10-11 要求补这条端到端闸）。
    expect(
      container
        .querySelector('[data-testid="rail-more-card"]')!
        .className.includes("group-hover:visible"),
      "点过图钉，卡片要收起",
    ).toBe(false);

    await act(async () => pinned.click());
    expect(useAppStore.getState().activeView).toBe("vault");
  });

  it("存储里是坏数据时栏照常渲染，只是没有固定组", async () => {
    localStorage.setItem("deskwand.railPins", "{oops");
    await mountRail();
    expect(buttonFor("navRail.chat")).toBeTruthy();
    expect(buttonOrNull("sidebar.vault")).toBeNull();
  });

  it("存储里是过期 key（已不存在的视图）时不渲染空白格", async () => {
    localStorage.setItem(
      "deskwand.railPins",
      JSON.stringify(["vault", "ghost"]),
    );
    await mountRail();
    // 有效的那一项照常出现，幽灵 key 被丢掉
    expect(buttonFor("sidebar.vault")).toBeTruthy();
    expect(railKeys()).toEqual(["chat", "ideas", "feed", "more", "vault"]);
    expect(railKeys()).not.toContain("ghost");
  });

  it("存储里是常驻项的 key 时不重复渲染（chat 只能出现一次）", async () => {
    // 越界数据：栏上常驻的项被写进固定集合（手工改过、或将来某视图从常驻降级）
    localStorage.setItem("deskwand.railPins", JSON.stringify(["chat"]));
    await mountRail();
    expect(railKeys()).toEqual(["chat", "ideas", "feed", "more"]);
    expect(buttonFor("navRail.chat").querySelector("svg")).toBeTruthy();
  });

  it("固定组为空时不画那条细线", async () => {
    await mountRail();
    expect(
      container.querySelector('[data-testid="rail-pins-divider"]'),
    ).toBeNull();
  });

  it("未固定时高亮在「更多」上、栏上没有它那格（D5）", async () => {
    await mountRail("vault");
    expect(buttonOrNull("sidebar.vault")).toBeNull();
    expect(
      container.querySelector('button[aria-label="navRail.more"]')!.className,
    ).toContain("bg-accent text-primary-text");
  });

  it("固定之后高亮回到栏上那一格，「更多」不再高亮（D5）", async () => {
    localStorage.setItem("deskwand.railPins", JSON.stringify(["vault"]));
    await mountRail("vault");

    expect(buttonFor("sidebar.vault").getAttribute("aria-current")).toBe(
      "page",
    );
    expect(
      container.querySelector('button[aria-label="navRail.more"]')!.className,
    ).not.toContain("bg-accent text-primary-text");
  });

  it("固定之后细线恰好在「更多」下方、固定项之上", async () => {
    localStorage.setItem("deskwand.railPins", JSON.stringify(["vault"]));
    await mountRail();
    const rail = container.querySelector("nav")!;
    // 按 DOM 顺序取「栏上带 data-rail-key 的格」与那条细线。
    // ⚠️ 不能用 `rail.children`：「更多」自 2026-10-11 起裹在悬停卡片的 group 容器里，
    // 不再是 nav 的直接子元素（灵感那格同样裹了一层）。
    const order = Array.from(
      rail.querySelectorAll<HTMLElement>(
        '[data-rail-key], [data-testid="rail-pins-divider"]',
      ),
    ).map((el) => el.dataset.railKey ?? "rail-pins-divider");
    const divider = order.indexOf("rail-pins-divider");
    expect(divider, "细线必须存在").toBeGreaterThan(-1);
    expect(order[divider - 1]).toBe("more");
    expect(order[divider + 1]).toBe("vault");
  });

  it("固定顺序 = 固定先后（后固定的排下面）", async () => {
    localStorage.setItem(
      "deskwand.railPins",
      JSON.stringify(["usage", "vault"]),
    );
    await mountRail();
    expect(railKeys()).toEqual([
      "chat",
      "ideas",
      "feed",
      "more",
      "usage",
      "vault",
    ]);
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

    // 离开**不**复位（根因回归闸）：点卡片里的按钮会让卡片自己 invisible ⇒ 指针脚下那一下
    // 被判定成「离开这一格」；复位若挂在这条离开事件上，刚收起的会被立刻抹掉。
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
    expect(reveal(), "离开不该复位").toBe(false);

    // 指针**重新进入**这一格 → 复位，重新悬停照旧展开（onMouseEnter 由 mouseover 合成）。
    await act(async () =>
      cell.dispatchEvent(
        new MouseEvent("mouseover", {
          bubbles: true,
          relatedTarget: document.body,
        }),
      ),
    );
    expect(reveal(), "重新进入后要复位").toBe(true);

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

  it("点卡片里的「记一笔」也把卡片收起来", async () => {
    // 与这一格图标那颗按钮同一条规则（用户 2026-10-11：面板/卡片里的按钮点过就该消失）。
    // 只认指针点击：键盘激活（detail === 0）不摘。
    await mountRail("chat");
    const card = container.querySelector('[data-testid="ideas-rail-card"]')!;
    const reveal = () => card.className.includes("group-hover:visible");
    expect(reveal()).toBe(true);

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[data-testid="ideas-rail-capture"]')!
        .dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            detail: 1,
          }),
        ),
    );

    expect(reveal(), "点过「记一笔」要收起卡片").toBe(false);
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

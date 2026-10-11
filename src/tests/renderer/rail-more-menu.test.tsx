// @vitest-environment jsdom
//
// 「更多」菜单：点开、列出长尾四项、点行切视图、点图钉只切固定状态。
// 打开菜单必须两种事件都派发：Radix 的 DropdownMenuTrigger 只挂 onPointerDown
//（+ Enter/Space/ArrowDown），手写的触发器只认 click（见 attach-menu-helper.ts 的说明）。
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
}));

import { RailMoreMenu } from "../../renderer/components/RailMoreMenu";
import type { ActiveView } from "../../renderer/store";
import { RAIL_MORE_ITEMS } from "../../renderer/utils/nav-rail";
import { useAppStore } from "../../renderer/store";

let container: HTMLDivElement;
let root: Root;
let onTogglePin: Mock<(key: string) => void>;

async function mount(
  pinnedKeys: string[] = [],
  activeView: ActiveView = "chat",
) {
  await act(async () => {
    useAppStore.setState({ activeView });
    root.render(React.createElement(RailMoreMenu, { pinnedKeys, onTogglePin }));
  });
}

function trigger(): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(
    'button[aria-label="navRail.more"]',
  );
  expect(button, "「更多」触发器必须存在").toBeTruthy();
  return button!;
}

async function openMenu(): Promise<void> {
  const button = trigger();
  await act(async () => {
    button.dispatchEvent(
      new MouseEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
      }),
    );
    button.click();
    // Radix 的挂载/聚焦在 setTimeout 里跑完（计划 7 的教训）
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function menuItems(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  );
}

/**
 * 取某一行右侧那颗图钉。
 *
 * ⚠️ **不能**写成 `querySelector('[aria-label^="navRail.pinItem"]')`：它回的是 DOM
 * 里**第一行**（自动化）那颗，而用例断言的是对 vault 的调用 —— 那样会红，
 * 而且失败信息看起来像「固定功能坏了」（审查员 2026-10-11 指出）。
 */
function pinFor(labelKey: string, pinned = false): HTMLElement {
  const prefix = pinned ? "navRail.unpinItem" : "navRail.pinItem";
  const pin = Array.from(
    document.querySelectorAll<HTMLElement>(`[aria-label^="${prefix}"]`),
  ).find((el) => el.getAttribute("aria-label")?.includes(labelKey));
  expect(pin, `${prefix} ${labelKey}`).toBeTruthy();
  return pin!;
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  onTogglePin = vi.fn<(key: string) => void>();
  container = document.createElement("div");
  document.body.innerHTML = "";
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("触发器", () => {
  it("有可达名，并且 aria-haspopup 真的落在按钮上", async () => {
    await mount();
    // Radix 把 props 交给**直接子元素**：中间插一层不透传 props/ref 的包装组件
    // 会让菜单打不开且不报错（AccountMenu.tsx:83 记过这个坑）。这条是它的回归闸。
    expect(trigger().getAttribute("aria-haspopup")).toBe("menu");
  });

  it("当前视图是长尾项且未固定 → 「更多」高亮；固定之后 → 不再高亮", async () => {
    // 「高亮」在这里是**视觉**状态（触发器的类串）；`aria-current="page"` 只留给菜单里
    // 那一行 —— 两个元素同时声称自己是当前页会让读屏并报两句（评审 2026-10-11）。
    await mount([], "vault");
    expect(trigger().className).toContain("bg-accent text-primary-text");
    expect(trigger().getAttribute("aria-current")).toBeNull();

    await mount(["vault"], "vault");
    expect(trigger().className).not.toContain("bg-accent text-primary-text");
    expect(trigger().className).toContain("hover:bg-accent");
  });
});

describe("菜单内容", () => {
  it("点开后列出长尾四项，每行都有图标与文字", async () => {
    await mount();
    await openMenu();
    const labels = menuItems().map((el) => el.textContent);
    for (const item of RAIL_MORE_ITEMS) {
      expect(labels, item.key).toContain(item.labelKey);
    }
  });

  it("当前所在那一行带 aria-current", async () => {
    await mount([], "apps");
    await openMenu();
    const current = menuItems().filter(
      (el) => el.getAttribute("aria-current") === "page",
    );
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toBe("sidebar.apps");
  });
});

describe("点行 / 点图钉", () => {
  it("点行切视图", async () => {
    await mount();
    await openMenu();
    const row = menuItems().find(
      (el) =>
        el.getAttribute("aria-label") === null &&
        el.textContent === "sidebar.vault",
    );
    await act(async () => row!.click());
    expect(useAppStore.getState().activeView).toBe("vault");
  });

  it("点图钉只切固定状态：不切视图、菜单不关", async () => {
    await mount();
    await openMenu();
    await act(async () => pinFor("sidebar.vault").click());
    expect(onTogglePin).toHaveBeenCalledWith("vault");
    expect(useAppStore.getState().activeView).toBe("chat");
    // 菜单还开着 ⇒ 能连着固定几项
    expect(menuItems().length).toBe(RAIL_MORE_ITEMS.length * 2);
  });

  it("已固定的行，图钉换成「取消固定」的可达名", async () => {
    await mount(["vault"]);
    await openMenu();
    const pin = pinFor("sidebar.vault", true);
    await act(async () => pin.click());
    expect(onTogglePin).toHaveBeenCalledWith("vault");
  });
});

describe("新文案的插值契约", () => {
  it("中英两份的固定/取消固定都带 {{name}} 占位符", async () => {
    // mock 的 t 会把插值拼进字符串，真实文案写丢了占位符也照样绿 ⇒ 直接读语言包。
    const zh = (await import("../../renderer/i18n/locales/zh.json")).default;
    const en = (await import("../../renderer/i18n/locales/en.json")).default;
    for (const [locale, pack] of [
      ["zh", zh],
      ["en", en],
    ] as const) {
      const navRail = (pack as { navRail: Record<string, string> }).navRail;
      expect(navRail.pinItem, locale).toContain("{{name}}");
      expect(navRail.unpinItem, locale).toContain("{{name}}");
      expect(navRail.more, locale).toBeTruthy();
    }
  });
});

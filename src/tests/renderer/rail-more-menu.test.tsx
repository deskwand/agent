// @vitest-environment jsdom
//
// 「更多」是**悬停卡片**（与灵感那张同一族），不是点击打开的菜单：
// 鼠标停在图标上、或键盘焦点落进这一格，卡片就出现；点那颗图标本身什么也不做。
// 卡片与行一直在 DOM 里（靠 `invisible` / 展开类切换可见性），所以用例直接查 DOM，
// 不需要「先点开菜单」那一步。
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
  expect(button, "「更多」那颗按钮必须存在").toBeTruthy();
  return button!;
}

function card(): HTMLElement {
  const element = container.querySelector<HTMLElement>(
    '[data-testid="rail-more-card"]',
  );
  expect(element, "卡片必须存在（不在 DOM 里就谈不上悬停展开）").toBeTruthy();
  return element!;
}

/** 卡片现在是不是「展开态」（判据与灵感那张一致：类串里带着 group-hover:visible）。 */
function isRevealed(): boolean {
  return card().className.includes("group-hover:visible");
}

/** 按行名取「行本体」那颗按钮（它没有 aria-label，靠文字认）。 */
function rowFor(labelKey: string): HTMLButtonElement {
  const row = Array.from(
    card().querySelectorAll<HTMLButtonElement>("button"),
  ).find(
    (el) =>
      el.getAttribute("aria-label") === null &&
      el.textContent?.trim() === labelKey,
  );
  expect(row, `行 ${labelKey}`).toBeTruthy();
  return row!;
}

/**
 * 取某一行右侧那颗图钉。
 *
 * ⚠️ **不能**写成 `querySelector('[aria-label^="navRail.pinItem"]')`：它回的是
 * **第一行**（自动化）那颗，而用例断言的是对 vault 的调用 —— 那样会红，
 * 而且失败信息看起来像「固定功能坏了」（审查员 2026-10-11 指出）。
 */
function pinFor(labelKey: string, pinned = false): HTMLButtonElement {
  const prefix = pinned ? "navRail.unpinItem" : "navRail.pinItem";
  const pin = Array.from(
    card().querySelectorAll<HTMLButtonElement>(`[aria-label^="${prefix}"]`),
  ).find((el) => el.getAttribute("aria-label")?.includes(labelKey));
  expect(pin, `${prefix} ${labelKey}`).toBeTruthy();
  return pin!;
}

/** 派发一次指针点击（detail > 0）；键盘激活是 detail === 0。 */
async function pointerClick(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }),
    );
  });
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

describe("触发器（那颗 … 图标）", () => {
  it("点它什么也不做：不切视图、不改变卡片状态", async () => {
    await mount([], "chat");
    const before = card().className;

    await act(async () => trigger().click());

    expect(
      useAppStore.getState().activeView,
      "点击不该导航（更多没有自己的视图）",
    ).toBe("chat");
    expect(card().className, "点击不该展开/收起卡片").toBe(before);
  });

  it("面板里两颗按钮都不让按下时拿走焦点（否则点完它变 invisible、焦点掉回 body）", async () => {
    await mount();
    for (const button of [rowFor("sidebar.vault"), pinFor("sidebar.vault")]) {
      const down = new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
      });
      await act(async () => button.dispatchEvent(down));
      expect(
        down.defaultPrevented,
        button.getAttribute("aria-label") ?? "行",
      ).toBe(true);
    }
  });

  it("鼠标按下时不让焦点留在它身上（否则卡片会被 focus-within 钉住）", async () => {
    await mount();
    const down = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    await act(async () => trigger().dispatchEvent(down));
    expect(down.defaultPrevented).toBe(true);
  });

  it("当前视图在长尾组且未固定 → 高亮；固定之后 → 不再高亮", async () => {
    await mount([], "vault");
    expect(trigger().className).toContain("bg-accent text-primary-text");
    expect(trigger().getAttribute("aria-current")).toBeNull();

    await mount(["vault"], "vault");
    expect(trigger().className).not.toContain("bg-accent text-primary-text");
    expect(trigger().className).toContain("hover:bg-accent");
  });
});

describe("卡片内容", () => {
  it("长尾项都在，各带图标与文字（没有「更多」标题行）", async () => {
    await mount();
    for (const item of RAIL_MORE_ITEMS) {
      expect(rowFor(item.labelKey).querySelector("svg"), item.key).toBeTruthy();
    }
    // 标题行已被去掉（用户 2026-10-11：那两个字多余）——可访问名由图标按钮的
    // aria-label 给，面板里不该再出现一次 "更多" 文案。
    expect(card().textContent).not.toContain("navRail.more");
  });

  it("面板不是菜单：没有 menu 角色，且按钮数恰好是 行 + 图钉", async () => {
    // 「点触发器什么也不做」拦不住「把 Radix 菜单加回来」（那会同时满足不导航 + 类串不变）；
    // 这条钉住形状：面板里只有长尾项 × 2 颗按钮，没有任何 menu/menuitem 角色。
    await mount();
    expect(
      container.querySelectorAll('[role="menu"], [role="menuitem"]'),
    ).toHaveLength(0);
    expect(card().querySelectorAll("button")).toHaveLength(
      RAIL_MORE_ITEMS.length * 2,
    );
  });

  it("当前所在那一行带 aria-current，且只有一行", async () => {
    await mount([], "apps");
    const current = Array.from(card().querySelectorAll("button")).filter(
      (el) => el.getAttribute("aria-current") === "page",
    );
    expect(current).toHaveLength(1);
    expect(current[0].textContent?.trim()).toBe("sidebar.apps");
  });

  it("初始就是展开态：hover 与 focus-within 两条路都在", async () => {
    // 两条都要断言：只查 hover 时，把 `group-focus-within:*` 删掉不会红 ——
    // 而那条是**键盘唯一**的进门路径（面板不可见时它的按钮不可聚焦）。
    await mount();
    expect(card().className).toContain("group-hover:visible");
    expect(card().className).toContain("group-focus-within:visible");
    expect(card().className).toContain("group-hover:opacity-100");
    expect(card().className).toContain("group-focus-within:opacity-100");
  });
});

describe("点行 / 点图钉", () => {
  it("点行切视图，并把卡片收起来（指针还在图标上也收）", async () => {
    await mount();
    await pointerClick(rowFor("sidebar.vault"));
    expect(useAppStore.getState().activeView).toBe("vault");
    expect(isRevealed(), "点过之后要摘掉展开类").toBe(false);
  });

  it("键盘激活（detail === 0）切视图但**不**收起：Shift+Tab 回来卡片还在", async () => {
    await mount();
    await act(async () =>
      rowFor("sidebar.vault").dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 }),
      ),
    );
    expect(useAppStore.getState().activeView).toBe("vault");
    expect(isRevealed()).toBe(true);
  });

  it("点图钉只切固定状态（不切视图），且同样收起卡片", async () => {
    // 用户 2026-10-11：「点击菜单里面的按钮这个菜单要消失才对」——
    // 面板里任何一颗按钮都适用这条，图钉不例外。
    await mount();
    await pointerClick(pinFor("sidebar.vault"));
    expect(onTogglePin).toHaveBeenCalledWith("vault");
    expect(useAppStore.getState().activeView).toBe("chat");
    expect(isRevealed(), "点过图钉也要收起").toBe(false);
  });

  it("键盘激活图钉（detail === 0）不收起：Shift+Tab 回来卡片还在", async () => {
    await mount();
    await act(async () =>
      pinFor("sidebar.vault").dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 }),
      ),
    );
    expect(onTogglePin).toHaveBeenCalledWith("vault");
    expect(isRevealed()).toBe(true);
  });

  it("面板顶边与那颗图标齐平（top-0，不再纵向居中）", async () => {
    // 用户 2026-10-11 对着参考图确认「弹出菜单顶部要和 … 对齐」。
    // jsdom 没有布局引擎，位置只能钉类串（与 ideas-nav 钉卡片类串同一守法）。
    await mount();
    expect(card().className).toContain("top-0");
    expect(card().className).not.toContain("top-1/2");
    expect(
      card().className,
      "半回退（留着 top-0 又加回 -translate-y-1/2）也要红",
    ).not.toContain("-translate-y-1/2");
    expect(card().className, "隐形桥仍在").toContain("pl-1");
  });

  it("已固定的行，图钉换成「取消固定」的可达名", async () => {
    await mount(["vault"]);
    await pointerClick(pinFor("sidebar.vault", true));
    expect(onTogglePin).toHaveBeenCalledWith("vault");
    expect(isRevealed()).toBe(false);
  });

  it("收起之后**指针离开不复位**（根因回归闸）", async () => {
    // 点面板里的按钮会把面板自己变成 invisible ⇒ 它马上不再参与命中测试 ⇒ 指针脚下那一下
    // 被判定成「离开这一格」。复位若挂在这条离开事件上，刚设的「已收起」会被当场抹掉、面板
    // 又弹回来（真实浏览器复现见 RailMoreMenu.tsx 注释里那份复现页）。
    await mount();
    await pointerClick(rowFor("sidebar.vault"));
    expect(isRevealed()).toBe(false);

    // React 的 leave 由 mouseout 合成，relatedTarget 落在格子外才算真的离开。
    // 从**行本体那颗按钮**派发（真实离开就发生在这里）—— 打在 group 容器上时，
    // 复位若被挪到某个更内层的元素上就不会红。
    await act(async () =>
      rowFor("sidebar.automation").dispatchEvent(
        new MouseEvent("mouseout", {
          bubbles: true,
          relatedTarget: document.body,
        }),
      ),
    );
    expect(isRevealed(), "指针离开不该复位").toBe(false);
  });

  it("指针**重新进入**这一格 → 复位；键盘焦点回到这一格 → 也复位", async () => {
    await mount();
    await pointerClick(rowFor("sidebar.vault"));
    expect(isRevealed()).toBe(false);

    // React 的 enter 由 mouseover 合成，relatedTarget 落在格子外才算真的进入（同样从行按钮派发）
    await act(async () =>
      rowFor("sidebar.automation").dispatchEvent(
        new MouseEvent("mouseover", {
          bubbles: true,
          relatedTarget: document.body,
        }),
      ),
    );
    expect(isRevealed(), "重新进入要复位").toBe(true);

    await pointerClick(rowFor("sidebar.vault"));
    expect(isRevealed()).toBe(false);

    await act(async () => trigger().focus());
    expect(isRevealed(), "聚焦要能把它找回来").toBe(true);
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

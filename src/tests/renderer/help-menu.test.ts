// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  // UpdateConfirmDialog 会取 `i18n.language` 去挑语种的更新说明，
  // mock 里必须给 i18n，否则“点发现新版本开弹窗”那条用例会报 undefined
  useTranslation: () => ({
    // 只对 railLabel 插值：它带 {{version}}，其余 key 原样返回。
    // 前缀 v 由组件拼（store 存裸 semver），所以断言里能看到 v1.0.42 这种完整串。
    t: (key: string, options?: { version?: string }) =>
      key === "update.railLabel" && options?.version
        ? `update.railLabel(${options.version})`
        : key,
    i18n: { language: "zh" },
  }),
}));

import { HelpMenu } from "../../renderer/components/HelpMenu";
import { useAppStore } from "../../renderer/store";

const MANUAL_URL = "https://www.deskwand.com/manual";
const FEEDBACK_URL = "https://github.com/deskwand/agent/issues";

let container: HTMLDivElement;
let root: Root;
let send: ReturnType<typeof vi.fn>;
let openExternal: ReturnType<typeof vi.fn>;

function helpButton(): HTMLButtonElement {
  const button = container.querySelector('button[aria-label="help.label"]');
  expect(button, "? 按钮必须存在").toBeTruthy();
  return button as HTMLButtonElement;
}

/** 有更新时同一颗按钮换成升级语义，aria-label 也换了。 */
function updateButton(): HTMLButtonElement {
  const button = container.querySelector(
    'button[aria-label^="update.railLabel"]',
  );
  expect(button, "升级按钮必须存在").toBeTruthy();
  return button as HTMLButtonElement;
}

function row(labelKey: string): HTMLElement {
  // 查 document.body 而不是 container：两个来源都经 Portal 挂在 body 下
  //（HelpMenu 的菜单 = Radix 的 DropdownMenuContent；更新弹窗 = Radix 的 AlertDialog）。
  //
  // 选择器必须同时覆盖两种：Radix 的 **DropdownMenuItem 渲染的是
  // div[role="menuitem"]（不是 button）**，而更新弹窗里的键是真 <button>。
  // 只查 button 会漏掉菜单行，症状是「xx 行必须存在」——看着像内容没渲染，
  // 其实是元素类型变了。
  const el = [
    ...document.body.querySelectorAll('button, [role="menuitem"]'),
  ].find((candidate) => candidate.textContent?.includes(labelKey));
  expect(el, `${labelKey} 行必须存在`).toBeTruthy();
  return el as HTMLElement;
}

async function renderMenu(): Promise<void> {
  await act(async () => {
    root.render(React.createElement(HelpMenu));
  });
}

/**
 * 打开菜单。
 *
 * ⚠️ 必须派发 **pointerdown**，不能只 `.click()` —— Radix 的菜单 Trigger 在
 * 指针**按下**时打开（菜单的标准交互）。jsdom 没有 PointerEvent，用 MouseEvent
 * 派发同名事件即可（React 按事件名映射到 onPointerDown）。
 *
 * 这条踩过一次：先只点 click → 菜单不开，症状是「菜单里没有那一行」，
 * 看上去像内容渲染错了。诊断时又因为先派发了 pointerdown，把 `afterClick`
 * 读成 true（其实菜单早开了），一度误判 click 也能开。
 */
/**
 * 点一次触发器（Radix 在 **pointerdown** 时切换菜单）。
 * jsdom 没有 PointerEvent，用 MouseEvent 派发同名事件即可
 *（React 按事件名映射到 onPointerDown）。
 */
async function clickTrigger(): Promise<void> {
  await act(async () => {
    helpButton().dispatchEvent(
      new MouseEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
      }),
    );
  });
}

async function openMenu(): Promise<void> {
  await renderMenu();
  await clickTrigger();
}

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  send = vi.fn();
  openExternal = vi.fn();
  window.electronAPI = {
    send,
    openExternal,
    // preload 的 getVersion 永远返回 Promise（ipcRenderer.invoke），
    // 所以只测 then 分支
    getVersion: () => Promise.resolve("1.0.41"),
  } as unknown as typeof window.electronAPI;
  // Radix 的菜单内容会调 scrollIntoView，而 jsdom **没有实现**它 ——
  // 不桩的话打开菜单时会抛 TypeError，表现却是「菜单里没有那一行」，
  // 极易误判成内容渲染错误。本仓已有先例（sidebar-project-groups.test.ts 同样桩了它）。
  Element.prototype.scrollIntoView = vi.fn();
  container = document.createElement("div");
  document.body.innerHTML = "";
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  // Radix 经 Portal 挂到 document.body 的弹窗节点，清掉以免跨用例污染
  document
    .querySelectorAll('[role="dialog"], [role="alertdialog"], [role="menu"]')
    .forEach((el) => el.remove());
});

describe("帮助弹层的四类行", () => {
  it("无更新时：有检查更新行，没有发现新版本行", async () => {
    await openMenu();
    expect(document.body.textContent).toContain("about.checkUpdate");
    expect(document.body.textContent).not.toContain("update.title");
  });

  it("有更新时：按钮换成升级图标，aria-label 带完整版本号，且不再是菜单按钮", async () => {
    useAppStore.setState({
      updateReady: true,
      updateVersion: "1.0.421-beta.1",
      updateNotes: null,
    });
    await renderMenu();

    const button = updateButton();
    // CircleArrowUp 在 lucide-react v1.8.0 渲染的 class 是 lucide-circle-arrow-up；
    // CircleHelp 是 circle-question-mark 的别名，class 是 lucide-circle-question-mark
    // （两个名字都实测过，不是按 lucide 官网猜的）
    expect(button.querySelector(".lucide-circle-arrow-up")).not.toBeNull();
    expect(button.querySelector(".lucide-circle-question-mark")).toBeNull();
    // 前缀 v 由组件拼；beta 后缀必须完整带出
    expect(button.getAttribute("aria-label")).toBe(
      "update.railLabel(v1.0.421-beta.1)",
    );
    // 不再是菜单按钮：两个属性必须一起撤掉
    expect(button.getAttribute("aria-haspopup")).toBeNull();
    expect(button.getAttribute("aria-expanded")).toBeNull();
    // 那颗 6px 圆点随本次改动删除：按钮内不应再有任何装饰性 span
    expect(button.querySelector('span[aria-hidden="true"]')).toBeNull();
    // 点之前菜单不该自己冒出来
    expect(document.body.textContent).not.toContain("help.feedback");
    expect(document.body.textContent).not.toContain("update.restart");
  });

  it("关于行尾显示读到的当前版本（getVersion effect 的落点）", async () => {
    await openMenu();
    expect(document.body.textContent).toContain("v1.0.41");
  });

  it("点使用手册：打开手册地址并关掉弹层", async () => {
    await openMenu();
    await act(async () => row("help.docs").click());
    expect(openExternal).toHaveBeenCalledWith(MANUAL_URL);
    expect(document.body.textContent).not.toContain("help.feedback");
  });

  it("点反馈问题：切到应用内反馈视图", async () => {
    await openMenu();
    await act(async () => row("help.feedback").click());
    expect(useAppStore.getState().activeView).toBe("feedback");
    expect(openExternal).not.toHaveBeenCalledWith(FEEDBACK_URL);
  });

  it("点关于 DeskWand：进设置页的 about tab", async () => {
    await openMenu();
    await act(async () => row("about.title").click());
    expect(useAppStore.getState().activeView).toBe("settings");
    expect(useAppStore.getState().settingsTab).toBe("about");
  });

  it("点检查更新：发出 update.check 并关掉弹层", async () => {
    await openMenu();
    await act(async () => row("about.checkUpdate").click());
    expect(send).toHaveBeenCalledWith({ type: "update.check", payload: {} });
    expect(document.body.textContent).not.toContain("about.checkUpdate");
  });

  it("有更新时：点栏里的升级按钮直接开更新弹窗，确认后发 update.install", async () => {
    useAppStore.setState({
      updateReady: true,
      updateVersion: "1.0.42",
      updateNotes: null,
    });
    await renderMenu();
    await act(async () => updateButton().click());
    // 迁到 Radix 后 UpdateConfirmDialog 经 Portal 挂到 document.body
    //（原实现不开 portal、且 isOpen 为假时 return null），故文本断言要看 body。
    expect(document.body.textContent).toContain("update.restart");

    // 弹窗里的版本徽标也带 v（与同弹窗的 update.description 一致）
    expect(document.body.textContent).toContain("v1.0.41");
    expect(document.body.textContent).toContain("v1.0.42");

    await act(async () => row("update.restart").click());
    expect(send).toHaveBeenCalledWith({
      type: "update.install",
      payload: {},
    });
  });

  it("再点一次 ? 或点遮罩都会关掉弹层", async () => {
    await openMenu();
    expect(document.body.textContent).toContain("help.feedback");

    await clickTrigger();
    expect(document.body.textContent).not.toContain("help.feedback");

    await clickTrigger();
    expect(document.body.textContent).toContain("help.feedback");

    // 「点遮罩关闭」这一段**刻意删掉了**：那个手写的 `div.fixed.inset-0`
    // 遮罩已随迁移消失（Radix 用 DismissableLayer 接管外部点击），所以按它
    // 定位必然失败 —— 那不是回归，是机制换了。Esc 关闭由下面
    // 「帮助弹层是 Radix 的 DropdownMenu」那一组覆盖；
    // 点外部关闭**不在这里断言**：计划 4 的实测结论是往 container 派发
    // pointerdown/click 到达 Radix 在本仓 harness 里不可靠（同一份代码
    // 连跑 3 次全过、第 4 次红），写了就是 flaky 而不是覆盖。
  });

  it("弹层关着时，栏里没有任何版本号文字", async () => {
    useAppStore.setState({
      updateReady: true,
      updateVersion: "1.0.421-beta.1",
      updateNotes: null,
    });
    await renderMenu();
    // 弹层关着 = 栏里只有一颗图标与头像（有更新时那颗是升级图标），
    // 任何形式的版本号都不该出现在可见文本里
    expect(document.body.textContent).not.toContain("1.0.421-beta.1");
    expect(document.body.textContent).not.toContain("v1.0.421-beta.1");
  });

  it("无更新时：点按钮开菜单，不出更新弹窗", async () => {
    await renderMenu();
    // 无更新时的这一套属性是「不改动」的契约：改按钮状态时它们最先被误伤
    const button = helpButton();
    expect(button.getAttribute("aria-label")).toBe("help.label");
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    expect(button.getAttribute("aria-expanded")).toBe("false");

    await clickTrigger();
    expect(document.body.textContent).toContain("help.feedback");
    expect(document.body.textContent).not.toContain("update.restart");
  });

  it("只有 updateReady 没有版本号：不换装，仍是「?」", async () => {
    // store 的两个字段来自同一条 IPC，但它们不该被当成一个东西用：
    // 少了版本号就会出现「新版本 v 已就绪」这种半截文案。
    useAppStore.setState({
      updateReady: true,
      updateVersion: "",
      updateNotes: null,
    });
    await renderMenu();
    expect(
      helpButton().querySelector(".lucide-circle-question-mark"),
    ).not.toBeNull();
    expect(container.querySelector(".lucide-circle-arrow-up")).toBeNull();
  });

  it("菜单开着时更新到达：菜单自己收起，按钮换装", async () => {
    await openMenu();
    expect(document.body.textContent).toContain("help.feedback");

    await act(async () => {
      useAppStore.setState({
        updateReady: true,
        updateVersion: "1.0.42",
        updateNotes: null,
      });
    });

    expect(document.body.textContent).not.toContain("help.feedback");
    expect(
      updateButton().querySelector(".lucide-circle-arrow-up"),
    ).not.toBeNull();
  });

  it("update.railLabel 两个语言包都留着 {{version}} 占位符", () => {
    // mock 把 railLabel 整个接管了，locale-parity 又只比 key 集合，
    // 所以 {{vesion}} 这种拼错在现有测试里是隐形的： Tooltip 与可访问名会直接
    // 把未插值的文本推给用户。这里直接查原始文案。
    const zh = JSON.parse(
      readFileSync("src/renderer/i18n/locales/zh.json", "utf8"),
    ) as { update: { railLabel: string } };
    const en = JSON.parse(
      readFileSync("src/renderer/i18n/locales/en.json", "utf8"),
    ) as { update: { railLabel: string } };
    expect(zh.update.railLabel).toContain("{{version}}");
    expect(en.update.railLabel).toContain("{{version}}");
  });
});

describe("帮助弹层是 Radix 的 DropdownMenu", () => {
  it("菜单有 role=menu 且经 Portal 挂在 body 下", async () => {
    // 迁移前它是内联的 absolute 面板（有 role="menu" 但**不在 portal 里**）。
    // 内容经 Portal 后查询必须看 document.body（陷阱 3）。
    await openMenu();
    expect(document.body.querySelector('[role="menu"]')).not.toBeNull();
    expect(
      container.querySelector('[role="menu"]'),
      "不应留在本地 container 里",
    ).toBeNull();
  });

  it("点菜单外部关闭（正对照 + 断言）", async () => {
    // 评审 Important 3：原来那条「点遮罩关闭」被删掉后，「点外部会关」在菜单上
    // **没有任何断言**了。Radix 用 DismissableLayer 接管，判据换成「往弹层之外的
    // 元素派发 pointerdown + click」。
    //
    // 计划 4 的教训是这类派发在本仓 harness 里可能不可靠（同一份代码连跑 3 次全过、
    // 第 4 次红）。所以这条**必须**先做正对照：确认菜单确实开着，再断言它关了。
    await openMenu();
    expect(
      document.body.querySelector('[role="menu"]'),
      "正对照：菜单必须先确实开着",
    ).not.toBeNull();

    const outside = document.createElement("div");
    document.body.appendChild(outside);
    await act(async () => {
      outside.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      );
      outside.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
      );
    });
    outside.remove();
    expect(
      document.body.querySelector('[role="menu"]'),
      "点菜单外部应当关闭",
    ).toBeNull();
  });

  it("Esc 关闭", async () => {
    // 原实现**没有** Esc 处理（grep -c Escape = 0）—— 所以这条迁移前是红的，
    // 迁移后由 Radix 给到。这是本任务的主要收益之一。
    await openMenu();
    expect(document.body.querySelector('[role="menu"]')).not.toBeNull();

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true, // 陷阱 2：不声明则 preventDefault 无效
        }),
      );
    });
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
  });

  it("有更新时那颗按钮是**动作**按钮，菜单打不开（设计 §3.4）", async () => {
    // 迁移前由 `menuVisible = menuOpen && !hasUpdate` + 两个 aria 属性被显式撤掉实现。
    // 迁到 Radix 后由**条件渲染**保证 —— 这条用例钉住它，否则「更新就绪后菜单还能
    // 打开」会静默回归：菜单会停在「检查更新」那一行上，而更新已经在硬盘上了。
    useAppStore.setState({ updateReady: true, updateVersion: "1.0.99" });
    await renderMenu();

    const btn = updateButton();
    expect(btn, "有更新时是更新按钮").toBeTruthy();
    expect(
      btn.getAttribute("aria-haspopup"),
      "动作按钮不该自称菜单（Radix 的 Trigger 会硬塞这个属性）",
    ).toBeNull();

    await act(async () => btn.click());
    expect(
      document.body.querySelector('[role="menu"]'),
      "有更新时不许弹出菜单",
    ).toBeNull();
  });
});

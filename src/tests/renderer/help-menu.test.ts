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

function row(labelKey: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.includes(labelKey),
  );
  expect(button, `${labelKey} 行必须存在`).toBeTruthy();
  return button as HTMLButtonElement;
}

async function renderMenu(): Promise<void> {
  await act(async () => {
    root.render(React.createElement(HelpMenu));
  });
}

async function openMenu(): Promise<void> {
  await renderMenu();
  await act(async () => helpButton().click());
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
  container = document.createElement("div");
  document.body.innerHTML = "";
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("帮助弹层的四类行", () => {
  it("无更新时：有检查更新行，没有发现新版本行", async () => {
    await openMenu();
    expect(container.textContent).toContain("about.checkUpdate");
    expect(container.textContent).not.toContain("update.title");
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
    expect(container.textContent).not.toContain("help.feedback");
    expect(container.textContent).not.toContain("update.restart");
  });

  it("关于行尾显示读到的当前版本（getVersion effect 的落点）", async () => {
    await openMenu();
    expect(container.textContent).toContain("v1.0.41");
  });

  it("点使用手册：打开手册地址并关掉弹层", async () => {
    await openMenu();
    await act(async () => row("help.docs").click());
    expect(openExternal).toHaveBeenCalledWith(MANUAL_URL);
    expect(container.textContent).not.toContain("help.feedback");
  });

  it("点反馈问题：打开 issues 地址", async () => {
    await openMenu();
    await act(async () => row("help.feedback").click());
    expect(openExternal).toHaveBeenCalledWith(FEEDBACK_URL);
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
    expect(container.textContent).not.toContain("about.checkUpdate");
  });

  it("有更新时：点栏里的升级按钮直接开更新弹窗，确认后发 update.install", async () => {
    useAppStore.setState({
      updateReady: true,
      updateVersion: "1.0.42",
      updateNotes: null,
    });
    await renderMenu();
    await act(async () => updateButton().click());
    // UpdateConfirmDialog 不开 portal、isOpen 为假时 return null
    expect(container.textContent).toContain("update.restart");

    // 弹窗里的版本徽标也带 v（与同弹窗的 update.description 一致）
    expect(container.textContent).toContain("v1.0.41");
    expect(container.textContent).toContain("v1.0.42");

    await act(async () => row("update.restart").click());
    expect(send).toHaveBeenCalledWith({
      type: "update.install",
      payload: {},
    });
  });

  it("再点一次 ? 或点遮罩都会关掉弹层", async () => {
    await openMenu();
    expect(container.textContent).toContain("help.feedback");

    await act(async () => helpButton().click());
    expect(container.textContent).not.toContain("help.feedback");

    await act(async () => helpButton().click());
    expect(container.textContent).toContain("help.feedback");

    // 遮罩是弹层里的 fixed inset-0 那一层：点它同样关闭
    const backdrop = container.querySelector("div.fixed.inset-0");
    expect(backdrop).toBeTruthy();
    await act(async () => (backdrop as HTMLElement).click());
    expect(container.textContent).not.toContain("help.feedback");
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
    expect(container.textContent).not.toContain("1.0.421-beta.1");
    expect(container.textContent).not.toContain("v1.0.421-beta.1");
  });

  it("无更新时：点按钮开菜单，不出更新弹窗", async () => {
    await renderMenu();
    // 无更新时的这一套属性是「不改动」的契约：改按钮状态时它们最先被误伤
    const button = helpButton();
    expect(button.getAttribute("aria-label")).toBe("help.label");
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    expect(button.getAttribute("aria-expanded")).toBe("false");

    await act(async () => button.click());
    expect(container.textContent).toContain("help.feedback");
    expect(container.textContent).not.toContain("update.restart");
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
    expect(container.textContent).toContain("help.feedback");

    await act(async () => {
      useAppStore.setState({
        updateReady: true,
        updateVersion: "1.0.42",
        updateNotes: null,
      });
    });

    expect(container.textContent).not.toContain("help.feedback");
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

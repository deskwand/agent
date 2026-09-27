// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  // UpdateConfirmDialog 会取 `i18n.language` 去挑语种的更新说明，
  // mock 里必须给 i18n，否则“点发现新版本开弹窗”那条用例会报 undefined
  useTranslation: () => ({
    t: (key: string) => key,
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

/** 圆点是按钮内唯一的 aria-hidden span */
function dot(): Element | null {
  return helpButton().querySelector('span[aria-hidden="true"]');
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
    expect(dot()).toBeNull();
  });

  it("有更新时：有发现新版本行（行尾带版本号）与圆点", async () => {
    useAppStore.setState({
      updateReady: true,
      updateVersion: "1.0.421-beta.1",
      updateNotes: null,
    });
    await renderMenu();
    expect(dot()).not.toBeNull();

    await act(async () => helpButton().click());
    expect(container.textContent).toContain("update.title");
    // 前缀 v 是界面补的：store 里只有裸 semver。
    // 断言行尾 span 的完整文本，既钉住前缀、也挡掉 vv 这种重复前缀
    const trailing = row("update.title")
      .querySelector("span.ml-auto")
      ?.textContent?.trim();
    expect(trailing).toBe("v1.0.421-beta.1");
    expect(container.textContent).not.toContain("about.checkUpdate");
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

  it("点发现新版本：打开更新弹窗（更新说明的落点）", async () => {
    useAppStore.setState({
      updateReady: true,
      updateVersion: "1.0.42",
      updateNotes: null,
    });
    await openMenu();
    await act(async () => row("update.title").click());
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
    // 弹层关着 = 栏里只有 ? 与头像，任何形式的版本号都不该出现
    expect(container.textContent).not.toContain("1.0.421-beta.1");
    expect(container.textContent).not.toContain("v1.0.421-beta.1");
  });
});

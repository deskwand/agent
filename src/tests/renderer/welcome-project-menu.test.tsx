// @vitest-environment jsdom
/**
 * 欢迎页底栏的项目 chip：列项目、切项目、失败早退。
 *
 * 关系最紧的邻居是 `src/tests/renderer/ideas-view.test.tsx`（同一套动作链：
 * workdir.set → setWorkingDir）与 `welcome-first-session-cwd.test.tsx`
 * （同一张视图的发送链路）。写法照它们：jsdom + react-dom/client + act，
 * 仓里没有 @testing-library。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** useIPC 是 vi.mock 的工厂里读的，所以必须 hoisted；isElectron 要能逐条用例改。 */
const ui = vi.hoisted(() => ({
  startSession: vi.fn(),
  invoke: vi.fn(),
  isElectron: true,
}));

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
  }),
}));

vi.mock("../../renderer/hooks/useIPC", () => ({
  useIPC: () => ({
    startSession: ui.startSession,
    invoke: ui.invoke,
    isElectron: ui.isElectron,
  }),
}));

import { WelcomeView } from "../../renderer/components/WelcomeView";
import { useAppStore } from "../../renderer/store";
import type { Session } from "../../renderer/types";
import { toggleAttachMenu } from "./attach-menu-helper";

let container: HTMLDivElement;
let root: Root;

/** 项目会话：本文件只关心 cwd / isProjectMode / archived 三个字段。 */
const projectSession = (id: string, cwd: string): Session => ({
  id,
  title: id,
  status: "idle",
  mountedPaths: [],
  allowedTools: [],
  memoryEnabled: false,
  isProjectMode: true,
  cwd,
  createdAt: Date.parse("2026-10-11T15:04:07+08:00"),
  updatedAt: Date.parse("2026-10-11T15:04:07+08:00"),
});

/** chip 的 aria-label 带当前项目名（triggerLabel 插值）——前缀匹配即证明插值没漏。 */
function chip(): HTMLButtonElement {
  const el = container.querySelector<HTMLButtonElement>(
    'button[aria-label^="welcome.projectMenu.triggerLabel"]',
  );
  expect(el, "底栏必须有一枚项目 chip").toBeTruthy();
  return el as HTMLButtonElement;
}

function menuItems(): HTMLElement[] {
  return [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')];
}

function menuItemByText(text: string): HTMLElement {
  const el = menuItems().find((item) => item.textContent?.trim() === text);
  expect(el, `菜单项「${text}」必须存在`).toBeTruthy();
  return el as HTMLElement;
}

/** 附件菜单的「工作区」入口（菜单 portal 到 document.body，不在 container 里）。 */
function workspaceItem(): HTMLElement {
  const el = [
    ...document.body.querySelectorAll<HTMLElement>('button, [role="menuitem"]'),
  ].find((item) => item.textContent?.includes("attachMenu.workspace"));
  expect(el, "附件菜单里必须有「工作区」入口").toBeTruthy();
  return el as HTMLElement;
}

/** Radix 的菜单触发器只认左键 pointerdown。 */
async function pointerDown(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.dispatchEvent(
      new MouseEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        ctrlKey: false,
      }),
    );
  });
}

/** Radix 的焦点移动/回焦都在 setTimeout(0) 里 —— 断言前得把这批任务跑完。 */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render(): Promise<void> {
  await act(async () => {
    root.render(<WelcomeView />);
  });
  await act(async () => {});
}

/** 展开菜单并点掉某一项，等 Radix 收起。 */
async function pick(label: string): Promise<void> {
  await pointerDown(chip());
  await act(async () => menuItemByText(label).click());
  await flush();
}

/** 往输入框敲字 + 回车（照 welcome-first-session-cwd.test.tsx）。 */
async function submitFirstMessage(text: string): Promise<void> {
  const editor = container.querySelector<HTMLElement>("[data-placeholder]")!;
  await act(async () => {
    editor.textContent = text;
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    editor.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  ui.isElectron = true;
  ui.startSession.mockResolvedValue(null);
  ui.invoke.mockResolvedValue({ success: true, path: "/work/beta" });
  // Task 2 往 localStorage 写项目记忆档 —— 逐条清掉，免得串到别的用例
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  useAppStore.setState({
    ...useAppStore.getInitialState(),
    workingDir: "/work/alpha",
    sessions: [
      projectSession("p1", "/work/beta"),
      projectSession("p2", "/work/alpha"),
    ],
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("欢迎页项目 chip", () => {
  it("菜单：默认工作区在最前，项目按名排序，当前项打 aria-current", async () => {
    await render();
    await pointerDown(chip());

    const items = menuItems();
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      "welcome.projectMenu.defaultWorkspace",
      "alpha",
      "beta",
    ]);
    // 打勾不只是画个图标：aria-current 才是「当前项」的可测契约，切项目后必须跟着走
    expect(items[1].getAttribute("aria-current")).toBe("true");
    expect(items[0].getAttribute("aria-current")).toBeNull();
    expect(items[2].getAttribute("aria-current")).toBeNull();
  });

  it("一个项目都没有：菜单里是默认工作区 + 置灰说明", async () => {
    useAppStore.setState({ sessions: [], workingDir: null });
    await render();
    await pointerDown(chip());

    const items = menuItems();
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      "welcome.projectMenu.defaultWorkspace",
      "welcome.projectMenu.empty",
    ]);
    expect(items[1].getAttribute("aria-disabled")).toBe("true");
  });

  it("会话列表还没到：chip 也认得当前的 workingDir", async () => {
    useAppStore.setState({ sessions: [], workingDir: "/work/alpha" });
    await render();

    // 名字来自 workingDir，不来自列表 —— 列表空掉时显示不能跟着空
    expect(chip().textContent).toContain("alpha");
    await pointerDown(chip());
    expect(menuItems().map((item) => item.textContent?.trim())).toEqual([
      "welcome.projectMenu.defaultWorkspace",
      "welcome.projectMenu.empty",
    ]);
  });

  it("选项目：先 workdir.set，成功才落 store（用主进程回传的 path）", async () => {
    ui.invoke.mockResolvedValue({ success: true, path: "/work/beta" });
    await render();
    await pick("beta");

    expect(ui.invoke).toHaveBeenCalledTimes(1);
    expect(ui.invoke).toHaveBeenCalledWith({
      type: "workdir.set",
      payload: { path: "/work/beta" },
    });
    // 回传值原样落 store（不自己拼路径）
    expect(useAppStore.getState().workingDir).toBe("/work/beta");
    // 切完 chip 跟标题都要跟上
    expect(chip().textContent).toContain("beta");
    expect(container.textContent).toContain("welcome.titleWithProject");
    // 当前项的勾要跟着走（不然切完菜单里一个勾都没有）
    await pointerDown(chip());
    expect(menuItemByText("beta").getAttribute("aria-current")).toBe("true");
    expect(
      menuItemByText("welcome.projectMenu.defaultWorkspace").getAttribute(
        "aria-current",
      ),
    ).toBeNull();
  });

  it("workdir.set 返回失败：目录不动，出全局错误提示", async () => {
    ui.invoke.mockResolvedValue({
      success: false,
      path: "",
      error: "Directory does not exist",
    });
    await render();
    await pick("beta");

    expect(useAppStore.getState().workingDir).toBe("/work/alpha");
    expect(useAppStore.getState().globalNotice?.type).toBe("error");
    expect(useAppStore.getState().globalNotice?.message).toBe(
      "welcome.projectMenu.switchFailed",
    );
    // 与连接成功提示同款：messageKey 让通知在切语言后仍能跟随
    expect(useAppStore.getState().globalNotice?.messageKey).toBe(
      "welcome.projectMenu.switchFailed",
    );
  });

  it("workdir.set 抛异常：与返回失败同样处理", async () => {
    ui.invoke.mockRejectedValue(new Error("ipc down"));
    await render();
    await pick("beta");

    expect(useAppStore.getState().workingDir).toBe("/work/alpha");
    expect(useAppStore.getState().globalNotice?.message).toBe(
      "welcome.projectMenu.switchFailed",
    );
  });

  it("非 Electron：不发 IPC，选中仍然生效", async () => {
    ui.isElectron = false;
    await render();
    await pick("beta");

    expect(ui.invoke).not.toHaveBeenCalled();
    expect(useAppStore.getState().workingDir).toBe("/work/beta");
  });

  it("回到默认工作区：不发 IPC，workingDir 清成 null，标题回到不带项目名那一支", async () => {
    await render();
    await pick("welcome.projectMenu.defaultWorkspace");

    expect(ui.invoke).not.toHaveBeenCalled();
    expect(useAppStore.getState().workingDir).toBeNull();
    expect(container.textContent).toContain("welcome.title");
    // welcome.title 是 welcome.titleWithProject 的子串，所以只查子串是查不出来的
    expect(container.textContent).not.toContain("welcome.titleWithProject");
  });

  it("长项目名 / 窄窗：chip 钉在左簇首位，且自己带截断约束", async () => {
    // jsdom 量不出布局 —— 这条钉两条**结构契约**（就是原型页 review 过的那两条）：
    //   ① chip 是左簇的第一个元素（附件/麦克风紧随其后）；
    //   ② 截断是 chip 自己的责任：左簇成员都是 shrink-0，撑出去就把右簇挤没。
    // 真实观感（300px 底栏）由 design-docs/mockups/2026-10-13-welcome-project-menu.html
    // 的窄窗格复核，别拿类名断言冒充行为测试。
    useAppStore.setState({
      sessions: [projectSession("p1", "/work/一个非常非常长的项目名-2026-Q4")],
      workingDir: null,
    });
    await render();

    expect(chip().parentElement?.firstElementChild).toBe(chip());
    expect(chip().className).toContain("max-w-[8.5rem]");
    expect(chip().querySelector("span")?.className).toContain("truncate");
  });

  it("切完项目再发送：新会话的 cwd 就是刚选的项目", async () => {
    await render();
    await pick("beta");

    await submitFirstMessage("在这个项目里干点活");

    expect(ui.startSession).toHaveBeenCalledTimes(1);
    // startSession(title, content, cwd, ...) —— 第三个参数
    expect(ui.startSession.mock.calls[0][2]).toBe("/work/beta");
  });

  it("附件菜单的「工作区」跟着项目走：无项目置灰，选了项目可用", async () => {
    // `cwd` 传没传只有一个可观察后果：AttachMenu 的「工作区」入口的 aria-label 是
    // `attachMenu.disabled.noWorkspace` 还是 `attachMenu.workspace`（AttachMenu.tsx:510-511）。
    // 不挂 electronAPI 桥：扫目录在 try 里，缺桥只会把那一行显示成错误态，aria-label
    // 照旧只看 cwd。挂了反而会踩到 `useVoiceInput` 里 `window.electronAPI.voice.onEvent`。
    useAppStore.setState({ workingDir: null });
    await render();

    await act(async () => {
      await toggleAttachMenu(container);
    });
    expect(workspaceItem().getAttribute("aria-disabled")).toBe("true");
    expect(workspaceItem().getAttribute("aria-label")).toBe(
      "attachMenu.disabled.noWorkspace",
    );
    await act(async () => {
      await toggleAttachMenu(container); // 再点一次 = 关掉
    });

    await pick("beta");
    await act(async () => {
      await toggleAttachMenu(container);
    });
    expect(workspaceItem().getAttribute("aria-disabled")).toBeNull();
    expect(workspaceItem().getAttribute("aria-label")).toBe(
      "attachMenu.workspace",
    );
  });
});

describe("切项目后的模型 / 思考档", () => {
  // 一份最小可用配置：custom provider 必须有 defaultModel 与 apiKey，
  // 否则 hasUsableProviderConfig 直接把它筛掉，芯片上什么都不会有。
  const appConfig = {
    model: "alpha-model",
    activeProviderKey: "custom:one",
    thinkingLevel: "medium",
    providers: {
      "custom:one": {
        name: "One",
        defaultModel: "alpha-model",
        apiKey: "k",
        customProtocol: "anthropic",
        models: [
          { id: "alpha-model", label: "Alpha Model" },
          { id: "beta-model", label: "Beta Model" },
        ],
      },
    },
  };

  it("切到项目：应用该项目记住的模型与思考档", async () => {
    localStorage.setItem(
      "deskwand.pm." + encodeURIComponent("/work/beta"),
      JSON.stringify({ p: "custom:one", m: "beta-model", t: "high" }),
    );
    useAppStore.setState({
      appConfig: appConfig as never,
      // 不置 true 的话 showConnectCards 会替掉整个底栏（appConfig 非 null + 未配置）——
      // 芯片就根本不存在，失败点会跑到前置断言上
      isConfigured: true,
      workingDir: "/work/alpha",
      sessions: [
        projectSession("p1", "/work/beta"),
        projectSession("p2", "/work/alpha"),
      ],
    });
    await render();
    // 先落在全局档上（alpha 没有记忆档 → appConfig.model / thinkingLevel）
    expect(container.textContent).toContain("Alpha Model");
    expect(container.textContent).toContain("chat.thinkingLevel.medium");

    await pick("beta");

    expect(container.textContent).toContain("Beta Model");
    expect(container.textContent).not.toContain("Alpha Model");
    expect(container.textContent).toContain("chat.thinkingLevel.high");
  });

  it("回到默认工作区：芯片跟着回到全局档，不残留上一个项目的模型", async () => {
    localStorage.setItem(
      "deskwand.pm." + encodeURIComponent("/work/beta"),
      JSON.stringify({ p: "custom:one", m: "beta-model", t: "high" }),
    );
    useAppStore.setState({
      appConfig: appConfig as never,
      isConfigured: true,
      workingDir: "/work/beta",
      sessions: [projectSession("p1", "/work/beta")],
    });
    await render();
    expect(container.textContent).toContain("Beta Model");

    await pick("welcome.projectMenu.defaultWorkspace");

    expect(container.textContent).toContain("Alpha Model");
    expect(container.textContent).toContain("chat.thinkingLevel.medium");
  });

  it("项目里的思考档是脏值时：落到中性档，不沿用上一个目录的档", async () => {
    localStorage.setItem(
      "deskwand.pm." + encodeURIComponent("/work/beta"),
      JSON.stringify({ p: "custom:one", m: "beta-model", t: "garbage-level" }),
    );
    useAppStore.setState({
      appConfig: { ...appConfig, thinkingLevel: "high" } as never,
      isConfigured: true,
      workingDir: "/work/alpha",
      sessions: [
        projectSession("p1", "/work/beta"),
        projectSession("p2", "/work/alpha"),
      ],
    });
    await render();
    expect(container.textContent).toContain("chat.thinkingLevel.high");

    await pick("beta");

    expect(container.textContent).toContain("Beta Model");
    // 脏值既不该被沿用，也不该让「切到项目」的结果取决于你从哪儿切过来
    expect(container.textContent).toContain("chat.thinkingLevel.medium");
    expect(container.textContent).not.toContain("chat.thinkingLevel.high");
  });

  it("同一个项目内 effect 重跑：不把用户手选的模型冲回记忆档", async () => {
    const pm = (m: string) =>
      localStorage.setItem(
        "deskwand.pm." + encodeURIComponent("/work/alpha"),
        JSON.stringify({ p: "custom:one", m, t: "medium" }),
      );
    pm("beta-model");
    useAppStore.setState({
      appConfig: appConfig as never,
      isConfigured: true,
      workingDir: "/work/alpha",
      sessions: [projectSession("p2", "/work/alpha")],
    });
    await render();
    expect(container.textContent).toContain("Beta Model");

    // 用户在芯片上改选成 alpha-model：onSelectModel 会把选择写回同一份 localStorage
    pm("alpha-model");
    // 触发初始化 effect 重跑（appConfig 换身份是现实里最常见的触发源）
    await act(async () => {
      useAppStore.setState({ appConfig: { ...appConfig } as never });
    });

    // 守卫（initializedForDir === dirKey）生效就不该重读 localStorage：
    // 否则芯片会被用户自己的选择"改回去"，看起来像选不中
    expect(container.textContent).toContain("Beta Model");
    expect(container.textContent).not.toContain("Alpha Model");
  });
});

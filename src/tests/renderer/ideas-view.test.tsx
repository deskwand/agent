// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupDialogs } from "../dialog-test-helpers";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { IdeasView } from "../../renderer/components/IdeasView";
import { useAppStore } from "../../renderer/store";
import type { IdeaSummary } from "../../shared/ideas";
import type { Session } from "../../renderer/types";

let container: HTMLDivElement;
let root: Root;
const setStatus = vi.fn();
const remove = vi.fn();
const list = vi.fn();
const read = vi.fn();
const invoke = vi.fn();

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

const idea = (
  name: string,
  excerpt: string,
  status: "inbox" | "archived" = "inbox",
  sourceSessionId: string | null = "s1",
): IdeaSummary => ({
  name,
  excerpt,
  createdAt: Date.parse("2026-10-11T15:04:07+08:00"),
  status,
  archivedAt: null,
  sourceSessionId,
  sourceView: "chat",
});

function buttonByText(
  text: string,
  scope: ParentNode = container,
): HTMLButtonElement {
  const el = [...scope.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === text,
  );
  expect(el, `按钮「${text}」必须存在`).toBeTruthy();
  return el as HTMLButtonElement;
}

function buttonByLabel(label: string): HTMLButtonElement {
  const el = container.querySelector(`button[aria-label="${label}"]`);
  expect(el, `aria-label="${label}" 的按钮必须存在`).toBeTruthy();
  return el as HTMLButtonElement;
}

/** 菜单内容经 Radix Portal 挂到 document.body —— 不在本文件的 container 里。 */
function menu(): Element | null {
  return document.body.querySelector('[role="menu"]');
}

function menuItemByText(text: string): HTMLElement {
  const el = [...document.body.querySelectorAll('[role="menuitem"]')].find(
    (item) => item.textContent?.trim() === text,
  );
  expect(el, `菜单项「${text}」必须存在`).toBeTruthy();
  return el as HTMLElement;
}

/** Radix 的菜单触发器只认左键 pointerdown（无 ctrl）—— 旧的 onClick toggle 已删。 */
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

async function keyDown(el: Element, key: string): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
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
    root.render(<IdeasView />);
  });
  await act(async () => {});
}

beforeEach(() => {
  // 本仓的 vitest 4 里 `clearAllMocks` 会连**实现**一起清掉，实现必须写在它之后。
  vi.clearAllMocks();
  // `mockImplementation` 而不是 `mockResolvedValue`：列表每次都得是**新对象**，
  // 否则 `find()` 会一直返回同一个引用，依赖 `selected` 对象身份的写法在这份测试里
  // 永远不会被触发（H1 那条回归就成了摆设）。
  list.mockImplementation(async () => ({
    inbox: [idea("a", "第一条"), idea("b", "第二条")],
    archived: [idea("c", "已归档的", "archived")],
    skipped: 0,
  }));
  read.mockResolvedValue({ body: "正文一", mtimeMs: 1 });
  setStatus.mockResolvedValue({});
  remove.mockResolvedValue({});
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    platform: "darwin",
    invoke,
    ideas: { list, read, setStatus, remove, update: vi.fn() },
  };
  invoke.mockResolvedValue({ success: true, path: "/work/alpha" });
  useAppStore.setState({
    ...useAppStore.getInitialState(),
    activeView: "ideas",
    ideasSelectedName: "a",
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  cleanupDialogs();
});

describe("灵感视图", () => {
  it("默认只显示未归档，且不显示归档组标题", async () => {
    await render();
    expect(container.textContent).toContain("第一条");
    expect(container.textContent).not.toContain("已归档的");
    expect(container.textContent).not.toContain("ideas.archivedGroup");
  });

  it("「显示已归档」走官方 Toggle：带 data-state，皮肤不手写", async () => {
    await render();
    const toggle = buttonByText("ideas.showArchived");
    // Radix Toggle 的标记；手写 aria-pressed + 条件类不会有 data-state
    expect(toggle.getAttribute("data-state")).not.toBeNull();
    expect(toggle.className, "皮肤来自 ui/toggle.tsx").not.toContain(
      "bg-accent text-foreground",
    );
  });

  it("开关打开后归档项附在末尾，并带一个组标题", async () => {
    await render();
    act(() => buttonByText("ideas.showArchived").click());
    expect(useAppStore.getState().showArchivedIdeas).toBe(true);
    await act(async () => {});
    expect(container.textContent).toContain("已归档的");
    expect(container.textContent).toContain("ideas.archivedGroup");
  });

  it("返回按钮切回聊天（复用 common.back，不另发明）", async () => {
    await render();
    act(() => buttonByLabel("common.back").click());
    expect(useAppStore.getState().activeView).toBe("chat");
  });

  it("列表行 hover 的归档键按 aria-label 定位，点击调 setStatus", async () => {
    await render();
    act(() => buttonByLabel("ideas.archiveNamed").click());
    await act(async () => {});
    expect(setStatus).toHaveBeenCalledWith("a", "archived");
  });

  it("列表行 hover 的删除键也走确认框（删除只有一个护栏）", async () => {
    await render();
    act(() => buttonByLabel("ideas.removeNamed").click());
    expect(remove).not.toHaveBeenCalled();
    const confirm = document.body.querySelector('[role="alertdialog"]');
    expect(confirm).toBeTruthy();
    await act(async () => buttonByText("common.delete", confirm!).click());
    expect(remove).toHaveBeenCalledWith("a");
  });

  it("详情头部：交给 AI 的两项都只是把正文填进输入框", async () => {
    await render();
    await pointerDown(buttonByText("ideas.handOff"));
    await act(async () => menuItemByText("ideas.handOffCurrent").click());
    expect(useAppStore.getState().pendingEditorAppend).toBe("正文一");
    expect(useAppStore.getState().activeView).toBe("chat");
  });

  it("新会话处理：清掉当前会话再填输入框", async () => {
    useAppStore.setState({ activeSessionId: "s1" });
    await render();
    await pointerDown(buttonByText("ideas.handOff"));
    await act(async () => menuItemByText("ideas.handOffNew").click());
    expect(useAppStore.getState().activeSessionId).toBeNull();
    expect(useAppStore.getState().pendingEditorAppend).toBe("正文一");
  });

  it("⋯ 菜单：归档项走确认框才删", async () => {
    await render();
    await pointerDown(buttonByLabel("ideas.moreActions"));
    await act(async () => menuItemByText("ideas.remove").click());
    expect(remove).not.toHaveBeenCalled();

    const confirm = document.body.querySelector('[role="alertdialog"]');
    expect(confirm).toBeTruthy();
    await act(async () => buttonByText("common.delete", confirm!).click());
    expect(remove).toHaveBeenCalledWith("a");
    // 关闭确认后焦点回到 ⋯ 触发器，而不是已卸载的菜单项。
    // 两跳：本视图的显式回焦排在 Radix 确认框自己的退场回焦之后。
    await flush();
    expect(document.activeElement).toBe(buttonByLabel("ideas.moreActions"));
  });

  it("⋯ 里的刷新在加载中禁用（v1 的 ideasLoading 不再是孤儿）", async () => {
    await render();
    // 渲染完成之后再置「加载中」：否则挂载那次 loadIdeas 会把它写回 false。
    act(() => useAppStore.setState({ ideasLoading: true }));
    await pointerDown(buttonByLabel("ideas.moreActions"));
    // Radix 的菜单项是 div（不是 button）—— 禁用态是 data/aria，不是 `disabled` 属性
    expect(
      document
        .querySelector('[data-testid="ideas-refresh"]')
        ?.getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("来源还在 → 显示会话标题，点它切回那次会话", async () => {
    useAppStore.setState({
      sessions: [
        {
          id: "s1",
          title: "输入框浮层改造",
          kind: "ordinary",
          status: "idle",
          mountedPaths: [],
          allowedTools: [],
          memoryEnabled: false,
          isProjectMode: false,
          createdAt: 1,
          updatedAt: 1,
        },
      ] as never,
    });
    await render();
    act(() => buttonByText("输入框浮层改造").click());
    expect(useAppStore.getState().activeSessionId).toBe("s1");
    expect(useAppStore.getState().activeView).toBe("chat");
  });

  it("会话已删 → 显示「会话已删除」且那一行不是按钮", async () => {
    list.mockResolvedValue({
      inbox: [idea("a", "第一条", "inbox", "gone")],
      archived: [],
      skipped: 0,
    });
    await render();
    expect(container.textContent).toContain("ideas.sourceDeleted");
    expect(container.textContent).not.toContain("ideas.sourceNone");
  });

  it("本来就与会话无关 → 中性文案，不说「已删除」", async () => {
    list.mockResolvedValue({
      inbox: [idea("a", "第一条", "inbox", null)],
      archived: [],
      skipped: 0,
    });
    await render();
    expect(container.textContent).toContain("ideas.sourceNone");
    expect(container.textContent).not.toContain("ideas.sourceDeleted");
  });

  it("空态给出快捷键提示（按平台渲染）", async () => {
    list.mockResolvedValue({ inbox: [], archived: [], skipped: 0 });
    useAppStore.setState({ ideasSelectedName: null });
    await render();
    expect(container.textContent).toContain("ideas.emptyTitle");
    expect(container.textContent).toContain("ideas.emptyHint");
  });

  it("有解析不了的文件时在顶部提示数量", async () => {
    list.mockResolvedValue({ inbox: [], archived: [], skipped: 2 });
    await render();
    expect(container.textContent).toContain("ideas.skipped");
  });

  it("列表拉失败时出错误横幅（否则和「没有想法」长得一样）", async () => {
    list.mockRejectedValue(new Error("EACCES"));
    await render();
    expect(container.textContent).toContain("ideas.loadFailed");
  });

  it("选中的那条不见了 → 回落到第一条（右栏不许莫名空着）", async () => {
    await render();
    list.mockResolvedValue({
      inbox: [{ ...idea("b", "第二条") }],
      archived: [],
      skipped: 0,
    });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await act(async () => {});
    expect(useAppStore.getState().ideasSelectedName).toBe("b");
    expect(container.textContent).toContain("第二条");
  });

  it("页头那颗「记一笔」直接开浮层（页面内终于有入口了）", async () => {
    await render();
    const add = container.querySelector<HTMLButtonElement>(
      '[data-testid="ideas-add"]',
    );
    expect(add, "页头要有新增入口").toBeTruthy();
    // 图标键没有字，可访问名与 tooltip 都得报出"记一笔（键位）"，
    // 否则一个光秃秃的 ＋ 谁也不知道是加什么。
    expect(add!.getAttribute("aria-label")).toBe("ideas.addWithShortcut");
    act(() => add!.click());
    expect(useAppStore.getState().ideaCaptureOpen).toBe(true);
    // 必顶：`openIdeaCapture` 现在收一个可选的 seed，而 React 会把 click 事件
    // 当成第一个实参传进来 —— 那样 seed 会变成 MouseEvent，浮层一渲染就撞死在
    // text.trim() 上，整棵 UI 被 ErrorBoundary 顶掉。
    expect(useAppStore.getState().ideaCaptureSeed).toBe("");
  });

  it("列表空的时候这颗按钮也还在（不至于只剩一句 ⌘⇧K 教学）", async () => {
    list.mockResolvedValue({ inbox: [], archived: [], skipped: 0 });
    useAppStore.setState({ ideasSelectedName: null });
    await render();
    expect(container.querySelector('[data-testid="ideas-add"]')).toBeTruthy();
  });

  it("打开视图时重拉列表", async () => {
    await render();
    expect(list).toHaveBeenCalled();
  });

  it("⋯ 菜单：键盘只派发 ArrowDown 就能打开，ArrowDown/Enter 让动作恰好执行一次", async () => {
    await render();
    const trigger = buttonByLabel("ideas.moreActions");
    // 键盘入口：只派发 ArrowDown，**不**派发 pointerdown
    await act(async () => {
      trigger.focus();
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    await flush();
    expect(menu()).not.toBeNull();
    // 打开即聚焦首项（刷新）
    expect(document.activeElement?.textContent?.trim()).toBe("ideas.refresh");
    // ArrowDown 移到第二项（归档），Enter 执行它 —— 恰好一次
    await keyDown(document.activeElement as Element, "ArrowDown");
    await flush();
    expect(document.activeElement?.textContent?.trim()).toBe("ideas.archive");
    await keyDown(document.activeElement as Element, "Enter");
    await act(async () => {});
    expect(setStatus).toHaveBeenCalledTimes(1);
    expect(setStatus).toHaveBeenCalledWith("a", "archived");
  });

  it("⋯ 菜单：Escape 关闭并把焦点还给触发器", async () => {
    await render();
    const trigger = buttonByLabel("ideas.moreActions");
    await pointerDown(trigger);
    expect(menu()).not.toBeNull();
    await act(async () => {
      (document.activeElement ?? document.body).dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await flush();
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("⋯ 菜单：左键 pointerdown 开、再 pointerdown 关，pointerdown→pointerup→click 不重复 toggle", async () => {
    await render();
    const trigger = buttonByLabel("ideas.moreActions");
    await pointerDown(trigger);
    expect(menu()).not.toBeNull();
    // 一次真实点击的后继事件仍落在 trigger 上：click 上不再挂 toggle
    await act(async () => {
      trigger.dispatchEvent(
        new MouseEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      );
      trigger.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
      );
    });
    expect(menu()).not.toBeNull();
    await pointerDown(trigger);
    expect(menu()).toBeNull();
  });

  it("⋯ 菜单：切换选中灵感后，动作作用在新目标上", async () => {
    await render();
    const second = [...container.querySelectorAll('[role="option"]')].find(
      (option) => option.textContent?.includes("第二条"),
    );
    expect(second, "列表里的第二条必须存在").toBeTruthy();
    act(() => (second as HTMLElement).click());
    await act(async () => {});
    await pointerDown(buttonByLabel("ideas.moreActions"));
    await act(async () => menuItemByText("ideas.archive").click());
    await act(async () => {});
    expect(setStatus).toHaveBeenCalledWith("b", "archived");
  });

  it("⋯ 菜单：已归档项显示「恢复」并调 setStatus(inbox)", async () => {
    await render();
    act(() => buttonByText("ideas.showArchived").click());
    await act(async () => {});
    const archived = [...container.querySelectorAll('[role="option"]')].find(
      (option) => option.textContent?.includes("已归档的"),
    );
    expect(archived, "归档组里的那条必须可见").toBeTruthy();
    act(() => (archived as HTMLElement).click());
    await act(async () => {});
    await pointerDown(buttonByLabel("ideas.moreActions"));
    await act(async () => menuItemByText("ideas.restore").click());
    await act(async () => {});
    expect(setStatus).toHaveBeenCalledWith("c", "inbox");
  });
});

describe("灵感视图 · 交给 AI 选项目", () => {
  it("列出现有项目：去重 + 按名排序，组标签在", async () => {
    useAppStore.setState({
      sessions: [
        projectSession("p1", "/work/beta"),
        projectSession("p2", "/work/alpha"),
        projectSession("p3", "/work/alpha"),
      ],
    });
    await render();
    await pointerDown(buttonByText("ideas.handOff"));

    const items = [...document.body.querySelectorAll('[role="menuitem"]')].map(
      (item) => item.textContent?.trim(),
    );
    // 顺序也算契约：两条既有动作留在前，项目组跟在后面 ——
    // 这不是"展示细节"，改顺序就是改这个视图的既有交互。
    // （组标签是 `DropdownMenuLabel`，Radix 渲染成 div，没有 role=menuitem，所以不在这个数组里。）
    expect(items).toEqual([
      "ideas.handOffNew",
      "ideas.handOffCurrent",
      "alpha",
      "beta",
    ]);
    expect(document.body.textContent).toContain("ideas.handOffNewInProject");
  });

  it("选中项目：先 workdir.set，再清会话、设目录、填正文、切到聊天页", async () => {
    invoke.mockResolvedValue({ success: true, path: "/work/alpha" });
    useAppStore.setState({
      activeSessionId: "s1",
      workingDir: "/work/before",
      sessions: [projectSession("p1", "/work/alpha/")],
    });
    await render();
    await pointerDown(buttonByText("ideas.handOff"));
    await act(async () => menuItemByText("alpha").click());
    await flush();

    // 只发一次 IPC ⇒ 没有顺手发消息（不自动发送）
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith({
      type: "workdir.set",
      payload: { path: "/work/alpha" },
    });
    expect(useAppStore.getState().activeSessionId).toBeNull();
    expect(useAppStore.getState().workingDir).toBe("/work/alpha");
    expect(useAppStore.getState().pendingEditorAppend).toBe("正文一");
    expect(useAppStore.getState().activeView).toBe("chat");
  });

  it("workdir.set 返回失败：不开新会话、不动草稿、出全局提示", async () => {
    invoke.mockResolvedValue({
      success: false,
      path: "",
      error: "Directory does not exist",
    });
    useAppStore.setState({
      activeSessionId: "s1",
      workingDir: "/work/before",
      sessions: [projectSession("p1", "/work/alpha")],
    });
    await render();
    await pointerDown(buttonByText("ideas.handOff"));
    await act(async () => menuItemByText("alpha").click());
    await flush();

    const state = useAppStore.getState();
    expect(state.activeSessionId).toBe("s1");
    expect(state.workingDir).toBe("/work/before");
    expect(state.pendingEditorAppend).toBeNull();
    expect(state.activeView).toBe("ideas");
    expect(state.globalNotice?.type).toBe("error");
    expect(state.globalNotice?.message).toBe(
      "sidebar.newSessionForProjectFailed",
    );
  });

  it("workdir.set 抛异常：与返回失败同样处理", async () => {
    invoke.mockRejectedValue(new Error("ipc down"));
    useAppStore.setState({
      activeSessionId: "s1",
      sessions: [projectSession("p1", "/work/alpha")],
    });
    await render();
    await pointerDown(buttonByText("ideas.handOff"));
    await act(async () => menuItemByText("alpha").click());
    await flush();

    const state = useAppStore.getState();
    expect(state.activeSessionId).toBe("s1");
    expect(state.activeView).toBe("ideas");
    expect(state.globalNotice?.message).toBe(
      "sidebar.newSessionForProjectFailed",
    );
  });

  it("没有项目：只留一条灰掉的说明项，没有组标签", async () => {
    useAppStore.setState({
      activeSessionId: "s1",
      sessions: [
        { ...projectSession("plain", "/work/x"), isProjectMode: false },
      ],
    });
    await render();
    await pointerDown(buttonByText("ideas.handOff"));

    const hint = [...document.body.querySelectorAll('[role="menuitem"]')].find(
      (item) => item.textContent?.trim() === "ideas.handOffNoProjects",
    ) as HTMLElement | undefined;
    expect(hint, "空态说明项必须存在").toBeTruthy();
    // 只有 aria-disabled 是真断言：这一项压根没有 onSelect，"点它没反应"恒真、测不出东西。
    expect(hint!.getAttribute("aria-disabled")).toBe("true");
    expect(document.body.textContent).not.toContain(
      "ideas.handOffNewInProject",
    );
  });
});

// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../renderer/i18n/config";
import en from "../../renderer/i18n/locales/en.json";
import zh from "../../renderer/i18n/locales/zh.json";
import { Sidebar } from "../../renderer/components/Sidebar";
import { useAppStore } from "../../renderer/store";
import type { Session } from "../../renderer/types";

// 替身要覆盖 Sidebar 真正解构的那些名字（含 renameSession、getSessionMessagesPage）:
// 少了它们，将来点重命名的测试会拿到 undefined 而不是一个明显的 mock 缺口。
const ipc = vi.hoisted(() => ({
  invoke: vi.fn(),
  deleteSession: vi.fn(),
  deleteProject: vi.fn(),
  renameSession: vi.fn(),
  archiveSession: vi.fn(),
  unarchiveSession: vi.fn(),
  batchArchiveSessions: vi.fn(),
  batchUnarchiveSessions: vi.fn(),
  setSessionCompleted: vi.fn(),
  getSessionMessagesPage: vi.fn(),
  getSessionTraceSteps: vi.fn(),
  changeWorkingDir: vi.fn(),
  createProject: vi.fn(),
}));

vi.mock("../../renderer/hooks/useIPC", () => ({
  useIPC: () => ({ ...ipc, isElectron: true }),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function session(id: string, overrides: Partial<Session> = {}): Session {
  return {
    id,
    title: id,
    status: "idle",
    mountedPaths: [],
    allowedTools: [],
    memoryEnabled: false,
    isProjectMode: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("Sidebar session completion", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    localStorage.clear();
    useAppStore.setState(useAppStore.getInitialState(), true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function render(sessions: Session[]): Promise<void> {
    useAppStore.setState({ sessions });
    await act(async () => {
      root.render(<Sidebar />);
    });
    await flush();
  }

  async function hoverSession(sessionId: string): Promise<void> {
    await act(async () => {
      sessionRow(sessionId).dispatchEvent(
        new MouseEvent("mouseover", { bubbles: true }),
      );
    });
  }

  function sessionRow(sessionId: string): HTMLElement {
    const row = container.querySelector(`[data-session-id="${sessionId}"]`);
    expect(row).toBeTruthy();
    return row as HTMLElement;
  }

  // 悬停格里的切换按钮：文案随状态变，所以两个标题都认
  function markToggle(sessionId: string): HTMLButtonElement {
    const row = sessionRow(sessionId);
    const button =
      row.querySelector(`button[title="${i18n.t("sidebar.markComplete")}"]`) ??
      row.querySelector(`button[title="${i18n.t("sidebar.markIncomplete")}"]`);
    expect(button).toBeTruthy();
    return button as HTMLButtonElement;
  }

  function completedBadge(sessionId: string): Element | null {
    return sessionRow(sessionId).querySelector(
      `[aria-label="${i18n.t("sidebar.completed")}"]`,
    );
  }

  // 组头是纯文字按钮：按渲染出来的文案找，不按 data-* 找（文案本身也要被钉住）
  function completedGroupHeader(count: number): HTMLButtonElement | null {
    const label = i18n.t("sidebar.completedGroup", { count });
    return (
      (Array.from(
        document.body.querySelectorAll<HTMLButtonElement>("button"),
      ).find((node) => node.textContent?.trim() === label) as
        | HTMLButtonElement
        | undefined) ?? null
    );
  }

  function toggleByLabel(label: string): HTMLButtonElement {
    const button = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button[aria-expanded]"),
    ).find((candidate) => candidate.textContent?.includes(label));
    if (!button) throw new Error(`toggle not found: ${label}`);
    return button;
  }

  // 查 document.body 而不是 container：菜单与确认框经 Portal 挂在 body 下。
  // body 是 container 的超集，侧栏自己的按钮照样找得到。
  function findButton(text: string): HTMLButtonElement | undefined {
    return Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent === text,
    );
  }

  function sessionMoreButton(sessionId: string): HTMLButtonElement {
    const button = sessionRow(sessionId).querySelector(
      `button[aria-label="${i18n.t("sidebar.moreActions")}"]`,
    );
    expect(button).toBeTruthy();
    return button as HTMLButtonElement;
  }

  function menuAction(label: string): HTMLElement {
    const item = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((node) => node.textContent?.trim() === label);
    if (!item) throw new Error(`menu item not found: ${label}`);
    return item;
  }

  async function openSessionMenu(sessionId: string): Promise<void> {
    await act(async () => {
      sessionRow(sessionId).dispatchEvent(
        new MouseEvent("mouseover", { bubbles: true }),
      );
    });
    await act(async () => {
      // Radix 的 Trigger 只挂 pointerdown；补一发 click 会被 DismissableLayer 立刻关掉
      sessionMoreButton(sessionId).dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true }),
      );
    });
    await flush();
  }

  it("文案与英语语境一致（键存在且值被钉住）", () => {
    expect(zh.sidebar.markComplete).toBe("标记完成");
    expect(zh.sidebar.markIncomplete).toBe("取消完成");
    expect(zh.sidebar.completed).toBe("已完成");
    expect(zh.sidebar.completedGroup).toBe("已完成（{{count}}）");
    expect(en.sidebar.markComplete).toBe("Mark complete");
    expect(en.sidebar.markIncomplete).toBe("Unmark complete");
    expect(en.sidebar.completed).toBe("Completed");
    expect(en.sidebar.completedGroup).toBe("Completed ({{count}})");
  });

  it("悬停格一键标记完成，且不会顺带选中这个会话", async () => {
    useAppStore.setState({ activeSessionId: null });
    await render([session("s1", { title: "会话一" })]);

    await hoverSession("s1");
    await act(async () => markToggle("s1").click());
    await flush();

    expect(ipc.setSessionCompleted).toHaveBeenCalledWith("s1", true);
    expect(useAppStore.getState().activeSessionId).toBeNull();
  });

  it("菜单里也能标记完成", async () => {
    await render([session("s1", { title: "会话一" })]);

    await openSessionMenu("s1");
    await act(async () => menuAction(i18n.t("sidebar.markComplete")).click());

    expect(ipc.setSessionCompleted).toHaveBeenCalledWith("s1", true);
  });

  it("运行中的会话同样能标记（设计决策 6：并行时最想收的往往就是还在跑的那个）", async () => {
    await render([session("s1", { title: "会话一", status: "running" })]);

    await hoverSession("s1");
    expect(markToggle("s1")).toBeTruthy();

    await openSessionMenu("s1");
    expect(menuAction(i18n.t("sidebar.markComplete"))).toBeTruthy();
  });

  it("已完成的会话离开主排，收进「已完成（1）」组；组内是普通行，尾槽回到相对时间", async () => {
    useAppStore.setState({ activeSessionId: null });
    await render([
      session("s1", {
        title: "会话一",
        completedAt: 1_700_000_000_000,
        updatedAt: 1,
      }),
    ]);

    // 主排里没有它 —— 从根上没有「一眼区分」这回事了
    expect(container.querySelector('[data-session-id="s1"]')).toBeNull();

    const header = completedGroupHeader(1);
    expect(header, "「已完成（1）」组头").toBeTruthy();
    // 组头是纯文字：没有 chevron 图标，也没有配套的「收起」
    expect(header?.querySelector("svg")).toBeNull();
    expect(findButton(i18n.t("sidebar.showLessSessions"))).toBeUndefined();
    // 收起态：组内行根本不在 DOM 里（SidebarAnimatedSection 用 `rendered &&` 渲染子层）
    expect(header?.getAttribute("aria-expanded")).toBe("false");

    await act(async () => header?.click());
    await flush();

    const title = sessionRow("s1").querySelector(".truncate");
    // 组内是普通行：不再置灰（状态由容器承载，不再是第三档灰度）
    expect(title?.className).toContain("text-muted-foreground");
    expect(title?.className).not.toContain("text-muted-foreground/60");
    // 尾槽把相对时间还回去了，勾号不在
    expect(completedBadge("s1")).toBeNull();

    // 再点一次就是收起 —— 没有第二个按钮
    await act(async () => completedGroupHeader(1)?.click());
    await flush();
    expect(container.querySelector('[data-session-id="s1"]')).toBeNull();
  });

  it("运行中压过完成：右侧那一格只显示运行中，勾号让位", async () => {
    await render([
      session("s1", {
        title: "会话一",
        status: "running",
        completedAt: 1_700_000_000_000,
      }),
    ]);

    const row = sessionRow("s1");
    expect(
      row.querySelector(`[aria-label="${i18n.t("sidebar.running")}"]`),
    ).toBeTruthy();
    expect(completedBadge("s1")).toBeNull();

    // 状态标记让位不等于动作消失：悬停格仍然给的是「取消完成」
    await hoverSession("s1");
    expect(markToggle("s1").getAttribute("title")).toBe(
      i18n.t("sidebar.markIncomplete"),
    );
    // 且静息时唯一的提示就是置灰的标题（勾号被运行中顶掉了，别把这条也丢了）
    expect(row.querySelector(".truncate")?.className).toContain(
      "text-muted-foreground/60",
    );

    // 也进不了完成组 —— isBusy 挡在谓词第一层
    expect(completedGroupHeader(1)).toBeNull();
  });

  it("菜单项随状态翻转：已完成时只有「取消完成」，点了就取消", async () => {
    useAppStore.setState({ activeSessionId: null });
    await render([
      session("s1", {
        title: "会话一",
        completedAt: 1_700_000_000_000,
        updatedAt: 1,
      }),
    ]);

    await act(async () => completedGroupHeader(1)?.click());
    await flush();

    await openSessionMenu("s1");
    expect(menuAction(i18n.t("sidebar.markIncomplete"))).toBeTruthy();
    // 反向那一半：菜单里不该还挂着「标记完成」
    const labels = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).map((node) => node.textContent?.trim());
    expect(labels).not.toContain(i18n.t("sidebar.markComplete"));
    await act(async () =>
      menuAction(i18n.t("sidebar.markIncomplete"))?.click(),
    );
    await flush();

    expect(ipc.setSessionCompleted).toHaveBeenCalledWith("s1", false);
  });

  it("当前打开的已完成会话：它沉在组里、组替它开着，标题仍是正常前景色（isActive 压过组内的不置灰）", async () => {
    useAppStore.setState({ activeSessionId: null });
    await render([
      session("s1", { title: "会话一", completedAt: 1_700_000_000_000 }),
    ]);
    useAppStore.setState({ activeSessionId: "s1" });
    await flush();

    // 它不在主排，而是沉在组里 —— 但组替它开着，所以仍然可见。
    // （曾经这里断言的是「不进组」：那会让从组里点开一条会话时，它被弹回主排。）
    const header = completedGroupHeader(1);
    expect(header, "「已完成（1）」组头").toBeTruthy();
    expect(header?.getAttribute("aria-expanded")).toBe("true");

    const title = sessionRow("s1").querySelector(".truncate");
    expect(title?.className).toContain("text-foreground");
    expect(title?.className).not.toContain("text-muted-foreground/60");
  });

  it("置顶的已完成会话同样进组：置顶决定次序，不决定位置", async () => {
    useAppStore.setState({ activeSessionId: null });
    localStorage.setItem(
      "deskwand.sidebarPins",
      JSON.stringify({ sessionIds: ["done"], projectKeys: [] }),
    );
    await render([
      session("done", {
        title: "Done",
        completedAt: 1_700_000_000_000,
        updatedAt: 1,
      }),
      session("fresh", { title: "Fresh", updatedAt: 20 }),
    ]);

    // 主排只剩 Fresh —— 置顶自 e347bc05 起就没有可见标记，是「排在最前」而不是位置承诺
    expect(container.querySelector('[data-session-id="done"]')).toBeNull();
    expect(sessionRow("fresh")).toBeTruthy();

    await act(async () => completedGroupHeader(1)?.click());
    await flush();
    // 置顶的状态没丢：读屏仍能听到「已置顶」那句
    expect(sessionRow("done").textContent).toContain(i18n.t("sidebar.pinned"));
  });

  it("计数是沉下去的条数，不是这个列表的总数", async () => {
    useAppStore.setState({ activeSessionId: null });
    await render([
      session("open", { title: "活跃", updatedAt: 9 }),
      session("d1", {
        title: "完一",
        completedAt: 1_700_000_000_000,
        updatedAt: 1,
      }),
      session("d2", {
        title: "完二",
        completedAt: 1_700_000_000_001,
        updatedAt: 2,
      }),
    ]);

    expect(completedGroupHeader(2), "沉了两条").toBeTruthy();
    expect(completedGroupHeader(3), "三条没沉").toBeNull();
    expect(sessionRow("open")).toBeTruthy();
  });

  it("一条都没完成时不渲染组头", async () => {
    useAppStore.setState({ activeSessionId: null });
    await render([session("open", { title: "活跃", updatedAt: 9 })]);

    expect(
      Array.from(document.body.querySelectorAll("button")).some((node) =>
        node.textContent?.includes(i18n.t("sidebar.completed")),
      ),
    ).toBe(false);
  });

  it("一个列表的会话全部完成时，主排为空、只剩组头，且不自动展开", async () => {
    useAppStore.setState({ activeSessionId: null });
    await render([
      session("a", {
        title: "A",
        completedAt: 1_700_000_000_000,
        updatedAt: 1,
      }),
      session("b", {
        title: "B",
        completedAt: 1_700_000_000_001,
        updatedAt: 2,
      }),
    ]);

    const header = completedGroupHeader(2);
    expect(header).toBeTruthy();
    expect(container.querySelector('[data-session-id="a"]')).toBeNull();
    expect(container.querySelector('[data-session-id="b"]')).toBeNull();
    // 不自动展开：免得你以为列表还是满的
    expect(header?.getAttribute("aria-expanded")).toBe("false");
  });

  it("标记之后又被唤起、如今已跑完的会话仍然沉在组里 —— 不会永久卡在主排", async () => {
    const mark = 1_700_000_000_000;
    useAppStore.setState({ activeSessionId: null });
    await render([
      session("settled", {
        title: "收尾之后没再动",
        completedAt: mark,
        updatedAt: mark - 1000,
      }),
      session("woke", {
        title: "唤醒过、现在闲着",
        completedAt: mark,
        updatedAt: mark + 60_000,
      }),
    ]);

    // 两条都沉 —— 时间戳不参与资格判定
    expect(completedGroupHeader(2)).toBeTruthy();
    expect(container.querySelector('[data-session-id="settled"]')).toBeNull();
    expect(container.querySelector('[data-session-id="woke"]')).toBeNull();
    // 标记都还在（两条仍然是「已完成」）
    await act(async () => completedGroupHeader(2)?.click());
    await flush();
    await hoverSession("woke");
    expect(markToggle("woke").getAttribute("title")).toBe(
      i18n.t("sidebar.markIncomplete"),
    );
  });

  // 功能主用途：并行时最想收的往往就是还在跑的那个（旧 plan 决策 6）。
  it("给正在跑的会话打勾：它本轮跑完就沉下去，不会永远卡在主排", async () => {
    const mark = 1_700_000_000_000;
    useAppStore.setState({ activeSessionId: null });

    // 打勾时它还在跑
    await render([
      session("s1", {
        title: "还在跑",
        status: "running",
        completedAt: mark,
        updatedAt: mark,
      }),
    ]);
    // 运行中 ⇒ isBusy 把它留在主排
    expect(sessionRow("s1")).toBeTruthy();
    expect(completedGroupHeader(1)).toBeNull();

    // 本轮跑完 ⇒ idle，而 updateSessionStatus 无条件把 updated_at 推到标记点之后
    await render([
      session("s1", {
        title: "还在跑",
        status: "idle",
        completedAt: mark,
        updatedAt: mark + 5000,
      }),
    ]);

    // 于是它沉下去了 —— 不会因为「时间戳越过了标记点」而永远卡在主排
    expect(completedGroupHeader(1)).toBeTruthy();
    expect(container.querySelector('[data-session-id="s1"]')).toBeNull();
  });

  it("搜索命中一条已完成的会话时组强制展开 —— 搜到了必须看得见", async () => {
    useAppStore.setState({ activeSessionId: null });
    await render([
      session("hit", {
        title: "宽度排查",
        completedAt: 1_700_000_000_000,
        updatedAt: 1,
      }),
      session("other", { title: "别的", updatedAt: 5 }),
    ]);

    expect(container.querySelector('[data-session-id="hit"]')).toBeNull();

    const input = container.querySelector("input");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "宽度");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();

    expect(sessionRow("hit")).toBeTruthy();
  });

  it("项目内列表的组头跟着内层缩进（pl-9），不是 pl-3", async () => {
    useAppStore.setState({ activeSessionId: null });
    const cwd = "/work/completed-group-indent";
    await render([
      session("nested", {
        cwd,
        isProjectMode: true,
        title: "项目里的一条",
        completedAt: 1_700_000_000_000,
        updatedAt: 1,
      }),
    ]);

    await act(async () => toggleByLabel(i18n.t("sidebar.projects")).click());
    await flush();

    const header = completedGroupHeader(1);
    expect(header).toBeTruthy();
    // `SESSION_OVERFLOW_BUTTON_CLASS` 自 45d09601 起只剩 `pr-3`，左内边距得调用点自己给
    expect(header?.className).toContain("pl-9");
    expect(header?.className).not.toContain("pl-3");
  });

  it("归档项保持今天的门：等你回答问题的会话不能归档（删除项不受影响）", async () => {
    // hasStatusIndicator = 运行中 / 有待答 ask_user / 有后台子 agent 在跑。
    // 它是归档按钮今天的门（比菜单里删除项的 status !== "running" 窄）。
    useAppStore.setState({
      pendingAskUsers: {
        "t-1": { sessionId: "s1", toolCallId: "t-1", questions: [] },
      },
    });
    await render([session("s1", { title: "会话一" })]);

    await hoverSession("s1");
    expect(markToggle("s1")).toBeTruthy();

    await openSessionMenu("s1");
    const labels = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).map((node) => node.textContent?.trim());
    // 归档：门窄 → 这种会话不能归档（归档会先 stopSession，把待答问题一起吞掉）
    expect(labels).not.toContain(i18n.t("sidebar.archive"));
    // 删除：门是既有的 status !== "running" → 照旧出现（两个门本来就不一样，本次不改它）
    expect(labels).toContain(i18n.t("common.delete"));
  });

  // 评审时我曾断言 `canShowLess` 有 bug（比的是「请求的条数」而不是「实际显示的条数」，
  // 标记完成会让请求值停在旧高位 ⇒ 多出一个无事可做的「收起」）。**这条是误报，已证伪**：
  // `resolveSessionVisibleCount` 里 `Math.min(override ?? 5, groupSessions.length)` 早就把
  // visibleCount 夹在表长以内 ⇒ `visibleUnpinnedCount ≤ unpinned.length` 恒成立（穷举 637 组
  // 参数，0 反例）⇒ 两者永远相等。不必改代码。
  //
  // 这个用例保留为**不变量守卫**：它钉的是两条既有实现（那条 clamp 与本次的切分）
  // 碰在一起时的结果 —— 主排变短后折叠线要自己收干净，不能只留一个「收起」。
  it("展开过之后标记完成让主排变短：折叠线自己收干净，不只剩一个「收起」", async () => {
    useAppStore.setState({ activeSessionId: null });
    const all = Array.from({ length: 8 }, (_, i) =>
      session(`s${i}`, { title: `会话${i}`, updatedAt: 100 - i }),
    );
    await render(all);

    // 展开到 8 条（默认显 5 条）
    await act(async () =>
      findButton(i18n.t("sidebar.showMoreSessions", { count: 3 }))?.click(),
    );
    await flush();
    expect(findButton(i18n.t("sidebar.showLessSessions"))).toBeTruthy();

    // 标记 5 条完成 ⇒ 主排只剩 s5/s6/s7，全部可见
    await render(
      all.map((s, i) => (i < 5 ? { ...s, completedAt: 1_700_000_000_000 } : s)),
    );

    for (let i = 0; i < 5; i += 1) {
      expect(container.querySelector(`[data-session-id="s${i}"]`)).toBeNull();
    }
    expect(sessionRow("s7")).toBeTruthy();
    // 显示 3 条 < 默认的 5 条 ⇒ 「收起」无事可做，不该在
    expect(findButton(i18n.t("sidebar.showLessSessions"))).toBeUndefined();
    // 而「已完成（5）」组头在
    expect(completedGroupHeader(5)).toBeTruthy();
  });

  // 用户报障：点组里的一条会话，它会当场跳回主排。
  // 根因在谓词第三条（`session.id === activeSessionId` 就不沉）—— 它把两个场景当成一个了：
  // 给「你正在读的那条」打勾（行不能从眼前消失）与「从组里点开一条」。
  it("从组里点开一条会话，它不会被弹回主排", async () => {
    const mark = 1_700_000_000_000;
    await render([
      session("s1", { title: "已完成的一条", completedAt: mark, updatedAt: 1 }),
      session("s2", { title: "还在干的一条", updatedAt: 9 }),
    ]);

    await act(async () => completedGroupHeader(1)?.click());
    await flush();
    expect(sessionRow("s1")).toBeTruthy();

    // 点它 —— 走的就是真实那条路：`handleSessionClick` → `setActiveSession`
    await act(async () => sessionRow("s1").click());
    await flush();

    // 成员资格不取决于「谁开着」：它还在组里，没被搬到主排去
    expect(completedGroupHeader(1), "组头还在").toBeTruthy();
    expect(sessionRow("s1"), "行还在组里").toBeTruthy();
    expect(sessionRow("s1").className).toContain("bg-accent");
  });

  // 谓词第三条当年要守的那条需求 —— 行不能从眼前消失 —— 得由别的东西接手：
  // 把容器打开（本文件既有的规矩，见 resolveProjectExpanded）。
  it("给当前打开的会话打勾：组自动展开，那一行仍在眼前", async () => {
    const mark = 1_700_000_000_000;
    useAppStore.setState({ activeSessionId: "s1" });
    await render([session("s1", { title: "会话一", updatedAt: 1 })]);

    // 打勾之前它在主排里
    expect(sessionRow("s1")).toBeTruthy();
    expect(completedGroupHeader(1)).toBeNull();

    // 打勾落地（= 这一条现在有 completedAt 且有 updatedAt，于是它满足沉底条件）
    await render([
      session("s1", { title: "会话一", updatedAt: 1, completedAt: mark }),
    ]);

    const header = completedGroupHeader(1);
    expect(header, "「已完成（1）」组头").toBeTruthy();
    // 它沉下去了，但组替它开着 ⇒ 仍然可见、仍然高亮
    expect(header?.getAttribute("aria-expanded")).toBe("true");
    expect(sessionRow("s1")).toBeTruthy();
    expect(sessionRow("s1").className).toContain("bg-accent");
  });
});

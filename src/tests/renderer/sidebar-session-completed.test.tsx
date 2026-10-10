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
    expect(en.sidebar.markComplete).toBe("Mark complete");
    expect(en.sidebar.markIncomplete).toBe("Unmark complete");
    expect(en.sidebar.completed).toBe("Completed");
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

  it("已完成的会话：右侧那一格只显示勾号（顶替相对时间），且勾号不可点", async () => {
    await render([
      session("s1", { title: "会话一", completedAt: 1_700_000_000_000 }),
    ]);

    const badge = completedBadge("s1");
    expect(badge).toBeTruthy();
    // 状态标记不是按钮：动作已经有悬停格与菜单两处入口
    expect(badge?.tagName).not.toBe("BUTTON");
    // 运行中 / 完成 / 时间 是这条链：那一格只装一件东西
    // （并排会撑爆 72px 的盒子）
    expect(badge?.parentElement?.children).toHaveLength(1);
    // 比上一条更强的一刀：那一格只有图标、没有任何文本 —— 相对时间没被顺带渲染
    expect(badge?.parentElement?.textContent?.trim()).toBe("");
    // 颜色：中性，且**不得**是成功色（绿色在本仓是“成功/连通正常”的语义）
    expect(badge?.className).toContain("text-muted-foreground");
    expect(badge?.className).not.toContain("text-success");
    // 右缘对齐靠 justify-end（这一列的既有规矩，见 1786 那条测试的注释）
    expect(badge?.className).toContain("justify-end");

    await hoverSession("s1");
    expect(markToggle("s1").getAttribute("title")).toBe(
      i18n.t("sidebar.markIncomplete"),
    );
    // 切换键要把状态也暴露给读屏（文案说明动作，aria-pressed 说明当前状态）
    expect(markToggle("s1").getAttribute("aria-pressed")).toBe("true");

    await act(async () => markToggle("s1").click());
    await flush();
    expect(ipc.setSessionCompleted).toHaveBeenCalledWith("s1", false);
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
  });

  it("菜单项随状态翻转：已完成时只有「取消完成」，点了就取消", async () => {
    await render([
      session("s1", { title: "会话一", completedAt: 1_700_000_000_000 }),
    ]);

    await openSessionMenu("s1");
    expect(menuAction(i18n.t("sidebar.markIncomplete"))).toBeTruthy();
    // 反向那一半：菜单里不该还挂着「标记完成」
    const labels = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).map((node) => node.textContent?.trim());
    expect(labels).not.toContain(i18n.t("sidebar.markComplete"));
    await act(async () => menuAction(i18n.t("sidebar.markIncomplete")).click());
    await flush();

    expect(ipc.setSessionCompleted).toHaveBeenCalledWith("s1", false);
  });

  it("当前打开的已完成会话：标题仍是正常前景色（isActive 优先于置灰）", async () => {
    await render([
      session("s1", { title: "会话一", completedAt: 1_700_000_000_000 }),
    ]);
    useAppStore.setState({ activeSessionId: "s1" });
    await flush();

    const title = sessionRow("s1").querySelector(".truncate");
    expect(title?.className).toContain("text-foreground");
    expect(title?.className).not.toContain("text-muted-foreground/60");
  });

  it("置顶的已完成会话：尾槽显示勾号，置顶状态改由顺序 + sr-only 承担", async () => {
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

    const row = sessionRow("done");
    expect(completedBadge("done")).toBeTruthy();
    // 上游 e347bc05 起，置顶不再有看得见的标记（视觉上空着、靠排在最前 + sr-only 说状态），
    // 所以这里不是"图钉让位给勾号"，而是"这一格只剩勾号"。
    // 置顶的状态没有丢：读屏仍能听到「已置顶」那句。
    expect(row.textContent).toContain(i18n.t("sidebar.pinned"));
    // 位置仍由置顶决定（这一半说不明"下沉"，下沉由 Step 5 那条排序守卫钉）
    expect((container.textContent ?? "").indexOf("Done")).toBeLessThan(
      (container.textContent ?? "").indexOf("Fresh"),
    );
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
});

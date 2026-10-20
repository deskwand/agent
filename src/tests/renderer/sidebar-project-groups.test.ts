// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../renderer/i18n/config";
import { Sidebar } from "../../renderer/components/Sidebar";
import { useAppStore } from "../../renderer/store";
import type { AskUserRequest, Session } from "../../renderer/types";
import { cleanupDialogs } from "../dialog-test-helpers";

const ipc = vi.hoisted(() => ({
  invoke: vi.fn(),
  deleteSession: vi.fn(),
  deleteProject: vi.fn(),
  archiveSession: vi.fn(),
  getSessionMessages: vi.fn(),
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

describe("Sidebar project groups", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    localStorage.clear();
    useAppStore.setState(useAppStore.getInitialState(), true);
    container = document.createElement("div");
    document.body.innerHTML = "";
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    cleanupDialogs();
  });

  async function render(
    sessions: Session[],
    options: {
      expandProjects?: boolean;
      pendingAskUsers?: Record<string, AskUserRequest>;
    } = {},
  ): Promise<void> {
    // 「项目」默认收起后内层项目行不渲染；本文件测的是内层行为，
    // 所以渲染前把外层折叠行播种为展开。只有 3 个「存储值回退」用例需要
    // 保留脏存储，它们传 { expandProjects: false } 并在渲染后点击展开。
    if (options.expandProjects !== false) seedProjectsExpanded();
    await act(async () => {
      useAppStore.setState({
        sessions,
        // 每条用例都显式重置：反复 render 的用例不会带上一条的待答提问
        pendingAskUsers: options.pendingAskUsers ?? {},
      });
      root.render(React.createElement(Sidebar, { width: 280 }));
    });
    await flush();
  }

  function seedProjectsExpanded(): void {
    let stored: Record<string, unknown> = {};
    try {
      const raw = localStorage.getItem("deskwand.sidebarGroupExpansion");
      const parsed: unknown = raw ? JSON.parse(raw) : {};
      if (parsed && typeof parsed === "object") {
        stored = parsed as Record<string, unknown>;
      }
    } catch {
      // 存储是脏值时从空开始：与 Sidebar.loadGroupExpansion 的回退一致
      stored = {};
    }
    const merged: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(stored)) {
      if (typeof value === "boolean") merged[key] = value;
    }
    merged.__projects__ = true;
    try {
      localStorage.setItem(
        "deskwand.sidebarGroupExpansion",
        JSON.stringify(merged),
      );
    } catch {
      // 存储不可用时保持内存态：与 Sidebar.saveGroupExpansion 一致
    }
  }

  it("keeps session group headers on the horizontal inset", async () => {
    await render([]);

    const sessionsButton = Array.from(
      container.querySelectorAll("button[aria-expanded]"),
    ).find((button) => button.textContent?.includes(i18n.t("sidebar.recents")));

    expect(sessionsButton).toBeTruthy();
    expect(sessionsButton?.className).toContain("px-3");
    expect(sessionsButton?.className).toContain("gap-2");
    expect(sessionsButton?.querySelector("span.relative")?.className).toContain(
      "h-4",
    );
    expect(sessionsButton?.querySelector("span.relative")?.className).toContain(
      "w-4",
    );
    expect(
      sessionsButton?.querySelector("svg")?.getAttribute("style"),
    ).toContain("translate(-50%, -50%)");
  });

  it("keeps project group labels on the same icon spacing", async () => {
    const projectCwd = "/tmp/sidebar-alignment-project";
    await render([
      session("project-session", {
        cwd: projectCwd,
        isProjectMode: true,
      }),
    ]);

    const toggle = projectToggle(projectCwd);
    expect(toggle.className).toContain("gap-2");
    expect(toggle.querySelector("span.relative")?.className).toContain("h-4");
    expect(toggle.querySelector("span.relative")?.className).toContain("w-4");
    expect(toggle.querySelector("svg")?.getAttribute("style")).toContain(
      "translate(-50%, -50%)",
    );
  });

  function projectHeader(cwd: string): Element | undefined {
    return Array.from(container.querySelectorAll("[title]")).find(
      (element) => element.getAttribute("title") === cwd,
    );
  }

  function projectAction(cwd: string): HTMLButtonElement {
    const header = projectHeader(cwd);
    expect(header).toBeTruthy();
    const button = Array.from(header?.querySelectorAll("button") ?? []).find(
      (candidate) =>
        candidate.getAttribute("aria-label") ===
        i18n.t("sidebar.newSessionForProject"),
    );
    expect(button).toBeTruthy();
    return button as HTMLButtonElement;
  }

  function projectSection(cwd: string): HTMLElement {
    const header = projectHeader(cwd);
    expect(header).toBeTruthy();
    const section = header?.closest("section");
    expect(section).toBeTruthy();
    return section as HTMLElement;
  }

  function projectToggle(cwd: string): HTMLButtonElement {
    const button = projectSection(cwd).querySelector("button[aria-expanded]");
    expect(button).toBeTruthy();
    return button as HTMLButtonElement;
  }

  function ordinaryToggle(): HTMLButtonElement {
    const button = Array.from(
      container.querySelectorAll("button[aria-expanded]"),
    ).find((candidate) =>
      candidate.textContent?.includes(i18n.t("sidebar.recents")),
    );
    expect(button).toBeTruthy();
    return button as HTMLButtonElement;
  }

  function sessionRow(sessionId: string): HTMLElement {
    const row = container.querySelector(`[data-session-id="${sessionId}"]`);
    expect(row).toBeTruthy();
    return row as HTMLElement;
  }

  function pinButtonWithin(element: Element): HTMLButtonElement {
    const button = element.querySelector(
      `button[aria-label="${i18n.t("sidebar.pin")}"], button[aria-label="${i18n.t("sidebar.unpin")}"]`,
    );
    expect(button).toBeTruthy();
    return button as HTMLButtonElement;
  }

  function findActionRow(button: HTMLElement): HTMLElement | null {
    let el = button.parentElement;
    while (el && el.querySelectorAll("button").length < 2)
      el = el.parentElement;
    return el;
  }

  function sessionMoreButton(sessionId: string): HTMLButtonElement {
    const button = sessionRow(sessionId).querySelector(
      `button[aria-label="${i18n.t("sidebar.moreActions")}"]`,
    );
    expect(button).toBeTruthy();
    return button as HTMLButtonElement;
  }

  function findSessionMenu(): HTMLElement | null {
    return document.body.querySelector('[role="menu"]');
  }

  function sessionMenu(): HTMLElement {
    const menu = findSessionMenu();
    expect(menu).toBeTruthy();
    return menu as HTMLElement;
  }

  function findMenuAction(label: string): HTMLElement | undefined {
    // ⚠️ Radix 的 DropdownMenuItem 渲染成 **div[role="menuitem"]**（不是 button ✗）
    // → 两者都收，这样对迁移前后都成立 ✓（计划 10 的 Step 1 ✓）。
    return Array.from(
      sessionMenu().querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((item) => item.textContent?.trim() === label);
  }

  function menuAction(label: string): HTMLElement {
    const item = findMenuAction(label);
    expect(item).toBeTruthy();
    return item as HTMLElement;
  }

  async function hoverSession(sessionId: string): Promise<void> {
    await act(async () => {
      sessionRow(sessionId).dispatchEvent(
        new MouseEvent("mouseover", { bubbles: true }),
      );
    });
  }

  async function openSessionMenu(sessionId: string): Promise<void> {
    await hoverSession(sessionId);
    await act(async () => {
      const more = sessionMoreButton(sessionId);
      // ⚠️ 先只发 **pointerdown**（Radix 的 Trigger 只挂它 ✓）。**不要顺手再补一发 click** ✗——
      // Radix 打开后那一发 click 落在**内容之外** ✗ → 它自己的 DismissableLayer 会把菜单
      // 立刻关掉 ✓✓（本仓 `deferPointerDownOutside: true` ✓）。实测定位这个用了六轮 ✓。
      more.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      );
    });
    // 旧的只手写触发器只认 **click** ✓ —— 若 pointerdown 没打开菜单，再补一发 ✓。
    // 条件式是为了**同时对迁移前后成立** ✓（计划 10 的 Step 1 ✓）。
    if (!findSessionMenu()) {
      await act(async () => {
        sessionMoreButton(sessionId).click();
      });
    }
    expect(sessionMenu()).toBeTruthy();
  }

  function findButton(text: string): HTMLButtonElement | undefined {
    // 查 document.body 而不是 container：删除确认框迁到 ConfirmDialog 后
    // 经 Portal 挂在 body 下。body 是 container 的超集，侧栏自己的按钮照样找得到。
    return Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent === text,
    );
  }

  function makeProjectSessions(
    projectName: string,
    count: number,
    updatedAt: number,
  ): Session[] {
    return Array.from({ length: count }, (_, index) =>
      session(`${projectName}-${index + 1}`, {
        title: `${projectName} chat ${index + 1}`,
        isProjectMode: true,
        cwd: `/work/${projectName}`,
        updatedAt: updatedAt - index,
      }),
    );
  }

  it("renders ordinary sessions before project groups", async () => {
    await render([
      session("ordinary", { title: "Ordinary", updatedAt: 30 }),
      session("project", {
        title: "Project chat",
        isProjectMode: true,
        cwd: "/work/deskwand",
        updatedAt: 20,
      }),
    ]);

    const text = container.textContent ?? "";
    expect(text.indexOf("Ordinary")).toBeLessThan(text.indexOf("deskwand"));
    expect(text.indexOf("deskwand")).toBeLessThan(text.indexOf("Project chat"));
    expect(container.textContent).not.toContain(i18n.t("sidebar.emptyTitle"));
  });

  it("fully collapses and expands ordinary sessions", async () => {
    await render([session("ordinary", { title: "Ordinary chat" })]);

    expect(ordinaryToggle().getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("Ordinary chat");

    await act(async () => ordinaryToggle().click());
    expect(ordinaryToggle().getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain("Ordinary chat");

    await act(async () => ordinaryToggle().click());
    expect(container.textContent).toContain("Ordinary chat");
  });

  it("keeps existing state icons when section labels are muted", async () => {
    await render([
      session("ordinary", { title: "Ordinary chat" }),
      session("project", {
        title: "Project chat",
        isProjectMode: true,
        cwd: "/work/deskwand",
      }),
    ]);

    const ordinary = ordinaryToggle();
    // 2026-10-11：外层分组标题改为 text-muted-foreground（弱化），
    // 图标本身的种类与颜色不变。
    expect(ordinary.classList.contains("text-muted-foreground")).toBe(true);
    const collapsedSessionsIcon = ordinary.querySelector(
      ".lucide-message-square",
    ) as SVGElement;
    const expandedSessionsIcon = ordinary.querySelector(
      ".lucide-message-square-text",
    ) as SVGElement;
    expect(
      collapsedSessionsIcon.classList.contains("text-muted-foreground"),
    ).toBe(false);
    // 「最近」默认展开：展开态图标可见、收起态图标隐藏
    expect(expandedSessionsIcon.style.opacity).toBe("1");
    expect(collapsedSessionsIcon.style.opacity).toBe("0");
    expect(ordinary.querySelector(".lucide-chevron-down")).toBeNull();
    expect(
      sessionRow("ordinary").querySelector(
        ".lucide-message-square, .lucide-message-square-text, .lucide-folder, .lucide-folder-open",
      ),
    ).toBeNull();

    await act(async () => ordinary.click());
    expect(collapsedSessionsIcon.style.opacity).toBe("1");
    expect(expandedSessionsIcon.style.opacity).toBe("0");

    const project = projectToggle("/work/deskwand");
    expect(project.classList.contains("text-foreground")).toBe(true);
    const collapsedProjectIcon = project.querySelector(
      ".lucide-folder",
    ) as SVGElement;
    const expandedProjectIcon = project.querySelector(
      ".lucide-folder-open",
    ) as SVGElement;
    expect(
      collapsedProjectIcon.classList.contains("text-muted-foreground"),
    ).toBe(false);
    // 项目行的会话计数已删（2026-10-12）—— 这一行内不再有 muted 文本；
    // 本用例关心的图标状态断言在上下两段，原样保留。
    expect(collapsedProjectIcon.style.opacity).toBe("0");
    expect(expandedProjectIcon.style.opacity).toBe("1");
    expect(project.querySelector(".lucide-chevron-down")).toBeNull();

    await act(async () => project.click());
    expect(collapsedProjectIcon.style.opacity).toBe("1");
    expect(expandedProjectIcon.style.opacity).toBe("0");
  });

  it("animates only explicit disclosure and list-size clicks", async () => {
    const animateDescriptor = Object.getOwnPropertyDescriptor(
      Element.prototype,
      "animate",
    );
    const matchMediaDescriptor = Object.getOwnPropertyDescriptor(
      window,
      "matchMedia",
    );
    const animatedTargets: Element[] = [];

    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        media: "(prefers-reduced-motion: reduce)",
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    Object.defineProperty(Element.prototype, "animate", {
      configurable: true,
      value: function (this: Element): Animation {
        animatedTargets.push(this);
        return {
          cancel: vi.fn(),
          oncancel: null,
          onfinish: null,
        } as unknown as Animation;
      },
    });

    try {
      await render(
        Array.from({ length: 7 }, (_, index) =>
          session(`ordinary-${index + 1}`, {
            title: `Ordinary ${index + 1}`,
            updatedAt: 100 - index,
          }),
        ),
      );

      await act(async () => ordinaryToggle().click());
      expect(
        animatedTargets.some((target) => target instanceof SVGElement),
      ).toBe(true);

      animatedTargets.length = 0;
      await act(async () =>
        findButton(i18n.t("sidebar.showMoreSessions", { count: 2 }))?.click(),
      );
      expect(animatedTargets.length).toBeGreaterThan(0);
      expect(
        animatedTargets.some((target) => target instanceof SVGElement),
      ).toBe(false);
    } finally {
      if (animateDescriptor) {
        Object.defineProperty(Element.prototype, "animate", animateDescriptor);
      } else {
        Reflect.deleteProperty(Element.prototype, "animate");
      }
      if (matchMediaDescriptor) {
        Object.defineProperty(window, "matchMedia", matchMediaDescriptor);
      } else {
        Reflect.deleteProperty(window, "matchMedia");
      }
    }
  });

  it("opens ordinary sessions for the active session", async () => {
    useAppStore.setState({ activeSessionId: "ordinary" });
    await render([session("ordinary", { title: "Active ordinary" })]);

    expect(ordinaryToggle().getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("Active ordinary");
  });

  it("renders dense project headers with hover-only actions", async () => {
    await render([
      session("project", {
        isProjectMode: true,
        cwd: "/work/deskwand",
      }),
    ]);

    const header = projectHeader("/work/deskwand");
    expect(header?.className).toContain("group/project");
    expect(header?.querySelector(".lucide-folder-open")).toBeTruthy();

    const action = projectAction("/work/deskwand");
    expect(action.className).toContain("opacity-0");
    expect(action.className).toContain("pointer-events-none");
    expect(action.className).toContain("group-hover/project:opacity-100");
    expect(action.className).toContain(
      "group-hover/project:pointer-events-auto",
    );

    // 会话计数的断言已随计数一起删除 —— "项目行不再有数字"由
    // 「「项目」行与项目行都不再渲染计数」那条用例锁定。
  });

  it("pins an ordinary session without selecting it and persists the order", async () => {
    await render([
      session("newer", { title: "Newer", updatedAt: 20 }),
      session("older", { title: "Older", updatedAt: 10 }),
    ]);

    await openSessionMenu("older");
    await act(async () => menuAction(i18n.t("sidebar.pin")).click());
    await flush();

    expect(useAppStore.getState().activeSessionId).toBeNull();
    expect((container.textContent ?? "").indexOf("Older")).toBeLessThan(
      (container.textContent ?? "").indexOf("Newer"),
    );
    expect(
      JSON.parse(localStorage.getItem("deskwand.sidebarPins") ?? "{}"),
    ).toEqual({
      sessionIds: ["older"],
      projectKeys: [],
    });

    await openSessionMenu("older");
    expect(menuAction(i18n.t("sidebar.unpin"))).toBeTruthy();
    await act(async () => menuAction(i18n.t("sidebar.unpin")).click());
    await flush();
    expect((container.textContent ?? "").indexOf("Newer")).toBeLessThan(
      (container.textContent ?? "").indexOf("Older"),
    );
    expect(
      JSON.parse(localStorage.getItem("deskwand.sidebarPins") ?? "{}"),
    ).toEqual({
      sessionIds: [],
      projectKeys: [],
    });
  });

  it("loads persisted pin order on mount", async () => {
    localStorage.setItem(
      "deskwand.sidebarPins",
      JSON.stringify({ sessionIds: ["older"], projectKeys: [] }),
    );
    useAppStore.setState({ activeSessionId: "newer" });
    await render([
      session("newer", { title: "Newer", updatedAt: 20 }),
      session("older", { title: "Older", updatedAt: 10 }),
    ]);

    expect((container.textContent ?? "").indexOf("Older")).toBeLessThan(
      (container.textContent ?? "").indexOf("Newer"),
    );
    await openSessionMenu("older");
    expect(menuAction(i18n.t("sidebar.unpin"))).toBeTruthy();
  });

  it("falls back to empty pins when persisted JSON is invalid", async () => {
    localStorage.setItem("deskwand.sidebarPins", "{");
    useAppStore.setState({ activeSessionId: "ordinary" });
    await render([session("ordinary")]);

    await openSessionMenu("ordinary");
    expect(menuAction(i18n.t("sidebar.pin"))).toBeTruthy();
    expect(localStorage.getItem("deskwand.sidebarPins")).toBe(
      JSON.stringify({ sessionIds: [], projectKeys: [] }),
    );
  });

  it("pins project groups in the project region without toggling expansion", async () => {
    await render([
      session("new", {
        isProjectMode: true,
        cwd: "/work/new",
        createdAt: 20,
      }),
      session("old", {
        isProjectMode: true,
        cwd: "/work/old",
        createdAt: 10,
      }),
    ]);
    const oldExpanded =
      projectToggle("/work/old").getAttribute("aria-expanded");

    await act(async () => pinButtonWithin(projectHeader("/work/old")!).click());

    expect(projectToggle("/work/old").getAttribute("aria-expanded")).toBe(
      oldExpanded,
    );
    expect((container.textContent ?? "").indexOf("old")).toBeLessThan(
      (container.textContent ?? "").indexOf("new"),
    );
    expect(
      JSON.parse(localStorage.getItem("deskwand.sidebarPins") ?? "{}"),
    ).toEqual({
      sessionIds: [],
      projectKeys: ["/work/old"],
    });
    expect(
      pinButtonWithin(projectHeader("/work/old")!).getAttribute("aria-label"),
    ).toBe(i18n.t("sidebar.unpin"));

    await act(async () => pinButtonWithin(projectHeader("/work/old")!).click());
    expect((container.textContent ?? "").indexOf("new")).toBeLessThan(
      (container.textContent ?? "").indexOf("old"),
    );
    expect(
      JSON.parse(localStorage.getItem("deskwand.sidebarPins") ?? "{}"),
    ).toEqual({
      sessionIds: [],
      projectKeys: [],
    });
  });

  it("always shows pinned sessions beyond the default limit", async () => {
    localStorage.setItem(
      "deskwand.sidebarPins",
      JSON.stringify({
        sessionIds: [
          "ordinary-1",
          "ordinary-2",
          "ordinary-3",
          "ordinary-4",
          "ordinary-5",
          "ordinary-6",
        ],
        projectKeys: [],
      }),
    );
    await render(
      Array.from({ length: 7 }, (_, index) =>
        session(`ordinary-${index + 1}`, {
          title: `Ordinary ${index + 1}`,
          updatedAt: 100 - index,
        }),
      ),
    );
    expect(container.textContent).toContain("Ordinary 6");
    expect(container.textContent).not.toContain("Ordinary 7");
    expect(
      findButton(i18n.t("sidebar.showMoreSessions", { count: 1 }))?.className,
    ).toContain("text-left");
  });

  it("shows archive and more actions while keeping the open trigger visible", async () => {
    useAppStore.setState({ activeSessionId: "ordinary" });
    await render([session("ordinary")]);

    const row = sessionRow("ordinary");
    const moreButton = sessionMoreButton("ordinary");
    // 按钮外面多了一层 Tooltip 的 .tt-anchor，不能再用 parentElement 定位动作行；
    // 按意图找"同时装着两个动作按钮的那一行"，对包裹层数量不敏感。
    const actionRow = findActionRow(moreButton);
    expect(actionRow?.className).toContain("opacity-0");

    await hoverSession("ordinary");
    expect(actionRow?.className).toContain("opacity-100");
    expect(actionRow?.querySelectorAll("button")).toHaveLength(2);
    // 悬停格现在是「标记完成」+「…」；归档搬进了菜单
    expect(
      row.querySelector(`button[title="${i18n.t("sidebar.markComplete")}"]`),
    ).toBeTruthy();
    expect(
      row.querySelector(`button[title="${i18n.t("sidebar.archive")}"]`),
    ).toBeNull();
    expect(
      row.querySelector(`button[title="${i18n.t("common.delete")}"]`),
    ).toBeNull();
    expect(actionRow?.parentElement?.className).toContain("w-[4.5rem]");
    expect(moreButton.getAttribute("aria-haspopup")).toBe("menu");
    expect(moreButton.getAttribute("aria-expanded")).toBe("false");

    // Radix 的 Trigger 只挂 pointerdown ✓（`.click()` 不会打开 ✗）
    await act(async () => {
      moreButton.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      );
    });
    expect(moreButton.getAttribute("aria-expanded")).toBe("true");
    await act(async () => {
      row.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    });
    expect(actionRow?.className).toContain("opacity-100");
    expect(findSessionMenu()).toBeTruthy();
  });

  it("offers pinning and marking for a running session, but no archive or delete", async () => {
    useAppStore.setState({ activeSessionId: "running" });
    await render([session("running", { status: "running" })]);

    const row = sessionRow("running");
    // 决策 6：运行中允许标记（并行时最想收的往往就是还在跑的那个）
    expect(
      row.querySelector(`button[title="${i18n.t("sidebar.markComplete")}"]`),
    ).toBeTruthy();

    await openSessionMenu("running");
    expect(menuAction(i18n.t("sidebar.pin"))).toBeTruthy();
    expect(menuAction(i18n.t("sidebar.markComplete"))).toBeTruthy();
    expect(findMenuAction(i18n.t("sidebar.archive"))).toBeUndefined();
    expect(findMenuAction(i18n.t("common.delete"))).toBeUndefined();
  });

  it("archives from the menu without an inline confirm, and still confirms delete", async () => {
    useAppStore.setState({ activeSessionId: "ordinary" });
    await render([session("ordinary", { title: "Ordinary" })]);

    // 归档搬进菜单后不再有"点两下"：开菜单点一下就直接归档（可逆，归档页能恢复）
    vi.clearAllMocks();
    await openSessionMenu("ordinary");
    await act(async () => menuAction(i18n.t("sidebar.archive")).click());
    await flush();
    expect(ipc.archiveSession).toHaveBeenCalledWith("ordinary");

    // 删除仍走确认框 —— 菜单里唯一不可逆的动作
    await openSessionMenu("ordinary");
    await act(async () => menuAction(i18n.t("common.delete")).click());
    expect(findSessionMenu()).toBeNull();
    expect(document.body.textContent).toContain(
      i18n.t("sidebar.deleteConversationConfirm"),
    );

    await act(async () => findButton(i18n.t("sidebar.confirmDelete"))?.click());
    expect(ipc.deleteSession).toHaveBeenCalledWith("ordinary");
  });

  it("closes the session menu from each dismissal interaction", async () => {
    useAppStore.setState({ activeSessionId: "ordinary" });
    await render([session("ordinary")]);

    await openSessionMenu("ordinary");
    await act(async () => {
      // ⚠️ 本仓已知：Escape/关闭类事件**必须给 cancelable: true** ✗ ——
      // 不给的话 `preventDefault()` 是空操作 ✓（计划 6 的教训 ✓）。
      // ⚠️ Radix 的 DismissableLayer 主路径是 **pointerdown** ✓（click 是补充 ✗）——
      // 两个都发 ✓，与触发器那边的做法一致 ✓。
      document.body.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      );
      document.body.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    expect(findSessionMenu()).toBeNull();

    await openSessionMenu("ordinary");
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(findSessionMenu()).toBeNull();

    await openSessionMenu("ordinary");
    const scrollList = container.querySelector(".sidebar-scroll");
    expect(scrollList).toBeTruthy();
    await act(async () => scrollList?.dispatchEvent(new Event("scroll")));
    expect(findSessionMenu()).toBeNull();

    // ⚠️ **契约变更（有意的 ✓）**：原实现在 `window` 的 resize 上关掉菜单 ✗；
    // 迁到 Radix 后它**不再关闭**，而是由 floating-ui **重新定位** ✓（面板跟着触发器走 ✓）。
    // 这是更好的行为 ✓，也与 D2「以 shadcn 默认观感为准」一致 ✓ —— 所以要改的是测试 ✓，
    // 不是生产代码 ✗（下次想恢复成关闭的话，得显式接 `onResize` ✗）。
    await openSessionMenu("ordinary");
    await act(async () => window.dispatchEvent(new Event("resize")));
    expect(
      findSessionMenu(),
      "Radix 在 resize 上重新定位而不是关闭 ✓",
    ).not.toBeNull();
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    await openSessionMenu("ordinary");
    await act(async () => sessionRow("ordinary").click());
    expect(findSessionMenu()).toBeNull();
  });

  it("keeps same-named projects separate by full path", async () => {
    await render([
      session("one", { isProjectMode: true, cwd: "/work/one/app" }),
      session("two", { isProjectMode: true, cwd: "/work/two/app" }),
    ]);

    expect(container.querySelector('[title="/work/one/app"]')).toBeTruthy();
    expect(container.querySelector('[title="/work/two/app"]')).toBeTruthy();
  });

  it("starts a blank session only after a successful workspace change", async () => {
    ipc.invoke.mockResolvedValue({ success: true, path: "/work/deskwand" });
    useAppStore.setState({
      activeSessionId: "current",
      workingDir: "/work/old",
    });
    await render([
      session("project", { isProjectMode: true, cwd: "/work/deskwand" }),
    ]);

    await act(async () => projectAction("/work/deskwand").click());
    await flush();

    expect(ipc.invoke).toHaveBeenCalledWith({
      type: "workdir.set",
      payload: { path: "/work/deskwand" },
    });
    expect(useAppStore.getState().workingDir).toBe("/work/deskwand");
    expect(useAppStore.getState().activeSessionId).toBeNull();
  });

  it("preserves context after an unsuccessful workspace change", async () => {
    ipc.invoke.mockResolvedValue({ success: false, path: "", error: "denied" });
    useAppStore.setState({
      activeSessionId: "current",
      workingDir: "/work/old",
    });
    await render([
      session("project", { isProjectMode: true, cwd: "/work/deskwand" }),
    ]);

    await act(async () => projectAction("/work/deskwand").click());
    await flush();

    expect(useAppStore.getState().workingDir).toBe("/work/old");
    expect(useAppStore.getState().activeSessionId).toBe("current");
    expect(useAppStore.getState().globalNotice).toMatchObject({
      type: "error",
    });
  });

  it("preserves context after a rejected workspace change", async () => {
    ipc.invoke.mockRejectedValue(new Error("IPC failed"));
    useAppStore.setState({
      activeSessionId: "current",
      workingDir: "/work/old",
    });
    await render([
      session("project", { isProjectMode: true, cwd: "/work/deskwand" }),
    ]);

    await act(async () => projectAction("/work/deskwand").click());
    await flush();

    expect(useAppStore.getState().workingDir).toBe("/work/old");
    expect(useAppStore.getState().activeSessionId).toBe("current");
    expect(useAppStore.getState().globalNotice).toMatchObject({
      type: "error",
    });
  });

  it("does not render project badges or project filter chips", async () => {
    await render([
      session("project", {
        title: "Project chat",
        isProjectMode: true,
        cwd: "/work/deskwand",
      }),
    ]);

    const title = Array.from(container.querySelectorAll("div")).find(
      (element) => element.textContent === "Project chat",
    );
    // 用会话行的稳定锚点定位，不用一串表现类 —— 2026-10-11 移除了行上的手型光标类，
    // 原选择器 `.group.relative.cursor-pointer` 会直接查不到（Sidebar.tsx:775 的 data-session-id 才是意图锚点）。
    const row = title?.closest("[data-session-id]");
    expect(row?.textContent).not.toContain("deskwand");
  });

  it("does not render a completed-task dismissal control", async () => {
    useAppStore.setState({ activeSessionId: "completed" });
    await render([session("completed", { status: "completed" })]);

    expect(container.querySelector('svg[role="button"]')).toBeNull();
  });

  it("derives the running indicator directly from session status", async () => {
    useAppStore.setState({ activeSessionId: "running" });
    await render([session("running", { status: "running" })]);

    expect(
      container.querySelector('[role="status"]')?.getAttribute("aria-label"),
    ).toBe(i18n.t("sidebar.running"));
  });

  it("shows a help icon instead of the pulsing dot while ask_user waits", async () => {
    await render(
      [
        session("waiting", { title: "Waiting on me", updatedAt: 20 }),
        session("running-sibling", {
          title: "Running sibling",
          updatedAt: 10,
          status: "running",
        }),
      ],
      {
        pendingAskUsers: {
          t1: { sessionId: "waiting", toolCallId: "t1", questions: [] },
        },
      },
    );

    // 这一条的状态是 idle：图标只能由 pending 这个事实驱动
    const waitingStatus =
      sessionRow("waiting").querySelector('[role="status"]');
    expect(waitingStatus).toBeTruthy();
    // aria-label 今天就已经是 asking（既有三元）；本用例的新契约是形状
    expect(waitingStatus?.getAttribute("aria-label")).toBe(
      i18n.t("sidebar.asking"),
    );
    expect(waitingStatus?.querySelector("svg")).toBeTruthy();
    // 钉住「与 AskUserCard 同一张脸」：图标身份 + 尺寸 + 色 token。
    // ⚠️ 实际类名是 lucide-circle-question-mark：本版 lucide 的现名是
    // CircleQuestionMark，CircleHelp 只是别名（渲染出的是同一个字形）。
    // 不断言 aria-hidden：lucide-react@1.8.0 的 Icon.js 在无 children、
    // 无 a11y 属性时自己就补了 aria-hidden="true"，这条断言无法被证伪。
    const waitingIcon = waitingStatus?.querySelector("svg");
    expect(waitingIcon?.getAttribute("class")).toContain(
      "lucide-circle-question-mark",
    );
    expect(waitingIcon?.getAttribute("class")).toContain("h-3.5");
    expect(waitingIcon?.getAttribute("class")).toContain("w-3.5");
    expect(waitingIcon?.getAttribute("class")).toContain("text-primary-text");
    expect(
      waitingStatus?.querySelector("span.rounded-full.animate-pulse"),
    ).toBeNull();

    const runningStatus =
      sessionRow("running-sibling").querySelector('[role="status"]');
    expect(runningStatus?.getAttribute("aria-label")).toBe(
      i18n.t("sidebar.running"),
    );
    expect(
      runningStatus?.querySelector(
        "span.rounded-full.bg-primary.animate-pulse",
      ),
    ).toBeTruthy();
    expect(runningStatus?.querySelector("svg")).toBeNull();
  });

  it("falls back to the pulsing dot once the question is answered", async () => {
    const sessions = [
      session("answering", {
        title: "Answering",
        updatedAt: 20,
        status: "running",
      }),
    ];

    await render(sessions, {
      pendingAskUsers: {
        t1: { sessionId: "answering", toolCallId: "t1", questions: [] },
      },
    });
    const askingStatus =
      sessionRow("answering").querySelector('[role="status"]');
    expect(askingStatus?.getAttribute("aria-label")).toBe(
      i18n.t("sidebar.asking"),
    );
    expect(askingStatus?.querySelector("svg")).toBeTruthy();

    // 回答完：pending 清掉、主轮次还在跑 → 立刻退回脉冲点
    await render(sessions, { pendingAskUsers: {} });
    const runningStatus =
      sessionRow("answering").querySelector('[role="status"]');
    expect(runningStatus?.getAttribute("aria-label")).toBe(
      i18n.t("sidebar.running"),
    );
    expect(runningStatus?.querySelector("svg")).toBeNull();
    expect(
      runningStatus?.querySelector(
        "span.rounded-full.bg-primary.animate-pulse",
      ),
    ).toBeTruthy();
  });

  it("does not expose obsolete task-slot state", () => {
    const state: object = useAppStore.getState();
    expect("taskSlots" in state).toBe(false);
    expect("setTaskSlots" in state).toBe(false);
    expect("removeTaskSlot" in state).toBe(false);
  });

  it("expands ordinary sessions in batches of five and contracts to five", async () => {
    await render(
      Array.from({ length: 12 }, (_, index) =>
        session(`ordinary-${index + 1}`, {
          title: `Ordinary ${index + 1}`,
          updatedAt: 100 - index,
        }),
      ),
    );
    expect(container.textContent).toContain("Ordinary 5");
    expect(container.textContent).not.toContain("Ordinary 6");

    let showMore = findButton(i18n.t("sidebar.showMoreSessions", { count: 5 }));
    expect(showMore).toBeTruthy();
    // 2026-10-11：左内边距由调用点显式给出 —— 最近列表沿用 12px（`pl-3`）
    expect(showMore?.className).toContain("pl-3");
    expect(showMore?.className).not.toContain("pl-9");
    expect(showMore?.className).toContain("text-muted-foreground");
    expect(showMore?.className).toContain("hover:text-muted-foreground");
    expect(showMore?.className).toContain(
      "focus-visible:text-muted-foreground",
    );
    expect(showMore?.className).toContain("bg-transparent");
    expect(showMore?.className).toContain("hover:bg-transparent");
    expect(showMore?.className).toContain("focus-visible:bg-transparent");
    expect(showMore?.className).not.toContain("text-primary");
    expect(showMore?.className).not.toContain("hover:bg-primary");
    // ⚠️ 2026-10-09 相位 4 ✓：这条原先是「不许有 `focus-visible:outline-none`」✗ ——
    // 而 shadcn `Button` 的 base **自带**它 ✗ ⇒ 断言必然失败 ✓；但它同一条 base 里紧跟着
    // `focus-visible:ring-1 focus-visible:ring-ring` ✓ ⇒ **意图（聚焦时必须看得见 ✓）仍然成立** ✓✓
    // ⇒ 换成**正面钉子** ✓：必须有聚焦环 ✓（比「不许某一行」更强 ✓ —— 它直接测「看得见」✓）。
    expect(showMore?.className).toContain("focus-visible:ring");

    await act(async () => showMore?.click());
    expect(container.textContent).toContain("Ordinary 10");
    expect(container.textContent).not.toContain("Ordinary 11");
    expect(findButton(i18n.t("sidebar.showLessSessions"))).toBeTruthy();

    showMore = findButton(i18n.t("sidebar.showMoreSessions", { count: 2 }));
    expect(showMore).toBeTruthy();
    await act(async () => showMore?.click());
    expect(container.textContent).toContain("Ordinary 12");
    expect(findButton(i18n.t("sidebar.showLessSessions"))).toBeTruthy();
    expect(
      findButton(i18n.t("sidebar.showMoreSessions", { count: 1 })),
    ).toBeUndefined();

    await act(async () =>
      findButton(i18n.t("sidebar.showLessSessions"))?.click(),
    );
    expect(container.textContent).not.toContain("Ordinary 6");
  });

  it("expands three recent projects and limits each expanded list to five sessions", async () => {
    await render([
      ...makeProjectSessions("project-1", 7, 500),
      ...makeProjectSessions("project-2", 1, 400),
      ...makeProjectSessions("project-3", 1, 300),
      ...makeProjectSessions("project-4", 1, 200),
      ...makeProjectSessions("project-5", 1, 100),
    ]);

    expect(projectToggle("/work/project-1").getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(projectToggle("/work/project-2").getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(projectToggle("/work/project-3").getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(projectToggle("/work/project-4").getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(projectToggle("/work/project-5").getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(projectSection("/work/project-1").textContent).toContain(
      "project-1 chat 5",
    );
    expect(projectSection("/work/project-1").textContent).not.toContain(
      "project-1 chat 6",
    );
    expect(projectSection("/work/project-4").textContent).not.toContain(
      "project-4 chat 1",
    );
  });

  it("toggles an old project without coupling the new-session action", async () => {
    ipc.invoke.mockResolvedValue({ success: true, path: "/work/project-4" });
    await render([
      ...makeProjectSessions("project-1", 1, 500),
      ...makeProjectSessions("project-2", 1, 400),
      ...makeProjectSessions("project-3", 1, 300),
      ...makeProjectSessions("project-4", 1, 200),
    ]);

    await act(async () => projectToggle("/work/project-4").click());
    expect(projectToggle("/work/project-4").getAttribute("aria-expanded")).toBe(
      "true",
    );

    await act(async () => projectAction("/work/project-4").click());
    expect(ipc.invoke).toHaveBeenCalledWith({
      type: "workdir.set",
      payload: { path: "/work/project-4" },
    });
    expect(projectToggle("/work/project-4").getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("keeps an older active project and its active session visible", async () => {
    useAppStore.setState({ activeSessionId: "project-4-7" });
    await render([
      ...makeProjectSessions("project-1", 1, 500),
      ...makeProjectSessions("project-2", 1, 400),
      ...makeProjectSessions("project-3", 1, 300),
      ...makeProjectSessions("project-4", 7, 200),
    ]);

    expect(projectToggle("/work/project-4").getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(projectSection("/work/project-4").textContent).toContain(
      "project-4 chat 7",
    );

    await act(async () =>
      findButton(i18n.t("sidebar.showLessSessions"))?.click(),
    );
    expect(projectSection("/work/project-4").textContent).toContain(
      "project-4 chat 7",
    );
  });

  it("resets a project list to five when its Header collapses", async () => {
    await render(makeProjectSessions("deskwand", 7, 500));

    await act(async () =>
      findButton(i18n.t("sidebar.showMoreSessions", { count: 2 }))?.click(),
    );
    expect(projectSection("/work/deskwand").textContent).toContain(
      "deskwand chat 7",
    );

    await act(async () => projectToggle("/work/deskwand").click());
    await act(async () => projectToggle("/work/deskwand").click());

    expect(projectSection("/work/deskwand").textContent).not.toContain(
      "deskwand chat 6",
    );
    expect(projectSection("/work/deskwand").textContent).toContain(
      i18n.t("sidebar.showMoreSessions", { count: 2 }),
    );
  });

  it("clamps a stale visible count after sessions are removed", async () => {
    const ordinary = Array.from({ length: 12 }, (_, index) =>
      session(`ordinary-${index + 1}`, {
        title: `Ordinary ${index + 1}`,
        updatedAt: 100 - index,
      }),
    );
    await render(ordinary);
    await act(async () =>
      findButton(i18n.t("sidebar.showMoreSessions", { count: 5 }))?.click(),
    );

    await render(ordinary.slice(0, 7));
    expect(container.textContent).toContain("Ordinary 7");
    expect(findButton(i18n.t("sidebar.showLessSessions"))).toBeTruthy();
  });

  it("keeps manual project choices across the default expansion threshold", async () => {
    const projectOne = makeProjectSessions("project-1", 1, 500)[0];
    const projectTwo = makeProjectSessions("project-2", 1, 400)[0];
    const projectThree = makeProjectSessions("project-3", 1, 300)[0];
    const projectFour = makeProjectSessions("project-4", 1, 200)[0];
    await render([projectOne, projectTwo, projectThree, projectFour]);

    await act(async () => projectToggle("/work/project-1").click());
    expect(projectToggle("/work/project-1").getAttribute("aria-expanded")).toBe(
      "false",
    );

    await render([
      { ...projectOne, updatedAt: 100 },
      { ...projectTwo, updatedAt: 600 },
      { ...projectThree, updatedAt: 500 },
      { ...projectFour, updatedAt: 400 },
    ]);
    expect(projectToggle("/work/project-1").getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("keeps overrides when an equivalent Windows path representation changes", async () => {
    const backslash = session("windows-1", {
      title: "Windows chat 1",
      isProjectMode: true,
      cwd: "C:\\Work\\App",
      updatedAt: 500,
    });
    const forwardSlash = session("windows-2", {
      title: "Windows chat 2",
      isProjectMode: true,
      cwd: "c:/work/app/",
      updatedAt: 400,
    });
    await render([backslash, forwardSlash]);

    await act(async () => projectToggle("C:\\Work\\App").click());
    expect(projectToggle("C:\\Work\\App").getAttribute("aria-expanded")).toBe(
      "false",
    );

    await render([
      { ...forwardSlash, updatedAt: 600 },
      { ...backslash, updatedAt: 300 },
    ]);
    expect(projectToggle("c:/work/app").getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("shows running badge on project group icon only while it is collapsed", async () => {
    await render([
      session("running-project", {
        title: "Running project chat",
        isProjectMode: true,
        cwd: "/work/deskwand",
        updatedAt: 20,
        status: "running",
      }),
    ]);

    const badge = "span.rounded-full.bg-primary.animate-pulse";
    // 默认展开 → 父行不画角标，信号由会话行自己那颗点承担。
    // 同一个选择器也匹配组角标，所以第二条断言限定在会话行内（那颗 2.5px 的点）。
    expect(projectToggle("/work/deskwand").querySelector(badge)).toBeNull();
    expect(sessionRow("running-project").querySelector(badge)).toBeTruthy();

    await act(async () => projectToggle("/work/deskwand").click());
    expect(projectToggle("/work/deskwand").querySelector(badge)).toBeTruthy();
  });

  it("shows running badge on ordinary group icon only while it is collapsed", async () => {
    await render([
      session("ordinary-running", {
        title: "Running ordinary",
        updatedAt: 10,
        status: "running",
      }),
    ]);

    const badge = "span.rounded-full.bg-primary.animate-pulse";
    // 「最近」默认展开 → 无角标
    expect(ordinaryToggle().querySelector(badge)).toBeNull();

    await act(async () => ordinaryToggle().click());
    expect(ordinaryToggle().querySelector(badge)).toBeTruthy();
  });

  it("hides running badge when all sessions become idle", async () => {
    await render([
      session("run-then-idle", {
        title: "Was running",
        isProjectMode: true,
        cwd: "/work/deskwand",
        updatedAt: 20,
        status: "running",
      }),
    ]);

    const badge = "span.rounded-full.bg-primary.animate-pulse";
    // 收起后父行才画角标，所以先收起，再断言「忙 ⇒ 有角标」
    await act(async () => projectToggle("/work/deskwand").click());
    expect(projectToggle("/work/deskwand").querySelector(badge)).toBeTruthy();

    await render([
      session("run-then-idle", {
        title: "Was running",
        isProjectMode: true,
        cwd: "/work/deskwand",
        updatedAt: 20,
        status: "idle",
      }),
    ]);

    // 收起态必须跨过这次 re-render 存活；否则下面这条会因为「展开」而空过
    expect(projectToggle("/work/deskwand").getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(projectToggle("/work/deskwand").querySelector(badge)).toBeNull();
  });

  it("shows the projects row running badge only while it is collapsed", async () => {
    await render([
      session("root-running-project", {
        title: "Root running project chat",
        isProjectMode: true,
        cwd: "/work/root-running",
        updatedAt: 20,
        status: "running",
      }),
    ]);

    const pulse = "span.rounded-full.bg-primary.animate-pulse";
    const warning = "span.rounded-full.bg-warning";

    // 本文件的 render() 会把「项目」播种为展开 → 根行不画角标
    expect(projectsToggle().querySelector(pulse)).toBeNull();

    await act(async () => projectsToggle().click());
    expect(projectsToggle().querySelector(pulse)).toBeTruthy();
    expect(projectsToggle().querySelector(warning)).toBeNull();

    // 再点一下展开：角标随「展开」消失 —— 这就是需求里的那个交互
    await act(async () => projectsToggle().click());
    expect(projectsToggle().querySelector(pulse)).toBeNull();
  });

  function projectsToggle(): HTMLButtonElement {
    const button = Array.from(
      container.querySelectorAll("button[aria-expanded]"),
    ).find((candidate) =>
      candidate.textContent?.includes(i18n.t("sidebar.projects")),
    );
    expect(button).toBeTruthy();
    return button as HTMLButtonElement;
  }

  function projectsRow(): HTMLElement {
    const row = projectsToggle().parentElement;
    expect(row, "「项目」行必须有外层容器").toBeTruthy();
    return row as HTMLElement;
  }

  function projectsRowAction(label: string): HTMLButtonElement {
    const button = Array.from(projectsRow().querySelectorAll("button")).find(
      (candidate) => candidate.getAttribute("aria-label") === label,
    );
    expect(button, `「项目」行必须有「${label}」按钮`).toBeTruthy();
    return button as HTMLButtonElement;
  }

  it("shows a warning badge on a group whose session waits for an answer", async () => {
    await render(
      [
        session("waiting-project", {
          title: "Waiting project chat",
          isProjectMode: true,
          cwd: "/work/waiting",
          updatedAt: 20,
        }),
        session("running-project", {
          title: "Running project chat",
          isProjectMode: true,
          cwd: "/work/running",
          updatedAt: 10,
          status: "running",
        }),
        // 同一个等待项目里再放一条 running 会话：角标必须仍然是 asking（琥珀），
        // 这样「组内 asking 压过 running」才真的被钉住
        session("running-in-waiting-project", {
          title: "Running inside waiting project",
          isProjectMode: true,
          cwd: "/work/waiting",
          updatedAt: 15,
          status: "running",
        }),
        // 无项目归属的在等回答会话：「最近」根行的琥珀角标就是需求的主场景
        session("waiting-ordinary", {
          title: "Waiting ordinary chat",
          updatedAt: 25,
        }),
      ],
      {
        pendingAskUsers: {
          t1: { sessionId: "waiting-project", toolCallId: "t1", questions: [] },
          t2: {
            sessionId: "waiting-ordinary",
            toolCallId: "t2",
            questions: [],
          },
        },
      },
    );

    const warning = "span.rounded-full.bg-warning";
    const pulse = "span.rounded-full.animate-pulse";

    // 全部展开时父行一律不画角标：展开了就由子层自己说
    expect(projectToggle("/work/waiting").querySelector(warning)).toBeNull();
    expect(projectToggle("/work/running").querySelector(pulse)).toBeNull();
    expect(projectsToggle().querySelector(warning)).toBeNull();
    expect(ordinaryToggle().querySelector(warning)).toBeNull();

    // 收起后：组内 asking 压过 running
    await act(async () => projectToggle("/work/waiting").click());
    await act(async () => projectToggle("/work/running").click());
    await act(async () => ordinaryToggle().click());

    expect(projectToggle("/work/waiting").querySelector(warning)).toBeTruthy();
    expect(projectToggle("/work/waiting").querySelector(pulse)).toBeNull();
    expect(projectToggle("/work/running").querySelector(warning)).toBeNull();
    expect(projectToggle("/work/running").querySelector(pulse)).toBeTruthy();
    expect(ordinaryToggle().querySelector(warning)).toBeTruthy();
    expect(ordinaryToggle().querySelector(pulse)).toBeNull();

    // 「项目」根行收起后：任一项目在等回答 ⇒ 琥珀（asking 压过 running）
    await act(async () => projectsToggle().click());
    expect(projectsToggle().querySelector(warning)).toBeTruthy();
    expect(projectsToggle().querySelector(pulse)).toBeNull();
  });

  it("deletes a project through the header trash action", async () => {
    ipc.deleteProject.mockResolvedValue({
      success: true,
      path: "/work/deskwand",
      deletedSessionIds: ["p1", "p2"],
    });
    await render([
      session("p1", { isProjectMode: true, cwd: "/work/deskwand" }),
      session("p2", { isProjectMode: true, cwd: "/work/deskwand" }),
    ]);

    const trash = projectHeader("/work/deskwand")?.querySelector(
      `button[aria-label="${i18n.t("common.delete")}"]`,
    ) as HTMLButtonElement;
    expect(trash).toBeTruthy();
    expect(trash.className).toContain("opacity-0");
    expect(trash.className).toContain("pointer-events-none");

    await act(async () => trash.click());
    expect(ipc.deleteProject).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(
      i18n.t("sidebar.deleteProjectConfirmWithName", { name: "deskwand" }),
    );
    expect(document.body.textContent).not.toContain(
      i18n.t("sidebar.deleteProjectRunningHint", { count: 2 }),
    );

    await act(async () => findButton(i18n.t("sidebar.confirmDelete"))?.click());
    await flush();
    expect(ipc.deleteProject).toHaveBeenCalledWith("/work/deskwand");
    expect(findButton(i18n.t("sidebar.confirmDelete"))).toBeUndefined();
  });

  it("warns about sessions still active in the project", async () => {
    ipc.deleteProject.mockResolvedValue({
      success: true,
      path: "/work/deskwand",
      deletedSessionIds: ["p1", "p2"],
    });
    await render([
      session("p1", { isProjectMode: true, cwd: "/work/deskwand" }),
      session("p2", {
        isProjectMode: true,
        cwd: "/work/deskwand",
        status: "running",
      }),
    ]);

    const trash = projectHeader("/work/deskwand")?.querySelector(
      `button[aria-label="${i18n.t("common.delete")}"]`,
    ) as HTMLButtonElement;
    expect(trash).toBeTruthy();
    await act(async () => trash.click());

    expect(document.body.textContent).toContain(
      i18n.t("sidebar.deleteProjectRunningHint", { count: 1 }),
    );

    // 那条告警必须是 **error 语气** —— 承载语义（删除会打断正在跑的会话），不是装饰。
    // 原实现是 `text-sm leading-6 text-destructive`，迁到 ConfirmDialog 后靠
    // descriptionTone="error" 保住。计划 4 的 Review Focus #2 要的就是这一条。
    const hint = Array.from(
      document.body.querySelectorAll('[role="alertdialog"] p'),
    ).find((p) =>
      p.textContent?.includes(
        i18n.t("sidebar.deleteProjectRunningHint", { count: 1 }),
      ),
    );
    expect(hint, "告警行必须存在").toBeTruthy();
    expect(hint!.className, "告警必须是 error 语气").toContain(
      "text-destructive",
    );
  });

  it("keeps the confirmation open when the delete fails", async () => {
    ipc.deleteProject.mockResolvedValue({
      success: false,
      path: "",
      deletedSessionIds: [],
      error: "boom",
    });
    await render([
      session("p1", { isProjectMode: true, cwd: "/work/deskwand" }),
    ]);

    const trash = projectHeader("/work/deskwand")?.querySelector(
      `button[aria-label="${i18n.t("common.delete")}"]`,
    ) as HTMLButtonElement;
    expect(trash).toBeTruthy();
    await act(async () => trash.click());
    await act(async () => findButton(i18n.t("sidebar.confirmDelete"))?.click());
    await flush();

    expect(findButton(i18n.t("sidebar.confirmDelete"))).toBeTruthy();
    expect(useAppStore.getState().globalNotice).toMatchObject({
      type: "error",
    });
  });

  it("drops the deleted project's pin and expansion state", async () => {
    localStorage.setItem(
      "deskwand.sidebarPins",
      JSON.stringify({ sessionIds: [], projectKeys: ["/work/deskwand"] }),
    );
    localStorage.setItem(
      "deskwand.sidebarGroupExpansion",
      JSON.stringify({ __projects__: true, "/work/deskwand": false }),
    );
    ipc.deleteProject.mockResolvedValue({
      success: true,
      path: "/work/deskwand",
      deletedSessionIds: ["p1"],
    });
    await render([
      session("p1", { isProjectMode: true, cwd: "/work/deskwand" }),
    ]);

    const trash = projectHeader("/work/deskwand")?.querySelector(
      `button[aria-label="${i18n.t("common.delete")}"]`,
    ) as HTMLButtonElement;
    await act(async () => trash.click());
    await act(async () => findButton(i18n.t("sidebar.confirmDelete"))?.click());
    await flush();

    expect(localStorage.getItem("deskwand.sidebarPins") ?? "").not.toContain(
      "/work/deskwand",
    );
    expect(
      localStorage.getItem("deskwand.sidebarGroupExpansion") ?? "",
    ).not.toContain("/work/deskwand");
  });

  it("returns to the welcome view when the active session was deleted", async () => {
    ipc.deleteProject.mockResolvedValue({
      success: true,
      path: "/work/deskwand",
      deletedSessionIds: ["p1"],
    });
    useAppStore.setState({ activeSessionId: "p1" });
    await render([
      session("p1", { isProjectMode: true, cwd: "/work/deskwand" }),
    ]);

    const trash = projectHeader("/work/deskwand")?.querySelector(
      `button[aria-label="${i18n.t("common.delete")}"]`,
    ) as HTMLButtonElement;
    await act(async () => trash.click());
    await act(async () => findButton(i18n.t("sidebar.confirmDelete"))?.click());
    await flush();

    expect(useAppStore.getState().activeSessionId).toBeNull();
  });

  function findSessionRail(sessionId: string): HTMLElement | undefined {
    // 尾槽靠类名认（`w-[4.5rem]`）：jsdom 的 CSS 解析器对转义过的
    // 方括号类名支持不稳，按意图找“行里那个固定宽度的尾巴”。
    return Array.from(sessionRow(sessionId).querySelectorAll("div")).find(
      (element) => element.className.includes("w-[4.5rem]"),
    ) as HTMLElement | undefined;
  }

  it("keeps the project pin on the shared right rail", async () => {
    localStorage.setItem(
      "deskwand.sidebarPins",
      JSON.stringify({ sessionIds: [], projectKeys: ["/work/pinned"] }),
    );
    await render([
      session("pinned-project", {
        isProjectMode: true,
        cwd: "/work/pinned",
        createdAt: 10,
      }),
    ]);

    const header = projectHeader("/work/pinned")!;
    const pin = pinButtonWithin(header);
    // pin 必须是尾部动作里的最后一个：同样只在 hover / 聚焦时浮出的「新建 / 删除」
    // 只能落在它左边，否则 pin 的图标中心会停在这一行的中段，
    // 和会话行的相对时间 / 状态点错开两列。
    const trailing = Array.from(header.querySelectorAll("button[aria-label]"));
    expect(trailing[trailing.length - 1]).toBe(pin);
    expect(header.lastElementChild?.contains(pin)).toBe(true);
    // 那 2px 内缩把 32px 按钮里的 16px 图标格（左右各内缩 8px）推到行右缘内缩 10px ——
    // 正是会话行的相对时间 / 状态标记那条共用右缘 ✓（见「尾槽每个标记的右缘…」那条 ✓）；
    // jsdom 量不了距离，只能锁类名。
    expect(header.className).toContain("pr-0.5");
  });

  it("置顶的会话不再用 pin 顶替相对时间", async () => {
    localStorage.setItem(
      "deskwand.sidebarPins",
      JSON.stringify({ sessionIds: ["ordinary"], projectKeys: [] }),
    );
    await render([
      session("ordinary", { updatedAt: 10 }),
      session("plain", { updatedAt: 10 }),
    ]);

    const railCell = (sessionId: string): HTMLElement => {
      const rail = findSessionRail(sessionId);
      expect(rail, sessionId).toBeTruthy();
      const visible = rail!.firstElementChild as HTMLElement;
      // 一个格子只放一个标记：尾槽里不会出现 pin 和时间并排
      expect(visible.children, sessionId).toHaveLength(1);
      // `justify-end` 是这条右边线的机制本身：掉了它，标记会退回 72px 槽的
      // 最左边（改动前的样子）。jsdom 量不了布局，只能锁类名。
      expect(visible.className, sessionId).toContain("justify-end");
      return visible.firstElementChild as HTMLElement;
    };

    // 置顶不再占这一格：置顶行的尾槽和普通行一样，都是相对时间
    const pinnedCell = railCell("ordinary");
    const pinnedText = pinnedCell.textContent?.trim() ?? "";
    expect(pinnedText).not.toBe("");
    expect(pinnedText).toBe(railCell("plain").textContent?.trim());
    expect(pinnedCell.querySelector("svg")).toBeNull();
    // 看得见的标记没了，但状态没丢：读屏仍能听到「已置顶」（`sr-only` 那句）
    expect(sessionRow("ordinary").textContent).toContain(
      i18n.t("sidebar.pinned"),
    );
    expect(sessionRow("plain").textContent).not.toContain(
      i18n.t("sidebar.pinned"),
    );
  });

  it("运行中的状态点仍顶替相对时间", async () => {
    await render([session("running", { status: "running" })]);

    const rail = findSessionRail("running");
    expect(rail).toBeTruthy();
    const visible = rail!.firstElementChild as HTMLElement;
    expect(visible.children).toHaveLength(1);
    const marker = visible.firstElementChild as HTMLElement;
    expect(marker.getAttribute("role")).toBe("status");
    expect(marker.querySelector("svg")).toBeNull();
  });

  it("尾槽每个标记的右缘都落在相对时间那条线上", async () => {
    // 尾槽只在**右缘**上对齐：基准线是相对时间的右缘（= 行右缘内缩 10px，即 `px-2.5` 的
    // 内容盒边缘 ✓）。两处会自己掉进去的内缩：16px 标记格居中放 10px 状态点
    // ⇒ 墨迹缩 3px ✗；24px 动作槽（`size="iconXs"`）里装 16px 图标 ⇒ 缩 4px ✗。
    // 修法就是各交回那条线（`justify-end` / `-mr-1`）；jsdom 量不了距离，只能锁类名 ✓。
    await render([
      session("running", { title: "Running chat", status: "running" }),
      session("meta-project", {
        title: "Project chat",
        isProjectMode: true,
        cwd: "/work/rail",
      }),
      ...Array.from({ length: 6 }, (_, index) =>
        session(`bulk-${index}`, { title: `Bulk ${index}` }),
      ),
    ]);

    const cellOf = (sessionId: string): HTMLElement => {
      const rail = findSessionRail(sessionId);
      expect(rail, sessionId).toBeTruthy();
      const visible = rail!.firstElementChild as HTMLElement;
      expect(visible.children, sessionId).toHaveLength(1);
      return visible.firstElementChild as HTMLElement;
    };
    // 状态点的 16px 标记格右对齐；掉成 `justify-center` 就又退回 3px 的内缩 ✗
    const dotCell = cellOf("running");
    expect(dotCell.className).toContain("h-4");
    expect(dotCell.className).toContain("w-4");
    expect(dotCell.className).toContain("justify-end");
    // 动作行整体右移 4px：图标右缘才回到基准线（掉 `-mr-1` 就又缩回 4px ✗）
    const actionRow = findActionRow(sessionMoreButton("bulk-0"));
    expect(actionRow?.className).toContain("justify-end");
    expect(actionRow?.className).toContain("-mr-1");
    // 那 4px 只对得上 24px 档 + 16px 图标（差的一半 ✓）：档位一旦写成别的尺寸，
    // 同一个 `-mr-1` 就不是 4px 那个数了 ⇒ 档位也得钉住 ✓。
    expect(sessionMoreButton("bulk-0").className).toContain("h-6");
    // 「收起」只在场于列表被展开之后 ⇒ 先点一下「展开更多」（就是产品里的那条路径 ✓）
    await act(async () =>
      findButton(i18n.t("sidebar.showMoreSessions", { count: 2 }))?.click(),
    );
    // 「收起」：按钮内边距是 `px-3`（比会话行多 2px）⇒ 右拉回 2px ✓
    expect(findButton(i18n.t("sidebar.showLessSessions"))?.className).toContain(
      "-mr-0.5",
    );
  });

  it("会话行的归档/更多键是 24² 槽：缺省档垫子不在场（盒宽不再被撑到 32）", async () => {
    // 2026-10-10 实测：`cn` 只删同族冲突 ⇒ 手写 `h-6 w-6` + 缺省档 `px-4`
    // ⇒ 盒宽被内边距之和撑到 32（比作者写的宽 8px ✗）；补 `px-0` 后 24×24、左右内边距 0 ✓。
    await render([session("ordinary")]);
    const row = sessionRow("ordinary");
    const mark = row.querySelector<HTMLButtonElement>(
      `button[title="${i18n.t("sidebar.markComplete")}"]`,
    );
    const more = sessionMoreButton("ordinary");
    for (const [label, key] of [
      ["markComplete", mark],
      ["moreActions", more],
    ] as const) {
      expect(key, `${label} 应该渲染出来`).not.toBeNull();
      const tokens = key!.className.split(/\s+/);
      // 24² 槽位（`size="iconXs"`）或就地 `px-0` —— 要的是「盒子 24 宽、缺省档垫子不在场」
      expect(tokens, label).toContain("h-6");
      expect(tokens, label).toContain("w-6");
      expect(tokens, label).not.toContain("px-4");
      expect(tokens, label).not.toContain("py-2");
    }
  });

  it("项目行的 pin 不再常显：hover / 行内聚焦才浮出，置顶靠顺序标记", async () => {
    localStorage.setItem(
      "deskwand.sidebarPins",
      JSON.stringify({ sessionIds: [], projectKeys: ["/work/pinned"] }),
    );
    await render([
      session("pinned-project", {
        isProjectMode: true,
        cwd: "/work/pinned",
        createdAt: 10,
      }),
    ]);

    const pin = pinButtonWithin(projectHeader("/work/pinned")!);
    // 置顶状态不再有常驻标记：静止时它和「新建 / 删除」一样是藏着的。
    // 逐 token 比对：`toContain("opacity-100")` 会被 `group-hover/project:opacity-100`
    // 这类带前缀的 token 骗过，所以先 split 再比。
    const tokens = pin.className.split(/\s+/);
    expect(tokens).toContain("opacity-0");
    expect(tokens).toContain("pointer-events-none");
    expect(tokens).not.toContain("opacity-100");
    // 浮出的两条路径：鼠标 hover ✓，键盘把焦点落进行内 ✓ —— `opacity-0` 连焦点环
    // 一起吃掉，少了 focus-within 这条，键盘用户就撞在一个看不见的按钮上。
    expect(tokens).toContain("group-hover/project:opacity-100");
    expect(tokens).toContain("group-focus-within/project:opacity-100");
    // 藏起来的是标记，不是能力：已置顶时仍是「取消置顶」，实心图标保留。
    expect(pin.getAttribute("aria-label")).toBe(i18n.t("sidebar.unpin"));
    expect(pin.querySelector("svg")?.getAttribute("class")).toContain(
      "fill-current",
    );
  });

  it("后置顶的项目排到最上面（新置顶进数组头）", async () => {
    await render([
      session("old", { isProjectMode: true, cwd: "/work/old", createdAt: 10 }),
      session("new", { isProjectMode: true, cwd: "/work/new", createdAt: 20 }),
    ]);
    const projectOrder = (): string[] =>
      Array.from(container.querySelectorAll("[title]"))
        .map((element) => element.getAttribute("title") ?? "")
        .filter((cwd) => cwd === "/work/old" || cwd === "/work/new");
    // 未置顶时按最早创建时间倒序：新的在前
    expect(projectOrder()).toEqual(["/work/new", "/work/old"]);

    await act(async () => pinButtonWithin(projectHeader("/work/old")!).click());
    // 置顶区按在未置顶区前面，所以 old 上来
    expect(projectOrder()).toEqual(["/work/old", "/work/new"]);
    // 后置顶的进数组头 = 排在先置顶的那颗前面
    await act(async () => pinButtonWithin(projectHeader("/work/new")!).click());
    expect(projectOrder()).toEqual(["/work/new", "/work/old"]);
    expect(
      JSON.parse(localStorage.getItem("deskwand.sidebarPins") ?? "{}"),
    ).toEqual({ sessionIds: [], projectKeys: ["/work/new", "/work/old"] });
  });

  it("后置顶的会话也排到最上面（同一套排序规则）", async () => {
    await render([
      session("newer", { title: "Newer", updatedAt: 20 }),
      session("older", { title: "Older", updatedAt: 10 }),
    ]);
    const sessionOrder = (): string[] =>
      Array.from(container.querySelectorAll("[data-session-id]")).map(
        (element) => element.getAttribute("data-session-id") ?? "",
      );
    expect(sessionOrder()).toEqual(["newer", "older"]);

    await openSessionMenu("older");
    await act(async () => menuAction(i18n.t("sidebar.pin")).click());
    await flush();
    expect(sessionOrder()).toEqual(["older", "newer"]);

    // 会话置顶与项目置顶共用 `toggleOrderedId`：后置顶的同样进数组头
    await openSessionMenu("newer");
    await act(async () => menuAction(i18n.t("sidebar.pin")).click());
    await flush();
    expect(sessionOrder()).toEqual(["newer", "older"]);
    expect(
      JSON.parse(localStorage.getItem("deskwand.sidebarPins") ?? "{}"),
    ).toEqual({ sessionIds: ["newer", "older"], projectKeys: [] });
  });

  // ---- 2026-10-11 字号 / 缩进层级（jsdom 不计算真实几何，这里锁的是布局机制）----

  it("aligns project session text with project labels without moving the right rail", async () => {
    const cwd = "/work/sidebar-spacing";
    await render([
      session("nested", { cwd, isProjectMode: true }),
      session("recent"),
    ]);
    if (projectToggle(cwd).getAttribute("aria-expanded") !== "true") {
      await act(async () => projectToggle(cwd).click());
      await flush();
    }
    const project = projectToggle(cwd);
    expect(project.className).toContain("text-sm");
    expect(project.className).toContain("font-normal");
    expect(project.className).toContain("px-3");
    expect(project.className).toContain("gap-2");
    for (const id of ["nested", "recent"]) {
      const row = sessionRow(id);
      expect(row.className).toContain("min-h-8");
      expect(row.className).toContain("py-1.5");
      expect(row.className).toContain("pr-2.5");
      expect(row.classList.contains("px-2.5")).toBe(false);
      const title = row.querySelector(".truncate");
      expect(title?.className).toContain("text-sm");
      expect(title?.className).toContain("font-normal");
      const rail = findSessionRail(id);
      expect(rail?.className).toContain("w-[4.5rem]");
      expect(rail?.className).toContain("flex-shrink-0");
    }
    expect(sessionRow("nested").className).toContain("pl-9");
    expect(sessionRow("recent").className).toContain("pl-3");
  });

  it("renders a new-chat row with a hover disclosure and a search button", async () => {
    await render([]);

    const newChat = findButton(i18n.t("sidebar.newChat"));
    expect(newChat).toBeTruthy();
    // 整行按钮（不是 32² 图标格）：文字在按钮里、宽度交给容器
    expect(newChat?.className).toContain("w-full");
    expect(newChat?.className).toContain("justify-start");

    const disclosure = newChat?.parentElement?.querySelector(
      'button[data-state][aria-haspopup="menu"]',
    );
    expect(disclosure).toBeTruthy();
    // 收起时不占视觉：hover / 行内聚焦才浮出
    expect(disclosure?.className).toContain("opacity-0");
    expect(disclosure?.className).toContain("group-hover/newchat:opacity-100");

    const searchButton = container.querySelector(
      `button[aria-label="${i18n.t("sidebar.searchChat")}"]`,
    ) as HTMLButtonElement | null;
    expect(searchButton).toBeTruthy();
    await act(async () => searchButton?.click());
    expect(useAppStore.getState().sessionSearchOpen).toBe(true);

    // 内联搜索框已下线（改名输入框只在编辑态出现）
    expect(container.querySelector('input[type="text"]')).toBeNull();
    // DOM 顺序：新聊天行 → 放大镜
    expect(newChat?.compareDocumentPosition(searchButton as Node) ?? 0).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("tells the user when a session could not be opened", async () => {
    ipc.getSessionMessagesPage.mockRejectedValue(new Error("ipc down"));
    await render([session("stuck", { title: "Stuck" })]);

    await act(async () => sessionRow("stuck").click());
    await flush();

    expect(useAppStore.getState().activeSessionId).toBeNull();
    expect(useAppStore.getState().globalNotice?.message).toBe(
      i18n.t("sidebar.openSessionFailed"),
    );
  });

  it("starts a blank chat from the new-chat row", async () => {
    useAppStore.setState({
      activeSessionId: "somewhere",
      workingDir: "/work/eagent",
    });
    await render([session("somewhere", { title: "Somewhere" })]);

    const newChat = findButton(i18n.t("sidebar.newChat"));
    expect(newChat).toBeTruthy();

    await act(async () => newChat?.click());
    await flush();

    expect(useAppStore.getState().activeSessionId).toBeNull();
    expect(useAppStore.getState().workingDir).toBeNull();
    expect(useAppStore.getState().activeView).toBe("chat");
  });

  it("retains truncation and rail space for long project titles", async () => {
    const cwd = "/work/sidebar-long-title";
    await render([
      session("long", {
        cwd,
        isProjectMode: true,
        title: "长会话标题 Long session title ".repeat(10),
      }),
    ]);
    if (projectToggle(cwd).getAttribute("aria-expanded") !== "true") {
      await act(async () => projectToggle(cwd).click());
      await flush();
    }
    const row = sessionRow("long");
    expect(row.querySelector(".truncate")).toBeTruthy();
    expect(row.querySelector(".min-w-0")).toBeTruthy();
    expect(findSessionRail("long")?.className).toContain("flex-shrink-0");
  });

  it("uses scalable muted typography for section headings", async () => {
    await render([
      session("heading-project", {
        cwd: "/work/sidebar-heading",
        isProjectMode: true,
      }),
      session("heading-recent"),
    ]);
    const headings = Array.from(
      container.querySelectorAll("button[aria-expanded]"),
    ).filter((button) =>
      [i18n.t("sidebar.recents"), i18n.t("sidebar.projects")].some((label) =>
        button.textContent?.includes(label),
      ),
    );
    expect(headings).toHaveLength(2);
    for (const heading of headings) {
      expect(heading.classList.contains("text-[0.8125rem]")).toBe(true);
      expect(heading.classList.contains("font-normal")).toBe(true);
      expect(heading.classList.contains("text-muted-foreground")).toBe(true);
      expect(heading.className).not.toContain("text-[13px]");
    }
  });

  it("「项目」行与项目行都不再渲染计数", async () => {
    await render(makeProjectSessions("countless", 3, 30));

    // 外层「项目」行的文本就是标签本身（旧实现尾巴上挂着一个 3）
    expect(projectsToggle().textContent).toBe(i18n.t("sidebar.projects"));

    // 内层项目行的 header 里没有任何纯数字 span（旧实现的会话数在这里）
    const header = projectHeader("/work/countless");
    expect(header, "项目行的 header 必须找得到").toBeTruthy();
    const numeric = Array.from(header?.querySelectorAll("span") ?? []).filter(
      (span) => /^\d+$/.test(span.textContent ?? ""),
    );
    expect(numeric).toEqual([]);
  });

  it("「项目」行 hover 浮出新建 / 打开项目按钮，点它不许折叠这一行", async () => {
    await render([
      session("root-row-project", {
        isProjectMode: true,
        cwd: "/work/deskwand",
      }),
    ]);

    const row = projectsRow();
    const rowTokens = row.className.split(/\s+/);
    expect(rowTokens).toContain("group/projects");
    expect(rowTokens).toContain("pr-0.5");

    const toggle = projectsToggle();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    // 标签可收缩可截断：多两颗固定 32px 按钮后，英文长文案不许把动作挤出去
    expect(toggle.className.split(/\s+/)).toContain("flex-1");
    expect(toggle.className.split(/\s+/)).toContain("min-w-0");

    const create = projectsRowAction(i18n.t("sidebar.newProject"));
    const open = projectsRowAction(i18n.t("sidebar.openProject"));
    for (const button of [create, open]) {
      const tokens = button.className.split(/\s+/);
      // 24² 尾槽（`size="iconXs"`）—— 为什么不给 32² 见下一条用例
      expect(tokens).toContain("h-6");
      expect(tokens).toContain("w-6");
      expect(tokens).toContain("flex-shrink-0");
      // 静止时藏着，浮出两条路径：鼠标 hover + 键盘把焦点落进行内
      expect(tokens).toContain("opacity-0");
      expect(tokens).toContain("pointer-events-none");
      expect(tokens).not.toContain("opacity-100");
      expect(tokens).toContain("group-hover/projects:opacity-100");
      expect(tokens).toContain("group-hover/projects:pointer-events-auto");
      expect(tokens).toContain("group-focus-within/projects:opacity-100");
    }

    // 这一行恰好三颗按钮，且顺序是：折叠开关 → 新建项目 → 打开已有项目
    //（最右那颗落在与会话行尾部同一条竖线上）
    expect(
      Array.from(projectsRow().querySelectorAll("button")).map((button) =>
        button.getAttribute("aria-label"),
      ),
    ).toEqual([
      i18n.t("sidebar.collapseProjects"),
      i18n.t("sidebar.newProject"),
      i18n.t("sidebar.openProject"),
    ]);

    // 点击不许顺带折叠 / 展开
    await act(async () => create.click());
    await flush();
    await new Promise((resolve) => setTimeout(resolve, 0)); // Radix Presence 延后一帧挂载
    expect(projectsToggle().getAttribute("aria-expanded")).toBe("true");
    expect(
      document.body.querySelector(
        `input[placeholder="${i18n.t("sidebar.projectNamePlaceholder")}"]`,
      ),
      "「新建项目」必须弹出新建项目对话框",
    ).toBeTruthy();
  });

  it("「项目」行的「打开已有项目」走既有的目录选择入口", async () => {
    await render([
      session("root-open-project", {
        isProjectMode: true,
        cwd: "/work/deskwand",
      }),
    ]);

    await act(async () =>
      projectsRowAction(i18n.t("sidebar.openProject")).click(),
    );
    await flush();

    // 新交互：先弹菜单（本地 / 服务器），此时还不该改工作区
    expect(ipc.changeWorkingDir).not.toHaveBeenCalled();
    const localItem = Array.from(
      document.body.querySelectorAll('[role="menu"] button'),
    ).find((button) =>
      button.textContent?.includes(i18n.t("sandbox.ssh.localFolder")),
    );
    expect(localItem, "菜单里必须有「本地目录…」").toBeTruthy();

    await act(async () => (localItem as HTMLElement).click());
    await flush();

    // 本地项仍走 handleSelectProjectDir
    expect(ipc.changeWorkingDir).toHaveBeenCalledTimes(1);
    expect(projectsToggle().getAttribute("aria-expanded")).toBe("true");
  });

  it("「项目」行的两颗按钮是 24² 尾槽：不把分组头撑高，也不离那条基准线", async () => {
    await render([
      session("root-slot-project", {
        isProjectMode: true,
        cwd: "/work/deskwand",
      }),
    ]);

    // 折叠开关自己就是 28px（`py-1` + `leading-5`）。两颗 32px 按钮会把 flex 行顶到
    // 32px，与「最近」那行（28px）差 4px —— 所以这里锁 24² 槽（会话行尾键同档）。
    expect(projectsToggle().className.split(/\s+/)).toContain("py-1");

    const create = projectsRowAction(i18n.t("sidebar.newProject"));
    const open = projectsRowAction(i18n.t("sidebar.openProject"));
    for (const button of [create, open]) {
      const tokens = button.className.split(/\s+/);
      expect(tokens).toContain("h-6");
      expect(tokens).toContain("w-6");
      // 缺省档的垫子不许进场：24² 盒子的宽度下限就是内边距之和（32² 会被挤成 40）
      expect(tokens).not.toContain("px-4");
      expect(tokens).not.toContain("py-2");
      expect(tokens).not.toContain("h-8");
      expect(tokens).not.toContain("w-8");
    }
    // 尾槽向左补 4px：24² 盒里 14px 图标的中心才回到会话行那条基准线上
    // （行右缘到图标中心的距离：32² = 2(pr-0.5) + 16；24² = 2 + 4(mr-1) + 12）
    expect(open.className.split(/\s+/)).toContain("mr-1");
    expect(open.className.split(/\s+/)).not.toContain("-mr-1");
  });
});

describe("Sidebar group expansion persistence", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    localStorage.clear();
    useAppStore.setState(useAppStore.getInitialState(), true);
    container = document.createElement("div");
    document.body.innerHTML = "";
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
  });

  async function render(
    sessions: Session[],
    options: { expandProjects?: boolean } = {},
  ): Promise<void> {
    // 「项目」默认收起后内层项目行不渲染；本文件测的是内层行为，
    // 所以渲染前把外层折叠行播种为展开。只有 3 个「存储值回退」用例需要
    // 保留脏存储，它们传 { expandProjects: false } 并在渲染后点击展开。
    if (options.expandProjects !== false) seedProjectsExpanded();
    await act(async () => {
      useAppStore.setState({ sessions });
      root.render(React.createElement(Sidebar, { width: 280 }));
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  function seedProjectsExpanded(): void {
    let stored: Record<string, unknown> = {};
    try {
      const raw = localStorage.getItem("deskwand.sidebarGroupExpansion");
      const parsed: unknown = raw ? JSON.parse(raw) : {};
      if (parsed && typeof parsed === "object") {
        stored = parsed as Record<string, unknown>;
      }
    } catch {
      // 存储是脏值时从空开始：与 Sidebar.loadGroupExpansion 的回退一致
      stored = {};
    }
    const merged: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(stored)) {
      if (typeof value === "boolean") merged[key] = value;
    }
    merged.__projects__ = true;
    try {
      localStorage.setItem(
        "deskwand.sidebarGroupExpansion",
        JSON.stringify(merged),
      );
    } catch {
      // 存储不可用时保持内存态：与 Sidebar.saveGroupExpansion 一致
    }
  }

  function ordinarySessions(): Session[] {
    return [
      session("ordinary-1", { title: "Ordinary 1", updatedAt: 30 }),
      session("ordinary-2", { title: "Ordinary 2", updatedAt: 20 }),
    ];
  }

  function makeProjectSessions(
    projectName: string,
    count: number,
    updatedAt: number,
  ): Session[] {
    return Array.from({ length: count }, (_, index) =>
      session(`${projectName}-${index + 1}`, {
        title: `${projectName} chat ${index + 1}`,
        isProjectMode: true,
        cwd: `/work/${projectName}`,
        updatedAt: updatedAt - index,
      }),
    );
  }

  function ordinaryToggle(): HTMLButtonElement {
    const button = Array.from(
      container.querySelectorAll("button[aria-expanded]"),
    ).find((candidate) =>
      candidate.textContent?.includes(i18n.t("sidebar.recents")),
    );
    expect(button).toBeTruthy();
    return button as HTMLButtonElement;
  }

  function projectToggle(cwd: string): HTMLButtonElement {
    const header = Array.from(container.querySelectorAll("[title]")).find(
      (element) => element.getAttribute("title") === cwd,
    );
    expect(header).toBeTruthy();
    const section = header?.closest("section");
    expect(section).toBeTruthy();
    const button = section?.querySelector("button[aria-expanded]");
    expect(button).toBeTruthy();
    return button as HTMLButtonElement;
  }

  function projectsToggle(): HTMLButtonElement {
    const button = Array.from(
      container.querySelectorAll("button[aria-expanded]"),
    ).find((candidate) =>
      candidate.textContent?.includes(i18n.t("sidebar.projects")),
    );
    expect(button).toBeTruthy();
    return button as HTMLButtonElement;
  }

  it("defaults the projects row to collapsed and persists its toggle", async () => {
    await render([...makeProjectSessions("proj-a", 1, 500)], {
      expandProjects: false,
    });

    expect(projectsToggle().getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain("proj-a");

    await act(async () => projectsToggle().click());
    expect(projectsToggle().getAttribute("aria-expanded")).toBe("true");

    const stored = JSON.parse(
      localStorage.getItem("deskwand.sidebarGroupExpansion") ?? "{}",
    );
    expect(stored["__projects__"]).toBe(true);
  });

  it("persists expansion state across re-renders", async () => {
    const sessions: Session[] = [
      ...ordinarySessions(),
      ...makeProjectSessions("proj-a", 1, 500),
      ...makeProjectSessions("proj-b", 1, 400),
      ...makeProjectSessions("proj-c", 1, 300),
      ...makeProjectSessions("proj-d", 1, 200),
    ];

    // First render:「最近」默认展开，点两下（收起再展开）写入显式状态；
    // 并收起第 2 个项目
    await render(sessions);
    await act(async () => ordinaryToggle().click());
    await act(async () => ordinaryToggle().click());
    expect(ordinaryToggle().getAttribute("aria-expanded")).toBe("true");

    await act(async () => projectToggle("/work/proj-b").click());
    expect(projectToggle("/work/proj-b").getAttribute("aria-expanded")).toBe(
      "false",
    );

    // Verify localStorage was written
    const stored = JSON.parse(
      localStorage.getItem("deskwand.sidebarGroupExpansion") ?? "{}",
    );
    expect(stored["__ordinary_sessions__"]).toBe(true);
    expect(stored["/work/proj-b"]).toBe(false);

    // Re-render: state should survive
    await render(sessions);
    expect(ordinaryToggle().getAttribute("aria-expanded")).toBe("true");
    expect(projectToggle("/work/proj-b").getAttribute("aria-expanded")).toBe(
      "false",
    );
    // Un-toggled projects should follow default (first 3 expanded)
    expect(projectToggle("/work/proj-a").getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(projectToggle("/work/proj-d").getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("loads persisted expansion state on mount", async () => {
    localStorage.setItem(
      "deskwand.sidebarGroupExpansion",
      JSON.stringify({
        __ordinary_sessions__: true,
        "/work/proj-a": false,
        "/work/proj-b": true,
      }),
    );

    await render([
      ...makeProjectSessions("proj-a", 1, 500),
      ...makeProjectSessions("proj-b", 1, 400),
      ...makeProjectSessions("proj-c", 1, 300),
      ...makeProjectSessions("proj-d", 1, 200),
    ]);

    expect(ordinaryToggle().getAttribute("aria-expanded")).toBe("true");
    expect(projectToggle("/work/proj-a").getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(projectToggle("/work/proj-b").getAttribute("aria-expanded")).toBe(
      "true",
    );
    // proj-c should follow default (3rd project, index < 3 → expanded)
    expect(projectToggle("/work/proj-c").getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("falls back to defaults with invalid JSON", async () => {
    localStorage.setItem("deskwand.sidebarGroupExpansion", "{");

    await render(
      [
        ...makeProjectSessions("proj-a", 1, 500),
        ...makeProjectSessions("proj-b", 1, 400),
        ...makeProjectSessions("proj-c", 1, 300),
        ...makeProjectSessions("proj-d", 1, 200),
      ],
      { expandProjects: false },
    );
    // 脏存储不能被测试播种洗掉，所以渲染后点开「项目」行
    await act(async () => projectsToggle().click());

    expect(ordinaryToggle().getAttribute("aria-expanded")).toBe("true");
    expect(projectToggle("/work/proj-a").getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(projectToggle("/work/proj-d").getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("falls back to defaults with non-object stored value", async () => {
    localStorage.setItem("deskwand.sidebarGroupExpansion", "42");

    await render([...makeProjectSessions("proj-a", 1, 500)], {
      expandProjects: false,
    });
    await act(async () => projectsToggle().click());

    expect(ordinaryToggle().getAttribute("aria-expanded")).toBe("true");
    expect(projectToggle("/work/proj-a").getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("filters non-boolean values from stored data", async () => {
    localStorage.setItem(
      "deskwand.sidebarGroupExpansion",
      JSON.stringify({
        __ordinary_sessions__: "not-a-bool",
        "/work/proj-a": true,
      }),
    );

    await render([...makeProjectSessions("proj-a", 1, 500)], {
      expandProjects: false,
    });
    await act(async () => projectsToggle().click());

    // The string value is filtered out, falls back to default (expanded)
    expect(ordinaryToggle().getAttribute("aria-expanded")).toBe("true");
    // proj-a has a valid boolean → respected
    expect(projectToggle("/work/proj-a").getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("does not alter stored state when localStorage is unavailable", async () => {
    localStorage.clear();
    const originalSetItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = () => {
      throw new Error("Storage full");
    };

    try {
      await render([
        ...ordinarySessions(),
        ...makeProjectSessions("proj-a", 1, 300),
      ]);

      // Should still render and toggle without crashing
      await act(async () => ordinaryToggle().click());
      expect(ordinaryToggle().getAttribute("aria-expanded")).toBe("false");

      await act(async () => ordinaryToggle().click());
      expect(ordinaryToggle().getAttribute("aria-expanded")).toBe("true");
    } finally {
      localStorage.setItem = originalSetItem;
    }
  });
});

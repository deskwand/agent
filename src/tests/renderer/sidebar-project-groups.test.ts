// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../renderer/i18n/config";
import { Sidebar } from "../../renderer/components/Sidebar";
import { useAppStore } from "../../renderer/store";
import type { Session } from "../../renderer/types";

const ipc = vi.hoisted(() => ({
  invoke: vi.fn(),
  deleteSession: vi.fn(),
  archiveSession: vi.fn(),
  getSessionMessages: vi.fn(),
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
  });

  async function render(sessions: Session[]): Promise<void> {
    await act(async () => {
      useAppStore.setState({ sessions });
      root.render(React.createElement(Sidebar, { width: 280 }));
    });
    await flush();
  }

  async function search(value: string): Promise<void> {
    const input = container.querySelector("input");
    expect(input).toBeTruthy();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, value);
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();
  }

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
      candidate.textContent?.includes(i18n.t("sidebar.allSessions")),
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

  function findMenuAction(label: string): HTMLButtonElement | undefined {
    return Array.from(
      sessionMenu().querySelectorAll<HTMLButtonElement>(
        'button[role="menuitem"]',
      ),
    ).find((button) => button.textContent?.trim() === label);
  }

  function menuAction(label: string): HTMLButtonElement {
    const button = findMenuAction(label);
    expect(button).toBeTruthy();
    return button as HTMLButtonElement;
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
    await act(async () => sessionMoreButton(sessionId).click());
    expect(sessionMenu()).toBeTruthy();
  }

  function findButton(text: string): HTMLButtonElement | undefined {
    return Array.from(container.querySelectorAll("button")).find(
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
    await act(async () => ordinaryToggle().click());

    const text = container.textContent ?? "";
    expect(text.indexOf("Ordinary")).toBeLessThan(text.indexOf("deskwand"));
    expect(text.indexOf("deskwand")).toBeLessThan(text.indexOf("Project chat"));
    expect(container.textContent).not.toContain(i18n.t("sidebar.emptyTitle"));
  });

  it("fully collapses and expands ordinary sessions", async () => {
    await render([session("ordinary", { title: "Ordinary chat" })]);

    expect(ordinaryToggle().getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain("Ordinary chat");

    await act(async () => ordinaryToggle().click());
    expect(ordinaryToggle().getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("Ordinary chat");

    await act(async () => ordinaryToggle().click());
    expect(container.textContent).not.toContain("Ordinary chat");
  });

  it("uses primary state icons instead of chevrons for group state", async () => {
    await render([
      session("ordinary", { title: "Ordinary chat" }),
      session("project", {
        title: "Project chat",
        isProjectMode: true,
        cwd: "/work/deskwand",
      }),
    ]);

    const ordinary = ordinaryToggle();
    expect(ordinary.classList.contains("text-text-primary")).toBe(true);
    const collapsedSessionsIcon = ordinary.querySelector(
      ".lucide-message-square",
    ) as SVGElement;
    const expandedSessionsIcon = ordinary.querySelector(
      ".lucide-message-square-text",
    ) as SVGElement;
    expect(collapsedSessionsIcon.classList.contains("text-text-muted")).toBe(
      false,
    );
    expect(collapsedSessionsIcon.style.opacity).toBe("1");
    expect(expandedSessionsIcon.style.opacity).toBe("0");
    expect(ordinary.querySelector(".lucide-chevron-down")).toBeNull();

    await act(async () => ordinary.click());
    expect(collapsedSessionsIcon.style.opacity).toBe("0");
    expect(expandedSessionsIcon.style.opacity).toBe("1");
    expect(
      sessionRow("ordinary").querySelector(
        ".lucide-message-square, .lucide-message-square-text, .lucide-folder, .lucide-folder-open",
      ),
    ).toBeNull();

    const project = projectToggle("/work/deskwand");
    expect(project.classList.contains("text-text-primary")).toBe(true);
    const collapsedProjectIcon = project.querySelector(
      ".lucide-folder",
    ) as SVGElement;
    const expandedProjectIcon = project.querySelector(
      ".lucide-folder-open",
    ) as SVGElement;
    expect(collapsedProjectIcon.classList.contains("text-text-muted")).toBe(
      false,
    );
    const projectCount = Array.from(project.querySelectorAll("span")).find(
      (span) => span.textContent?.trim() === "1",
    );
    expect(projectCount).toBeTruthy();
    expect(projectCount?.classList.contains("text-text-muted")).toBe(false);
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

      animatedTargets.length = 0;
      await search("ordinary");
      expect(animatedTargets).toHaveLength(0);
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

  it("temporarily expands ordinary search results", async () => {
    await render([session("ordinary", { title: "Find sidebar" })]);
    expect(ordinaryToggle().getAttribute("aria-expanded")).toBe("false");

    await search("sidebar");
    expect(ordinaryToggle().getAttribute("aria-expanded")).toBe("true");
    expect(ordinaryToggle().disabled).toBe(true);
    expect(container.textContent).toContain("Find sidebar");

    await search("");
    expect(ordinaryToggle().getAttribute("aria-expanded")).toBe("false");
  });

  it("renders dense project headers with hover-only metadata", async () => {
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

    const count = Array.from(header?.querySelectorAll("span") ?? []).find(
      (element) => element.textContent === "1",
    );
    expect(count?.className).toContain("opacity-0");
    expect(count?.className).toContain("group-hover/project:opacity-100");
  });

  it("pins an ordinary session without selecting it and persists the order", async () => {
    await render([
      session("newer", { title: "Newer", updatedAt: 20 }),
      session("older", { title: "Older", updatedAt: 10 }),
    ]);
    await act(async () => ordinaryToggle().click());

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
    await act(async () => ordinaryToggle().click());

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
    const actionRow = moreButton.parentElement;
    expect(actionRow?.className).toContain("opacity-0");

    await hoverSession("ordinary");
    expect(actionRow?.className).toContain("opacity-100");
    expect(actionRow?.querySelectorAll("button")).toHaveLength(2);
    expect(
      row.querySelector(`button[title="${i18n.t("sidebar.archive")}"]`),
    ).toBeTruthy();
    expect(
      row.querySelector(`button[title="${i18n.t("common.delete")}"]`),
    ).toBeNull();
    expect(actionRow?.parentElement?.className).toContain("w-[4.5rem]");
    expect(moreButton.getAttribute("aria-haspopup")).toBe("menu");
    expect(moreButton.getAttribute("aria-expanded")).toBe("false");

    await act(async () => moreButton.click());
    expect(moreButton.getAttribute("aria-expanded")).toBe("true");
    await act(async () => {
      row.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    });
    expect(actionRow?.className).toContain("opacity-100");
    expect(findSessionMenu()).toBeTruthy();
  });

  it("offers only pinning for a running session", async () => {
    useAppStore.setState({ activeSessionId: "running" });
    await render([session("running", { status: "running" })]);

    const row = sessionRow("running");
    expect(
      row.querySelector(`button[title="${i18n.t("sidebar.archive")}"]`),
    ).toBeNull();

    await openSessionMenu("running");
    expect(menuAction(i18n.t("sidebar.pin"))).toBeTruthy();
    expect(findMenuAction(i18n.t("common.delete"))).toBeUndefined();
  });

  it("keeps archive inline and routes delete through the existing confirmation", async () => {
    useAppStore.setState({ activeSessionId: "ordinary" });
    await render([session("ordinary", { title: "Ordinary" })]);
    await hoverSession("ordinary");

    const archiveButton = sessionRow("ordinary").querySelector(
      `button[title="${i18n.t("sidebar.archive")}"]`,
    ) as HTMLButtonElement;
    expect(archiveButton).toBeTruthy();

    await act(async () => archiveButton.click());
    expect(ipc.archiveSession).not.toHaveBeenCalled();
    expect(archiveButton.title).toBe(i18n.t("common.confirm"));

    await act(async () => archiveButton.click());
    expect(ipc.archiveSession).toHaveBeenCalledWith("ordinary");

    await act(async () => archiveButton.click());
    expect(archiveButton.title).toBe(i18n.t("common.confirm"));
    await openSessionMenu("ordinary");
    expect(archiveButton.title).toBe(i18n.t("sidebar.archive"));

    await act(async () => menuAction(i18n.t("common.delete")).click());
    expect(findSessionMenu()).toBeNull();
    expect(container.textContent).toContain(
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
      document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(findSessionMenu()).toBeNull();

    await openSessionMenu("ordinary");
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(findSessionMenu()).toBeNull();

    await openSessionMenu("ordinary");
    const scrollList = container.querySelector(".sidebar-scroll");
    expect(scrollList).toBeTruthy();
    await act(async () => scrollList?.dispatchEvent(new Event("scroll")));
    expect(findSessionMenu()).toBeNull();

    await openSessionMenu("ordinary");
    await act(async () => window.dispatchEvent(new Event("resize")));
    expect(findSessionMenu()).toBeNull();

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

  it("keeps a project header while filtering sessions by title", async () => {
    await render([
      session("match", {
        title: "Fix sidebar",
        isProjectMode: true,
        cwd: "/work/deskwand",
      }),
      session("miss", {
        title: "Release notes",
        isProjectMode: true,
        cwd: "/work/deskwand",
      }),
    ]);

    await search("sidebar");
    expect(container.querySelector('[title="/work/deskwand"]')).toBeTruthy();
    expect(container.textContent).toContain("Fix sidebar");
    expect(container.textContent).not.toContain("Release notes");
  });

  it("shows the complete group when the project name matches", async () => {
    await render([
      session("one", {
        title: "Fix sidebar",
        isProjectMode: true,
        cwd: "/work/deskwand",
      }),
      session("two", {
        title: "Release notes",
        isProjectMode: true,
        cwd: "/work/deskwand",
      }),
    ]);

    await search("deskwand");
    expect(container.textContent).toContain("Fix sidebar");
    expect(container.textContent).toContain("Release notes");
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
    const row = title?.closest(".group.relative.cursor-pointer");
    expect(row?.textContent).not.toContain("deskwand");

    await search("deskwand");
    const textButtons = Array.from(container.querySelectorAll("button")).filter(
      (button) => button.textContent?.trim() === "deskwand",
    );
    expect(textButtons).toHaveLength(0);
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
    await act(async () => ordinaryToggle().click());

    expect(container.textContent).toContain("Ordinary 5");
    expect(container.textContent).not.toContain("Ordinary 6");

    let showMore = findButton(i18n.t("sidebar.showMoreSessions", { count: 5 }));
    expect(showMore).toBeTruthy();
    expect(showMore?.className).toContain("text-text-muted");
    expect(showMore?.className).toContain("hover:text-text-secondary");
    expect(showMore?.className).toContain("focus-visible:text-text-secondary");
    expect(showMore?.className).toContain("bg-transparent");
    expect(showMore?.className).toContain("hover:bg-transparent");
    expect(showMore?.className).toContain("focus-visible:bg-transparent");
    expect(showMore?.className).not.toContain("text-accent");
    expect(showMore?.className).not.toContain("hover:bg-accent");
    expect(showMore?.className).not.toContain("focus-visible:outline-none");

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

  it("temporarily expands search results and restores the visible count", async () => {
    await render([
      ...makeProjectSessions("deskwand", 12, 500),
      ...makeProjectSessions("project-2", 1, 400),
      ...makeProjectSessions("project-3", 1, 300),
    ]);

    await act(async () =>
      findButton(i18n.t("sidebar.showMoreSessions", { count: 5 }))?.click(),
    );
    expect(projectSection("/work/deskwand").textContent).toContain(
      "deskwand chat 10",
    );
    expect(projectSection("/work/deskwand").textContent).not.toContain(
      "deskwand chat 11",
    );

    await search("deskwand");
    expect(projectSection("/work/deskwand").textContent).toContain(
      "deskwand chat 12",
    );

    await search("");
    expect(projectSection("/work/deskwand").textContent).toContain(
      "deskwand chat 10",
    );
    expect(projectSection("/work/deskwand").textContent).not.toContain(
      "deskwand chat 11",
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
    await act(async () => ordinaryToggle().click());
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
});

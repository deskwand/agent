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
    await render([session("completed", { status: "completed" })]);

    expect(container.querySelector('svg[role="button"]')).toBeNull();
  });

  it("derives the running indicator directly from session status", async () => {
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

  it("shows five ordinary sessions and expands or contracts the overflow", async () => {
    await render(
      Array.from({ length: 7 }, (_, index) =>
        session(`ordinary-${index + 1}`, {
          title: `Ordinary ${index + 1}`,
          updatedAt: 100 - index,
        }),
      ),
    );

    expect(container.textContent).toContain("Ordinary 5");
    expect(container.textContent).not.toContain("Ordinary 6");

    const showMore = Array.from(container.querySelectorAll("button")).find(
      (button) =>
        button.textContent === i18n.t("sidebar.showMoreSessions", { count: 2 }),
    );
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
    expect(container.textContent).toContain("Ordinary 7");

    const showLess = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === i18n.t("sidebar.showLessSessions"),
    );
    await act(async () => showLess?.click());
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

  it("reveals an older active session but allows explicit contraction", async () => {
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

    const showLess = Array.from(
      projectSection("/work/project-4").querySelectorAll("button"),
    ).find(
      (button) => button.textContent === i18n.t("sidebar.showLessSessions"),
    );
    await act(async () => showLess?.click());
    expect(projectSection("/work/project-4").textContent).not.toContain(
      "project-4 chat 7",
    );

    await act(async () => projectToggle("/work/project-4").click());
    expect(projectToggle("/work/project-4").getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("temporarily expands search results and restores manual state", async () => {
    await render([
      ...makeProjectSessions("deskwand", 7, 500),
      ...makeProjectSessions("project-2", 1, 400),
      ...makeProjectSessions("project-3", 1, 300),
    ]);

    const showMore = Array.from(
      projectSection("/work/deskwand").querySelectorAll("button"),
    ).find(
      (button) =>
        button.textContent === i18n.t("sidebar.showMoreSessions", { count: 2 }),
    );
    await act(async () => showMore?.click());
    expect(projectSection("/work/deskwand").textContent).toContain(
      "deskwand chat 7",
    );

    await act(async () => projectToggle("/work/deskwand").click());
    expect(projectToggle("/work/deskwand").getAttribute("aria-expanded")).toBe(
      "false",
    );

    await search("deskwand");
    expect(projectToggle("/work/deskwand").getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(projectSection("/work/deskwand").textContent).toContain(
      "deskwand chat 7",
    );

    await search("");
    expect(projectToggle("/work/deskwand").getAttribute("aria-expanded")).toBe(
      "false",
    );

    await act(async () => projectToggle("/work/deskwand").click());
    expect(projectSection("/work/deskwand").textContent).toContain(
      "deskwand chat 7",
    );
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

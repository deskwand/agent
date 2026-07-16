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
    useAppStore.setState({ sessions });
    await act(async () => {
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

  function projectAction(cwd: string): HTMLButtonElement {
    const header = container.querySelector(`[title="${cwd}"]`);
    expect(header).toBeTruthy();
    const button = header?.querySelector("button");
    expect(button?.getAttribute("aria-label")).toBe(
      i18n.t("sidebar.newSessionForProject"),
    );
    return button as HTMLButtonElement;
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
});

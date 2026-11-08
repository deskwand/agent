// @vitest-environment jsdom
//
// 项目 Bot 在侧栏的落位：项目分组内、会话之前；工具入口在项目行操作区。
// harness 抄自 sidebar-project-groups.test.ts（真的挂 Sidebar + useIPC 桩）。
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../renderer/i18n/config";
import { Sidebar } from "../../renderer/components/Sidebar";
import { useAppStore } from "../../renderer/store";
import { usePersistentAgentStore } from "../../renderer/store/persistent-agents";
import type { Session } from "../../renderer/types";
import type { PersistentAgentView } from "../../shared/persistent-agent";
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

function botView(
  overrides: Partial<PersistentAgentView> = {},
): PersistentAgentView {
  return {
    id: "bot-1",
    name: "瓦力",
    instructions: "",
    cwd: "/w/proj",
    projectKey: "/w/proj",
    sessionId: "bot-session",
    avatarSeed: "seed",
    schedule: { kind: "interval", every: 30, unit: "minute" },
    enabled: true,
    nextPeriodicAt: null,
    consecutiveFailures: 0,
    lastWakeupAt: null,
    lastError: null,
    createdAt: 10,
    updatedAt: 20,
    nextCheckInAt: null,
    checkInNote: null,
    trustedRecipients: [],
    riskyCapabilities: { shell: false, browser: false, computer: false },
    status: "sleeping",
    nextWakeup: null,
    pendingWakeupCount: 0,
    ...overrides,
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("Sidebar · project bot", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    localStorage.clear();
    localStorage.setItem(
      "deskwand.sidebarGroupExpansion",
      JSON.stringify({ __projects__: true }),
    );
    useAppStore.setState(useAppStore.getInitialState(), true);
    usePersistentAgentStore.setState({ agents: {} });
    document.body.innerHTML = "";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    cleanupDialogs();
  });

  async function renderWith(sessions: Session[]): Promise<void> {
    await act(async () => {
      useAppStore.setState({ sessions, pendingAskUsers: {} });
      root.render(React.createElement(Sidebar, { width: 280 }));
    });
    await flush();
  }

  it("renders the bot inside its project group even without sessions", async () => {
    usePersistentAgentStore.setState({ agents: { "bot-1": botView() } });
    await renderWith([]);
    const row = container.querySelector('[data-project-bot="bot-1"]');
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain("瓦力");
    expect(
      row?.closest("[data-project-group]")?.getAttribute("data-project-group"),
    ).toBe("/w/proj");
  });

  it("renders several bots in one project", async () => {
    usePersistentAgentStore.setState({
      agents: {
        "bot-1": botView(),
        "bot-2": botView({
          id: "bot-2",
          name: "文档君",
          sessionId: "bot-session-2",
          createdAt: 20,
        }),
      },
    });
    await renderWith([]);
    const ids = [...container.querySelectorAll("[data-project-bot]")].map(
      (element) => element.getAttribute("data-project-bot"),
    );
    expect(ids).toEqual(["bot-1", "bot-2"]);
  });

  it("offers the create-bot action for a project", async () => {
    await renderWith([session("s1", { cwd: "/w/other", isProjectMode: true })]);
    expect(
      container.querySelector('[data-project-add-bot="/w/other"]'),
    ).not.toBeNull();
  });

  it("lights the projects badge when a bot session is running", async () => {
    localStorage.setItem(
      "deskwand.sidebarGroupExpansion",
      JSON.stringify({ __projects__: false }),
    );
    usePersistentAgentStore.setState({ agents: { "bot-1": botView() } });
    await renderWith([
      session("bot-session", { kind: "agent", status: "running" }),
    ]);
    const projectsRow = [
      ...container.querySelectorAll("button[aria-expanded]"),
    ].find((element) =>
      element.textContent?.includes(i18n.t("sidebar.projects")),
    );
    expect(projectsRow).toBeTruthy();
    expect(projectsRow!.querySelector(".animate-pulse")).not.toBeNull();
  });

  it("keeps the badge dark when the bot is idle", async () => {
    localStorage.setItem(
      "deskwand.sidebarGroupExpansion",
      JSON.stringify({ __projects__: false }),
    );
    usePersistentAgentStore.setState({ agents: { "bot-1": botView() } });
    await renderWith([session("bot-session", { kind: "agent" })]);
    const projectsRow = [
      ...container.querySelectorAll("button[aria-expanded]"),
    ].find((element) =>
      element.textContent?.includes(i18n.t("sidebar.projects")),
    );
    expect(projectsRow).toBeTruthy();
    expect(projectsRow!.querySelector(".animate-pulse")).toBeNull();
  });

  it("hides the create-bot action for the default working directory", async () => {
    await renderWith([
      session("s1", {
        cwd: "/Users/me/Library/Application Support/deskwand/default_working_dir",
        isProjectMode: true,
      }),
    ]);
    expect(container.querySelector("[data-project-add-bot]")).toBeNull();
  });
});

void i18n;

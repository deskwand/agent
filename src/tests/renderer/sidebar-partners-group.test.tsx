// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../renderer/i18n/config";
import i18n from "../../renderer/i18n/config";
import { Sidebar } from "../../renderer/components/Sidebar";
import { useAppStore } from "../../renderer/store";
import { usePersistentAgentStore } from "../../renderer/store/persistent-agents";
import type { Session } from "../../renderer/types";
import type { PersistentAgentView } from "../../shared/persistent-agent";

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

const agentSession: Session = {
  id: "s-agent",
  title: "新闻播报员",
  status: "idle",
  kind: "agent",
  mountedPaths: [],
  allowedTools: [],
  memoryEnabled: false,
  isProjectMode: false,
  createdAt: 1,
  updatedAt: 1,
};

const agent = {
  id: "a1",
  name: "新闻播报员",
  instructions: "",
  cwd: "/tmp",
  sessionId: "s-agent",
  avatarSeed: "seed",
  schedule: { kind: "interval", every: 30, unit: "minute" },
  enabled: true,
  nextPeriodicAt: null,
  nextCheckInAt: null,
  checkInNote: null,
  trustedRecipients: [],
  riskyCapabilities: { shell: false, browser: false, computer: false },
  consecutiveFailures: 0,
  lastWakeupAt: null,
  lastError: null,
  createdAt: 1,
  updatedAt: 1,
  status: "sleeping",
  nextWakeup: null,
  pendingWakeupCount: 0,
} as PersistentAgentView;

describe("Sidebar partners group", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    globalThis.localStorage?.clear?.();
    await i18n.changeLanguage("zh");
    useAppStore.setState(useAppStore.getInitialState(), true);
    useAppStore.setState({ sessions: [agentSession] });
    usePersistentAgentStore.setState({ agents: { a1: agent } });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function rows(): number {
    return container.querySelectorAll("[data-agent-row]").length;
  }

  function header(label: string): HTMLButtonElement {
    const el = container.querySelector(`button[aria-label="${label}"]`);
    expect(el).toBeTruthy();
    return el as HTMLButtonElement;
  }

  it("collapses and expands from the header", async () => {
    await act(async () => root.render(<Sidebar />));
    expect(rows()).toBe(1);
    act(() => header("收起 Bot").click());
    expect(rows()).toBe(0);
    act(() => header("展开 Bot").click());
    expect(rows()).toBe(1);
  });

  it("still collapses while a partner session is open", async () => {
    useAppStore.setState({ activeSessionId: "s-agent" });
    await act(async () => root.render(<Sidebar />));
    expect(rows()).toBe(1);
    act(() => header("收起 Bot").click());
    expect(rows()).toBe(0);
  });
});

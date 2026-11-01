// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../renderer/i18n/config";
import { AgentSessionBar } from "../../renderer/components/agents/AgentSessionBar";
import { AgentWakeupRow } from "../../renderer/components/message/AgentWakeupRow";
import { MessageCard } from "../../renderer/components/MessageCard";
import { usePersistentAgentStore } from "../../renderer/store/persistent-agents";
import { useAppStore } from "../../renderer/store";
import {
  wrapAgentWakeup,
  type PersistentAgentView,
} from "../../shared/persistent-agent";

const api = vi.hoisted(() => ({
  pause: vi.fn(),
  resume: vi.fn(),
  wakeNow: vi.fn(),
  listWakeups: vi.fn(),
  cancelWakeup: vi.fn(),
}));

function view(overrides: Partial<PersistentAgentView> = {}) {
  return {
    id: "a1",
    name: "推特运营",
    instructions: "",
    cwd: "/tmp",
    sessionId: "s1",
    schedule: { kind: "interval", every: 30, unit: "minute" },
    enabled: true,
    nextPeriodicAt: null,
    consecutiveFailures: 0,
    lastWakeupAt: null,
    lastError: null,
    createdAt: 0,
    updatedAt: 0,
    status: "sleeping",
    nextWakeup: null,
    pendingWakeupCount: 0,
    ...overrides,
  } as PersistentAgentView;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  vi.clearAllMocks();
  api.resume.mockResolvedValue(null);
  api.wakeNow.mockResolvedValue(null);
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    persistentAgents: api,
  };
  useAppStore.setState(useAppStore.getInitialState(), true);
  usePersistentAgentStore.setState({ agents: {} });
  await i18n.changeLanguage("zh");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function byLabel(label: string): HTMLButtonElement {
  const el = container.querySelector(`button[aria-label="${label}"]`);
  if (!el) throw new Error(`no button ${label}`);
  return el as HTMLButtonElement;
}

describe("AgentSessionBar", () => {
  it("renders nothing for sessions without an agent", () => {
    act(() => root.render(<AgentSessionBar sessionId="other" />));
    expect(container.innerHTML).toBe("");
  });

  it("resumes a paused agent", () => {
    usePersistentAgentStore.setState({
      agents: { a1: view({ status: "paused", enabled: false }) },
    });
    act(() => root.render(<AgentSessionBar sessionId="s1" />));
    expect(container.querySelector("[data-agent-status]")?.textContent).toBe(
      "已暂停",
    );
    act(() => byLabel("恢复").click());
    expect(api.resume).toHaveBeenCalledWith("a1");
  });

  it("wakes the agent now", () => {
    usePersistentAgentStore.setState({ agents: { a1: view() } });
    act(() => root.render(<AgentSessionBar sessionId="s1" />));
    act(() => byLabel("立即唤醒").click());
    expect(api.wakeNow).toHaveBeenCalledWith("a1");
  });
});

describe("AgentWakeupRow", () => {
  it("renders each line of the body", () => {
    act(() => root.render(<AgentWakeupRow body={"第一行\n第二行"} />));
    const lines = container.querySelectorAll(
      "[data-agent-wakeup] .break-words",
    );
    expect(Array.from(lines).map((l) => l.textContent)).toEqual([
      "第一行",
      "第二行",
    ]);
    expect(container.querySelector("button")).toBeNull();
  });
});

describe("MessageCard agent wakeup", () => {
  function renderUser(text: string) {
    act(() =>
      root.render(
        <MessageCard
          message={{
            id: "m1",
            role: "user",
            sessionId: "s1",
            content: [{ type: "text", text }],
            timestamp: 0,
          }}
          isLatestRound
        />,
      ),
    );
  }

  it("renders a wrapped user message as a wakeup row", () => {
    renderUser(wrapAgentWakeup("[自动唤醒] x"));
    expect(
      container.querySelector("[data-agent-wakeup]")?.textContent,
    ).toContain("[自动唤醒] x");
    expect(container.querySelector(".message-user")).toBeNull();
  });

  it("keeps ordinary user messages as bubbles", () => {
    renderUser("hello");
    expect(container.querySelector("[data-agent-wakeup]")).toBeNull();
    expect(container.querySelector(".message-user")).not.toBeNull();
  });
});

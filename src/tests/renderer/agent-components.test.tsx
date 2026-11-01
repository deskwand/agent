// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../renderer/i18n/config";
import { AgentSidebarGroup } from "../../renderer/components/agents/AgentSidebarGroup";
import { AgentEditModal } from "../../renderer/components/agents/AgentEditModal";
import { useAppStore } from "../../renderer/store";
import { usePersistentAgentStore } from "../../renderer/store/persistent-agents";
import type { PersistentAgentView } from "../../shared/persistent-agent";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));

function view(id: string, overrides: Partial<PersistentAgentView> = {}) {
  return {
    id,
    name: `agent-${id}`,
    instructions: "do things",
    cwd: "/tmp/work",
    sessionId: `s-${id}`,
    schedule: { kind: "interval", every: 30, unit: "minute" },
    enabled: true,
    nextPeriodicAt: null,
    consecutiveFailures: 0,
    lastWakeupAt: null,
    lastError: null,
    createdAt: Number(id),
    updatedAt: 0,
    status: "sleeping",
    nextWakeup: null,
    pendingWakeupCount: 0,
    ...overrides,
  } as PersistentAgentView;
}

let container: HTMLDivElement;
let root: Root;

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

function setInput(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = Object.getPrototypeOf(el) as object;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function button(text: string): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === text,
  );
  if (!found) throw new Error(`button ${text} not found`);
  return found;
}

beforeEach(async () => {
  vi.clearAllMocks();
  api.list.mockResolvedValue([]);
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    persistentAgents: api,
    invoke: vi.fn(),
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

describe("AgentSidebarGroup", () => {
  it("renders one row per agent and opens its session", async () => {
    api.list.mockResolvedValue([view("1"), view("2")]);
    const onOpen = vi.fn();
    act(() =>
      root.render(
        <AgentSidebarGroup
          activeSessionId={null}
          onOpenSession={onOpen}
          onCreate={() => undefined}
        />,
      ),
    );
    await flush();
    const rows = container.querySelectorAll("[data-agent-row]");
    expect(rows).toHaveLength(2);
    act(() => (rows[1] as HTMLButtonElement).click());
    expect(onOpen).toHaveBeenCalledWith("s-2");
  });
});

describe("AgentEditModal", () => {
  it("refuses to save without a name", async () => {
    act(() => root.render(<AgentEditModal onClose={() => undefined} />));
    await flush();
    act(() => button("创建").click());
    await flush();
    expect(api.create).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "请填写",
    );
  });

  it("creates an agent with the default schedule and immediate wakeup", async () => {
    useAppStore.setState({ workingDir: "/tmp/work" });
    api.create.mockResolvedValue(view("9"));
    const onClose = vi.fn();
    act(() => root.render(<AgentEditModal onClose={onClose} />));
    await flush();
    act(() => {
      setInput(document.querySelector("#agent-name")!, "推特运营");
      setInput(document.querySelector("#agent-instructions")!, "运营推特号");
    });
    act(() => button("创建").click());
    await flush();
    expect(api.create).toHaveBeenCalledWith({
      name: "推特运营",
      instructions: "运营推特号",
      cwd: "/tmp/work",
      schedule: { kind: "interval", every: 30, unit: "minute" },
      wakeImmediately: true,
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("deletes the agent together with its session when asked", async () => {
    api.delete.mockResolvedValue(true);
    act(() =>
      root.render(
        <AgentEditModal agent={view("3")} onClose={() => undefined} />,
      ),
    );
    await flush();
    act(() => button("删除").click());
    const checkbox = document.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    act(() => checkbox.click());
    act(() => button("删除").click());
    await flush();
    expect(api.delete).toHaveBeenCalledWith("3", { deleteSession: true });
  });
});

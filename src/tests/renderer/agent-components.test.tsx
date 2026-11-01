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
    avatarSeed: "seed",
    schedule: { kind: "interval", every: 30, unit: "minute" },
    enabled: true,
    nextPeriodicAt: null,
    nextCheckInAt: null,
    checkInNote: null,
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
          expanded
          motionVersion={0}
          onToggle={() => undefined}
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

  function renderGroup(expanded: boolean) {
    const onToggle = vi.fn();
    const onCreate = vi.fn();
    // 挂载时会 list() 一次覆盖 store，所以由 list 返回伙伴
    api.list.mockResolvedValue([view("1")]);
    act(() =>
      root.render(
        <AgentSidebarGroup
          activeSessionId={null}
          expanded={expanded}
          motionVersion={0}
          onToggle={onToggle}
          onOpenSession={() => undefined}
          onCreate={onCreate}
        />,
      ),
    );
    return { onToggle, onCreate };
  }

  it("hides rows when collapsed and toggles from the header", async () => {
    const { onToggle } = renderGroup(false);
    await flush();
    expect(container.querySelectorAll("[data-agent-row]")).toHaveLength(0);
    act(() =>
      (
        container.querySelector(
          'button[aria-label="展开伙伴"]',
        ) as HTMLButtonElement
      ).click(),
    );
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("shows an avatar with a status dot on each row", async () => {
    renderGroup(true);
    await flush();
    const row = container.querySelector("[data-agent-row]")!;
    expect(row.querySelector("img")).not.toBeNull();
    expect(row.querySelector("[data-agent-status-dot]")).not.toBeNull();
  });

  it("create button does not toggle the group", async () => {
    const { onToggle, onCreate } = renderGroup(true);
    await flush();
    act(() =>
      (
        container.querySelector(
          'button[aria-label="新建伙伴"]',
        ) as HTMLButtonElement
      ).click(),
    );
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();
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
      avatarSeed: expect.any(String),
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("shuffles the avatar and saves the new seed", async () => {
    useAppStore.setState({ workingDir: "/tmp/work" });
    api.create.mockResolvedValue(view("9"));
    const uuid = vi
      .spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("seed-1-0000-0000-0000-000000000000")
      .mockReturnValueOnce("seed-2-0000-0000-0000-000000000000");
    act(() => root.render(<AgentEditModal onClose={() => undefined} />));
    await flush();
    const avatar = () =>
      document.querySelector("[data-avatar-preview] img")!.getAttribute("src");
    const before = avatar();
    act(() => button("换一个").click());
    expect(avatar()).not.toBe(before);
    act(() => {
      setInput(document.querySelector("#agent-name")!, "n");
      setInput(document.querySelector("#agent-instructions")!, "i");
    });
    act(() => button("创建").click());
    await flush();
    expect(api.create).toHaveBeenCalledWith(
      expect.objectContaining({
        avatarSeed: "seed-2-0000-0000-0000-000000000000",
      }),
    );
    uuid.mockRestore();
  });

  it("cancel after shuffle keeps the old seed", async () => {
    const onClose = vi.fn();
    act(() =>
      root.render(<AgentEditModal agent={view("3")} onClose={onClose} />),
    );
    await flush();
    act(() => button("换一个").click());
    act(() => button("取消").click());
    expect(onClose).toHaveBeenCalled();
    expect(api.update).not.toHaveBeenCalled();
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

describe("AgentEditModal interval wording", () => {
  it("labels interval as a max interval and explains the fallback", async () => {
    act(() => root.render(<AgentEditModal onClose={() => undefined} />));
    await flush();
    expect(button("最长间隔")).toBeTruthy();
    expect(document.body.textContent).toContain(
      "伙伴会按任务情况自己安排更早的唤醒",
    );
  });
});

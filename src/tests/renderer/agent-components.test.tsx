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
  addToProject: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));

function view(id: string, overrides: Partial<PersistentAgentView> = {}) {
  return {
    id,
    name: `agent-${id}`,
    instructions: "do things",
    cwd: "/tmp/work",
    projectKey: null,
    sessionId: `s-${id}`,
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
          'button[aria-label="展开 Bot"]',
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
          'button[aria-label="新建 Bot"]',
        ) as HTMLButtonElement
      ).click(),
    );
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();
  });

  // 用户报障：「bot 的 + 号不要常驻」。它只是新建入口，不该跟上面的放大镜抢注意力。
  // 判定看类名（jsdom 不结算 CSS）：opacity-0 不可见、pointer-events-none 不接点击，
  // 行 hover 与键盘 focus 时再浮出 —— 后者不写就成了只对鼠标可见的功能。
  it("keeps the create button hidden until the row is hovered or focused", async () => {
    renderGroup(true);
    await flush();
    const create = container.querySelector(
      'button[aria-label="新建 Bot"]',
    ) as HTMLButtonElement;
    expect(create.className).toContain("opacity-0");
    expect(create.className).toContain("pointer-events-none");
    expect(create.className).toContain("group-hover/bot:opacity-100");
    expect(create.className).toContain("group-focus-within/bot:opacity-100");
    expect(
      create.parentElement?.className ?? "",
      "hover-only 靠父级 group/bot 才能生效",
    ).toContain("group/bot");
  });

  // 用户报障：「Bot 的亮度太抢眼了」。两个来源：名字原来继承正文色（比并肩的「最近」
  // 会话行亮一整档），头像的白描线（#fff）在深底上是整块唯一的高亮度色块。
  // 判定看类名（jsdom 不结算 CSS）：名字退到 muted-foreground、当前打开的那行回正文色
  // （与「最近」同一条规则），头像压到 75%。状态文案与标题不动 —— 它们已经在
  // muted-foreground 上，再叠 alpha 会让亮色主题里的 12px 小字掉到 2.2:1。
  it("dims row text and avatar so the group sits behind 最近", async () => {
    api.list.mockResolvedValue([view("1"), view("2")]);
    act(() =>
      root.render(
        <AgentSidebarGroup
          activeSessionId="s-1"
          expanded
          motionVersion={0}
          onToggle={() => undefined}
          onOpenSession={() => undefined}
          onCreate={() => undefined}
        />,
      ),
    );
    await flush();
    const [active, idle] = Array.from(
      container.querySelectorAll("[data-agent-row]"),
    );

    const nameOf = (row: Element, name: string) =>
      Array.from(row.querySelectorAll("span")).find(
        (span) => span.textContent === name,
      )!;
    expect(nameOf(active, "agent-1").className).toContain("text-foreground");
    expect(nameOf(active, "agent-1").className).not.toContain(
      "text-muted-foreground",
    );
    expect(nameOf(idle, "agent-2").className).toContain(
      "text-muted-foreground",
    );
    expect(nameOf(idle, "agent-2").className).not.toContain("text-foreground");

    for (const row of [active, idle]) {
      expect(
        row.querySelector("img")?.className,
        "白描线头像要压到 muted 那一档亮度",
      ).toContain("opacity-75");
    }

    // 状态文案不许叠 alpha：亮色主题里 muted-foreground 已经只余 4.62:1，/70 会掉到 2.2:1。
    const statusClasses = idle.querySelector(".text-xs")!.className.split(" ");
    expect(statusClasses).toContain("text-muted-foreground");
    expect(
      statusClasses.filter((c) => c.includes("muted-foreground/")),
    ).toEqual([]);
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
      schedule: { kind: "interval", every: 30, unit: "minute" },
      wakeImmediately: true,
      avatarSeed: expect.any(String),
      riskyCapabilities: { shell: false, browser: false, computer: false },
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("shows three unchecked risky toggles and sends the chosen ones", async () => {
    useAppStore.setState({ workingDir: "/tmp/work" });
    api.create.mockResolvedValue(view("9"));
    act(() => root.render(<AgentEditModal onClose={() => undefined} />));
    await flush();
    const toggle = (name: string) =>
      document.querySelector(`input[data-risky="${name}"]`) as HTMLInputElement;
    expect(
      ["shell", "browser", "computer"].map((n) => toggle(n).checked),
    ).toEqual([false, false, false]);
    act(() => toggle("shell").click());
    act(() => {
      setInput(document.querySelector("#agent-name")!, "n");
      setInput(document.querySelector("#agent-instructions")!, "i");
    });
    act(() => button("创建").click());
    await flush();
    expect(api.create).toHaveBeenCalledWith(
      expect.objectContaining({
        riskyCapabilities: { shell: true, browser: false, computer: false },
      }),
    );
  });

  it("removes an approved recipient and sends the remaining list", async () => {
    api.update.mockResolvedValue(view("3"));
    act(() =>
      root.render(
        <AgentEditModal
          agent={view("3", { trustedRecipients: ["a@x.com", "b@x.com"] })}
          onClose={() => undefined}
        />,
      ),
    );
    await flush();
    expect(document.body.textContent).toContain("a@x.com");
    const remove = document.querySelector(
      'button[aria-label="移除 a@x.com"]',
    ) as HTMLButtonElement;
    act(() => remove.click());
    expect(document.body.textContent).not.toContain("a@x.com");
    act(() => button("保存").click());
    await flush();
    expect(api.update).toHaveBeenCalledWith(
      "3",
      expect.objectContaining({ trustedRecipients: ["b@x.com"] }),
    );
  });

  it("omits trustedRecipients on save when nothing was removed", async () => {
    api.update.mockResolvedValue(view("3"));
    act(() =>
      root.render(
        <AgentEditModal
          agent={view("3", { trustedRecipients: ["a@x.com"] })}
          onClose={() => undefined}
        />,
      ),
    );
    await flush();
    act(() => button("保存").click());
    await flush();
    const payload = api.update.mock.calls.at(-1)?.[1] as Record<
      string,
      unknown
    >;
    expect("trustedRecipients" in payload).toBe(false);
  });

  it("shuffles the avatar and saves the new seed", async () => {
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

  it("defaults to an auto workspace and submits without cwd", async () => {
    api.create.mockResolvedValue(view("9"));
    act(() => root.render(<AgentEditModal onClose={() => undefined} />));
    await flush();
    expect(document.body.textContent).toContain("自动创建专属工作区");
    act(() => {
      setInput(document.querySelector("#agent-name")!, "n");
      setInput(document.querySelector("#agent-instructions")!, "i");
    });
    act(() => button("创建").click());
    await flush();
    expect(api.create).toHaveBeenCalledWith(
      expect.not.objectContaining({ cwd: expect.anything() }),
    );
  });

  it("submits the picked folder as cwd", async () => {
    api.create.mockResolvedValue(view("9"));
    const invoke = vi.fn().mockResolvedValue("/repo");
    (
      window as unknown as { electronAPI: { invoke: unknown } }
    ).electronAPI.invoke = invoke;
    act(() => root.render(<AgentEditModal onClose={() => undefined} />));
    await flush();
    act(() => button("选择文件夹").click());
    await flush();
    expect(document.body.textContent).toContain("/repo");
    act(() => {
      setInput(document.querySelector("#agent-name")!, "n");
      setInput(document.querySelector("#agent-instructions")!, "i");
    });
    act(() => button("创建").click());
    await flush();
    expect(api.create).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: "/repo" }),
    );
  });

  it("returns to the auto workspace after picking a folder and resetting", async () => {
    api.create.mockResolvedValue(view("9"));
    const invoke = vi.fn().mockResolvedValue("/repo");
    (
      window as unknown as { electronAPI: { invoke: unknown } }
    ).electronAPI.invoke = invoke;
    act(() => root.render(<AgentEditModal onClose={() => undefined} />));
    await flush();
    act(() => button("选择文件夹").click());
    await flush();
    act(() => button("恢复默认").click());
    await flush();
    expect(document.body.textContent).toContain("自动创建专属工作区");
    act(() => {
      setInput(document.querySelector("#agent-name")!, "n");
      setInput(document.querySelector("#agent-instructions")!, "i");
    });
    act(() => button("创建").click());
    await flush();
    expect(api.create).toHaveBeenCalledWith(
      expect.not.objectContaining({ cwd: expect.anything() }),
    );
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

describe("AgentEditModal hides the wake schedule", () => {
  it("shows no wake-schedule controls", async () => {
    act(() => root.render(<AgentEditModal onClose={() => undefined} />));
    await flush();
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("唤醒周期");
    expect(text).not.toContain("最长间隔");
    expect(text).not.toContain("创建后立即唤醒一次");
  });

  it("does not send schedule when saving an existing teammate", async () => {
    api.update.mockResolvedValue(view("3"));
    act(() =>
      root.render(
        <AgentEditModal
          agent={view("3", {
            schedule: { kind: "daily", times: ["09:00"] },
          })}
          onClose={() => undefined}
        />,
      ),
    );
    await flush();
    act(() => button("保存").click());
    await flush();
    const payload = api.update.mock.calls.at(-1)?.[1] as Record<
      string,
      unknown
    >;
    expect("schedule" in payload).toBe(false);
  });

  it("normalizes an old interval teammate to the built-in heartbeat", async () => {
    api.update.mockResolvedValue(view("3"));
    act(() =>
      root.render(
        <AgentEditModal
          agent={view("3", {
            schedule: { kind: "interval", every: 5, unit: "minute" },
          })}
          onClose={() => undefined}
        />,
      ),
    );
    await flush();
    act(() => button("保存").click());
    await flush();
    expect(api.update).toHaveBeenCalledWith(
      "3",
      expect.objectContaining({
        schedule: { kind: "interval", every: 30, unit: "minute" },
      }),
    );
  });
});

describe("AgentEditModal · project cwd", () => {
  it("keeps the project directory read-only and submits through addToProject", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const local = createRoot(host);
    api.addToProject.mockResolvedValue(view("7"));
    act(() =>
      local.render(
        <AgentEditModal projectCwd="/repo/proj" onClose={() => undefined} />,
      ),
    );
    await flush();

    expect(document.body.textContent).toContain("/repo/proj");
    expect(document.body.textContent).not.toContain("选择文件夹");

    act(() => {
      setInput(document.querySelector("#agent-name")!, "瓦力");
      setInput(document.querySelector("#agent-instructions")!, "盯构建");
    });
    const createButton = [...document.querySelectorAll("button")].find(
      (element) => element.textContent?.trim() === "创建",
    )!;
    act(() => createButton.click());
    await flush();

    expect(api.addToProject).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: "/repo/proj", name: "瓦力" }),
    );
    expect(api.create).not.toHaveBeenCalled();

    await act(async () => {
      local.unmount();
    });
    host.remove();
  });
});

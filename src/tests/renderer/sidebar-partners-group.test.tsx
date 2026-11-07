// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../renderer/i18n/config";
import i18n from "../../renderer/i18n/config";
import {
  Sidebar,
  measureScrollGutter,
} from "../../renderer/components/Sidebar";
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

  // 用户报障：「bot 的 + 没有和上面的搜索对齐」。
  // 根因：列表容器 .sidebar-scroll 用 `scrollbar-gutter: stable` 恒留一条滚动条沟槽，
  // 而头部那一行在它**外面** ⇒ 放大镜比列表内容右缘（Bot 行的「+」）多一条滚动条宽。
  it("pads the header by the list's scrollbar gutter so both right edges line up", async () => {
    // jsdom 不结算布局，自己给 .sidebar-scroll 报一个「300 宽 / 289 内容宽」（本机 thin 实测 11px）
    const originals = (["offsetWidth", "clientWidth"] as const).map(
      (name) =>
        [
          name,
          Object.getOwnPropertyDescriptor(HTMLElement.prototype, name),
        ] as const,
    );
    const stub = (name: "offsetWidth" | "clientWidth", value: number) =>
      Object.defineProperty(HTMLElement.prototype, name, {
        configurable: true,
        get(this: HTMLElement) {
          return this.classList.contains("sidebar-scroll") ? value : 0;
        },
      });
    stub("offsetWidth", 300);
    stub("clientWidth", 289);
    try {
      await act(async () => root.render(<Sidebar />));
    } finally {
      // 还原而非 delete：这两个是 jsdom 自己挂在 HTMLElement.prototype 上的访问器，
      // 删掉会让本文件后续用例读到 undefined。
      for (const [name, descriptor] of originals) {
        if (descriptor) {
          Object.defineProperty(HTMLElement.prototype, name, descriptor);
        } else {
          delete (HTMLElement.prototype as unknown as Record<string, unknown>)[
            name as string
          ];
        }
      }
    }
    const head = container.querySelector(
      "[data-sidebar-header]",
    ) as HTMLElement;
    expect(head, "头部那一行需带 data-sidebar-header 才能定位").toBeTruthy();
    // jsdom 会把 calc 里的项重排（实测得到 "calc(11px + 0.75rem)"），所以不钉顺序
    expect(
      head.style.paddingRight,
      "头部的右内边距必须是 px-3 + 列表滚动条沟槽：少补这段，放大镜就比 Bot 行的「+」右出一条滚动条",
    ).toMatch(/^calc\(/);
    expect(head.style.paddingRight).toContain("0.75rem");
    expect(head.style.paddingRight).toContain("11px");
  });
});

describe("measureScrollGutter", () => {
  it("returns the width the scroll container reserves for its scrollbar", () => {
    expect(measureScrollGutter({ offsetWidth: 300, clientWidth: 289 })).toBe(
      11,
    );
  });

  it("never goes negative (overlay scrollbars / element not mounted yet)", () => {
    expect(measureScrollGutter({ offsetWidth: 0, clientWidth: 0 })).toBe(0);
    expect(measureScrollGutter({ offsetWidth: 289, clientWidth: 300 })).toBe(0);
  });
});

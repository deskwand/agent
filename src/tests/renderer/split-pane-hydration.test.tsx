// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaneView } from "../../renderer/components/split/PaneView";
import { useAppStore } from "../../renderer/store";
import type { Session } from "../../renderer/types";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const ipc = vi.hoisted(() => ({
  isElectron: true,
  getSessionMessagesPage: vi.fn(),
  getSessionTraceSteps: vi.fn(),
  respondToPermission: vi.fn(),
  respondToSudoPassword: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

vi.mock("../../renderer/hooks/useIPC", () => ({ useIPC: () => ipc }));

vi.mock("../../renderer/components/ChatView", () => ({
  ChatView: () => <div data-testid="chat" />,
}));

vi.mock("../../renderer/components/WelcomeView", () => ({
  WelcomeView: () => <div data-testid="welcome" />,
}));

function session(id: string): Session {
  return {
    id,
    kind: "ordinary",
    title: id,
    status: "idle",
    mountedPaths: [],
    allowedTools: [],
    memoryEnabled: false,
    isProjectMode: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

let container: HTMLDivElement;
let root: Root;

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function render(sessionId: string | null): Promise<void> {
  await act(async () => {
    root.render(
      <PaneView paneId="P1" sessionId={sessionId} showHeader={false} />,
    );
  });
  await flush();
}

beforeEach(() => {
  ipc.isElectron = true;
  ipc.getSessionMessagesPage.mockReset();
  ipc.getSessionMessagesPage.mockResolvedValue({
    messages: [],
    hasMore: false,
  });
  ipc.getSessionTraceSteps.mockReset();
  ipc.getSessionTraceSteps.mockResolvedValue([]);
  useAppStore.setState({
    sessions: [session("S1"), session("S2")],
    sessionStates: {},
    pendingPermissions: {},
    pendingSudoPasswords: {},
    activeSessionId: null,
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("PaneView history hydration", () => {
  it("未水合的会话触发一次历史与 trace 加载", async () => {
    await render("S1");
    expect(ipc.getSessionMessagesPage).toHaveBeenCalledTimes(1);
    expect(ipc.getSessionMessagesPage).toHaveBeenCalledWith("S1", null, 1000);
    expect(ipc.getSessionTraceSteps).toHaveBeenCalledWith("S1");
    expect(useAppStore.getState().sessionStates.S1?.historyHydrated).toBe(true);
  });

  it("已水合的会话不触发加载", async () => {
    useAppStore.getState().setMessagesTail("S1", [], false);
    useAppStore.getState().setTraceSteps("S1", [
      {
        id: "x",
      } as never,
    ]);
    await render("S1");
    expect(ipc.getSessionMessagesPage).not.toHaveBeenCalled();
  });

  it("空区域不触发加载", async () => {
    await render(null);
    expect(ipc.getSessionMessagesPage).not.toHaveBeenCalled();
  });

  it("切换会话后旧请求的结果被丢弃", async () => {
    let resolveS1: (v: {
      messages: never[];
      hasMore: boolean;
    }) => void = () => {};
    ipc.getSessionMessagesPage.mockImplementation((id: string) =>
      id === "S1"
        ? new Promise((resolve) => {
            resolveS1 = resolve;
          })
        : Promise.resolve({ messages: [], hasMore: false }),
    );
    await render("S1");
    await render("S2");
    expect(useAppStore.getState().sessionStates.S2?.historyHydrated).toBe(true);
    await act(async () => {
      resolveS1({ messages: [], hasMore: false });
    });
    await flush();
    expect(
      useAppStore.getState().sessionStates.S1?.historyHydrated,
    ).toBeFalsy();
  });
});

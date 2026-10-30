// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../renderer/store";
import { useSplitLayoutStore } from "../../renderer/store/split-layout";
import {
  PaneContext,
  useIsFocusedPane,
  usePaneSession,
  usePaneSessionId,
} from "../../renderer/components/split/pane-context";
import type { Session } from "../../renderer/types";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

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

interface Probe {
  sessionId: string | null;
  sessionObjId: string | undefined;
  focused: boolean;
}

let container: HTMLDivElement;
let root: Root;
let probe: Probe;

function Reader(): null {
  probe = {
    sessionId: usePaneSessionId(),
    sessionObjId: usePaneSession()?.id,
    focused: useIsFocusedPane(),
  };
  return null;
}

async function render(node: ReactNode): Promise<void> {
  await act(async () => {
    root.render(node);
  });
}

beforeEach(() => {
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  });
  useAppStore.setState(useAppStore.getInitialState(), true);
  useSplitLayoutStore.setState(useSplitLayoutStore.getInitialState(), true);
  useAppStore.getState().addSession(session("S1"));
  useAppStore.getState().addSession(session("S2"));
  useAppStore.setState({ activeSessionId: "S1" });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("pane-context", () => {
  it("Provider 外回退全局", async () => {
    await render(<Reader />);
    expect(probe.sessionId).toBe("S1");
    expect(probe.sessionObjId).toBe("S1");
    expect(probe.focused).toBe(true);
  });

  it("Provider 内取区域会话", async () => {
    await render(
      <PaneContext.Provider value={{ paneId: "P2", sessionId: "S2" }}>
        <Reader />
      </PaneContext.Provider>,
    );
    expect(probe.sessionId).toBe("S2");
    expect(probe.sessionObjId).toBe("S2");
  });

  it("聚焦判断", async () => {
    useSplitLayoutStore.setState({ focusedPaneId: "P1" });
    await render(
      <PaneContext.Provider value={{ paneId: "P2", sessionId: "S2" }}>
        <Reader />
      </PaneContext.Provider>,
    );
    expect(probe.focused).toBe(false);
    await render(
      <PaneContext.Provider value={{ paneId: "P1", sessionId: "S1" }}>
        <Reader />
      </PaneContext.Provider>,
    );
    expect(probe.focused).toBe(true);
  });
});

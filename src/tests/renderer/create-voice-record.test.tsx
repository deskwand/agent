// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useAppStore } from "../../renderer/store";
import type { Session, ServerEvent } from "../../renderer/types";
const api = vi.hoisted(() => {
  const api = {
    invoke: vi.fn(),
    send: vi.fn(),
    on: vi.fn(),
    config: { get: vi.fn(), isConfigured: vi.fn() },
    getSystemTheme: vi.fn(),
  };
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: api,
  });
  return api;
});
import { useIPC } from "../../renderer/hooks/useIPC";
it("adds an empty persisted voice record exactly once without activating it", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  useAppStore.setState(useAppStore.getInitialState(), true);
  let receive!: (event: ServerEvent) => void;
  api.on.mockImplementation((cb) => {
    receive = cb;
    return () => {};
  });
  api.config.get.mockResolvedValue({});
  api.config.isConfigured.mockResolvedValue(false);
  api.getSystemTheme.mockResolvedValue({ shouldUseDarkColors: false });
  const session: Session = {
    id: "voice",
    kind: "voice",
    title: "New Session",
    status: "idle",
    mountedPaths: [],
    allowedTools: ["web_search"],
    // 与生产一致：语音会话建记录时存 off（见 createVoiceSessionRecord）。
    thinkingLevel: "off",
    memoryEnabled: false,
    isProjectMode: false,
    createdAt: 1,
    updatedAt: 1,
  };
  api.invoke.mockImplementation(async () => {
    receive({ type: "session.create", payload: { session } });
    return session;
  });
  let ipc!: ReturnType<typeof useIPC>;
  function Harness() {
    ipc = useIPC();
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(<Harness />));
    await act(async () => {
      expect(await ipc.createVoiceSession()).toEqual(session);
    });
    expect(api.invoke).toHaveBeenCalledWith({
      type: "session.createVoiceRecord",
      payload: {},
    });
    expect(useAppStore.getState().sessions).toHaveLength(1);
    expect(useAppStore.getState().activeSessionId).toBeNull();
    expect(useAppStore.getState().voiceModeOpen).toBe(false);
    expect(useAppStore.getState().sessionStates.voice.messages).toEqual([]);
    api.invoke.mockResolvedValue(null);
    await act(async () => {
      expect(await ipc.createVoiceSession()).toBeNull();
    });
    expect(useAppStore.getState().sessions).toHaveLength(1);
  } finally {
    await act(async () => root.unmount());
  }
});

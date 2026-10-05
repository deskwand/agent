// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useAppStore } from "../../renderer/store";
import type { ConversationDeps } from "../../renderer/hooks/useVoiceConversation";
const runtime = vi.hoisted(() => ({
  runs: [] as ConversationDeps[],
  stop: vi.fn(),
  close: vi.fn(),
  answer: vi.fn(),
}));
vi.mock("../../renderer/hooks/useReadAloud", () => ({
  stopReadAloud: vi.fn(),
}));
vi.mock("../../renderer/hooks/useStreamingSpeech", () => ({
  createStreamingSpeech: () => ({}),
}));
vi.mock("../../renderer/hooks/useVoiceConversation", () => ({
  createVoiceConversation: (deps: ConversationDeps) => {
    runtime.runs.push(deps);
    return {
      start: async () => {},
      stop: runtime.stop,
      setBlocked: vi.fn(),
      sendAnswerDelta: runtime.answer,
    };
  },
}));
vi.mock("../../renderer/utils/voice/voice-sfx", () => ({
  createVoiceSfx: () => ({ startCue: vi.fn(), exitCue: vi.fn() }),
}));
import { useVoiceMode } from "../../renderer/hooks/useVoiceMode";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  runtime.runs.length = 0;
});
it("stops audio and polling, and rejects callbacks from an older run even when the same record reopens", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.stubGlobal(
    "AudioContext",
    class {
      close = runtime.close;
    },
  );
  useAppStore.setState(useAppStore.getInitialState(), true);
  const store = useAppStore.getState();
  store.addSession({
    id: "V",
    kind: "voice",
    title: "Voice",
    status: "idle",
    mountedPaths: [],
    allowedTools: [],
    memoryEnabled: false,
    isProjectMode: false,
    createdAt: 1,
    updatedAt: 1,
  });
  store.setActiveSession("V");
  store.openVoiceMode("V");
  const send = vi.fn();
  function Harness() {
    useVoiceMode({ sessionId: "V", isCompacting: false, sendQuestion: send });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(<Harness />));
    const old = runtime.runs[0];
    await act(async () => root.render(null));
    expect(runtime.stop).toHaveBeenCalledTimes(1);
    // 退出音要先响完：关闭被延后，不能一卸载就关
    expect(runtime.close).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    expect(runtime.close).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(1200);
    });
    expect(runtime.answer).not.toHaveBeenCalled();
    await act(async () => root.render(<Harness />));
    await act(async () => {
      old.sendQuestion("old run");
      runtime.runs[1].sendQuestion("new run");
    });
    // 宿主还会收到这一轮分配到的 turnId：回答按它归属。
    expect(send).toHaveBeenCalledExactlyOnceWith("new run", expect.any(String));
    store.removeSession("V");
    await act(async () => runtime.runs[1].sendQuestion("deleted"));
    expect(send).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
  }
});

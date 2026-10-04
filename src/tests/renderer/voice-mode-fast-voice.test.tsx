// @vitest-environment jsdom
/**
 * 语音模式的每一句都必须带 `prefer: "matcha"`。
 *
 * 这是把语音模式接上高速音色的**唯一**一处接线，而且断了不会报错：服务层会安静地
 * 回退到朗读的模型，症状只有"又变慢了"。所以钉住它。
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useAppStore } from "../../renderer/store";
import type { StreamingSpeechDeps } from "../../renderer/hooks/useStreamingSpeech";

const runtime = vi.hoisted(() => ({
  speechDeps: [] as StreamingSpeechDeps[],
}));

vi.mock("../../renderer/hooks/useReadAloud", () => ({
  stopReadAloud: vi.fn(),
}));
vi.mock("../../renderer/hooks/useStreamingSpeech", () => ({
  createStreamingSpeech: (deps: StreamingSpeechDeps) => {
    runtime.speechDeps.push(deps);
    return {};
  },
}));
vi.mock("../../renderer/hooks/useVoiceConversation", () => ({
  createVoiceConversation: () => ({
    start: async () => {},
    stop: vi.fn(),
    setBlocked: vi.fn(),
    sendAnswerDelta: vi.fn(),
  }),
}));

import { useVoiceMode } from "../../renderer/hooks/useVoiceMode";

afterEach(() => {
  vi.unstubAllGlobals();
  runtime.speechDeps.length = 0;
});

it("asks for the fast voice on every sentence", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    "AudioContext",
    class {
      close = vi.fn();
    },
  );
  const speak = vi.fn(async () => ({
    ok: true as const,
    samples: new Float32Array(1),
    sampleRate: 16000,
  }));
  vi.stubGlobal("electronAPI", undefined);
  window.electronAPI = { tts: { speak } } as never;

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

  function Harness() {
    useVoiceMode({
      sessionId: "V",
      isCompacting: false,
      sendQuestion: vi.fn(),
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(<Harness />));
    await act(async () => runtime.speechDeps[0].speak("你好。"));
    expect(speak).toHaveBeenCalledExactlyOnceWith("你好。", {
      prefer: "matcha",
    });
  } finally {
    await act(async () => root.unmount());
  }
});

// @vitest-environment jsdom
//
// 音效的接线：什么时候响进入音、什么时候响退出音、AudioContext 什么时候关。
// 声音本身由 voice-sfx.test.ts 管，这里只观察调用与时机。
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../renderer/store";
import type {
  ConversationDeps,
  ConversationState,
} from "../../renderer/hooks/useVoiceConversation";

const runtime = vi.hoisted(() => ({
  deps: null as ConversationDeps | null,
  startCue: vi.fn(),
  exitCue: vi.fn(),
  stop: vi.fn(),
}));

vi.mock("../../renderer/hooks/useReadAloud", () => ({
  stopReadAloud: vi.fn(),
}));
vi.mock("../../renderer/hooks/useStreamingSpeech", () => ({
  createStreamingSpeech: () => ({}),
}));
vi.mock("../../renderer/utils/voice/voice-sfx", () => ({
  createVoiceSfx: () => ({
    startCue: runtime.startCue,
    exitCue: runtime.exitCue,
  }),
}));
vi.mock("../../renderer/hooks/useVoiceConversation", () => ({
  createVoiceConversation: (deps: ConversationDeps) => {
    runtime.deps = deps;
    return {
      start: async () => {},
      stop: runtime.stop,
      setBlocked: vi.fn(),
      sendAnswerDelta: vi.fn(),
      state: () => "calibrating" as const,
    };
  },
}));

import { useVoiceMode } from "../../renderer/hooks/useVoiceMode";

function Harness({ sessionId }: { sessionId: string }) {
  useVoiceMode({ sessionId, isCompacting: false, sendQuestion: vi.fn() });
  return null;
}

describe("useVoiceMode 的音效接线", () => {
  let container: HTMLDivElement;
  let root: Root;
  let mounted: boolean;
  /** 每个 AudioContext 实例各自的 close spy：换会话时要能分清哪个被关了。 */
  let contexts: Array<{ close: ReturnType<typeof vi.fn> }>;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    contexts = [];
    vi.stubGlobal(
      "AudioContext",
      class {
        close = vi.fn(async () => {});
        constructor() {
          contexts.push(this);
        }
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
    container = document.createElement("div");
    root = createRoot(container);
    mounted = true;
    runtime.startCue.mockClear();
    runtime.exitCue.mockClear();
  });

  afterEach(async () => {
    await unmount();
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const mount = async (sessionId = "V") => {
    mounted = true;
    await act(async () => root.render(<Harness sessionId={sessionId} />));
  };

  const unmount = async () => {
    if (!mounted) return;
    mounted = false;
    await act(async () => root.unmount());
  };

  const setState = async (state: ConversationState) => {
    await act(async () => {
      runtime.deps!.onState(state);
    });
  };

  it("麦克风就绪时响一次进入音，之后回到 listening 不再响", async () => {
    await mount();

    await setState("listening");
    expect(runtime.startCue).toHaveBeenCalledTimes(1);

    await setState("capturing");
    await setState("listening");
    await setState("speaking");
    await setState("listening");
    expect(runtime.startCue).toHaveBeenCalledTimes(1);
  });

  it("麦克风没开（blocked）不响；解封后进入 listening 才响一次", async () => {
    await mount();

    await setState("blocked");
    expect(runtime.startCue).not.toHaveBeenCalled();

    await setState("listening");
    expect(runtime.startCue).toHaveBeenCalledTimes(1);
  });

  it("卸载时响退出音，AudioContext 延后 700ms 才关", async () => {
    await mount();

    await unmount();
    expect(runtime.exitCue).toHaveBeenCalledTimes(1);
    expect(contexts[0].close).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(690);
    });
    expect(contexts[0].close).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(20);
    });
    expect(contexts[0].close).toHaveBeenCalledTimes(1);
  });

  it("麦克风启动失败后，即使解封回到 listening 也不响", async () => {
    await mount();

    // 采集失败：状态机先报错，再把状态打成 blocked；解封时会回到 listening
    await act(async () => runtime.deps!.onError("VOICE_CAPTURE_FAILED"));
    await setState("blocked");
    await setState("listening");

    expect(runtime.startCue).not.toHaveBeenCalled();
  });

  it("换会话时只关旧 context，新会话的音频不受影响", async () => {
    await mount("V");
    expect(contexts).toHaveLength(1);

    // 同一个 root 换 sessionId：effect 清理旧的、重建新的 ——
    // 与浮层按 session 重挂载走的是同一条路径（卸载清理 + 新建）。
    await mount("V2");
    expect(contexts).toHaveLength(2);

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    expect(contexts[0].close).toHaveBeenCalledTimes(1);
    expect(contexts[1].close).not.toHaveBeenCalled();
  });
});

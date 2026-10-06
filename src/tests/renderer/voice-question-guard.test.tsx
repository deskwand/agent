// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../renderer/store";
import type { ConversationDeps } from "../../renderer/hooks/useVoiceConversation";
import type { Session } from "../../renderer/types";

const runtime = vi.hoisted(() => ({
  runs: [] as ConversationDeps[],
  setMuted: vi.fn(),
}));

vi.mock("../../renderer/hooks/useVoiceConversation", () => ({
  createVoiceConversation: (deps: ConversationDeps) => {
    runtime.runs.push(deps);
    return {
      start: async () => {},
      stop: vi.fn(),
      setBlocked: vi.fn(),
      setMuted: runtime.setMuted,
      sendAnswerDelta: vi.fn(),
      state: () => "listening",
    };
  },
}));
vi.mock("../../renderer/hooks/useReadAloud", () => ({
  stopReadAloud: vi.fn(),
}));
vi.mock("../../renderer/hooks/useStreamingSpeech", () => ({
  createStreamingSpeech: () => ({
    begin: vi.fn(),
    push: vi.fn(),
    end: vi.fn(),
    stop: vi.fn(),
    onSentence: vi.fn(),
    onDrained: vi.fn(),
    failedCount: () => 0,
  }),
}));
vi.mock("../../renderer/utils/voice/voice-sfx", () => ({
  createVoiceSfx: () => ({ startCue: vi.fn(), exitCue: vi.fn() }),
}));

import { useVoiceMode } from "../../renderer/hooks/useVoiceMode";

function session(id: string, kind: Session["kind"] = "voice"): Session {
  return {
    id,
    kind,
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

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    "AudioContext",
    class {
      close = vi.fn(async () => {});
    },
  );
  runtime.runs.length = 0;
  runtime.setMuted.mockClear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  const store = useAppStore.getState();
  store.addSession(session("V"));
  store.addSession(session("O", "ordinary"));
  store.setActiveSession("V");
  store.openVoiceMode("V");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function Harness({ muted = false }: { muted?: boolean }) {
  const sendQuestion = vi.fn(() => true);
  useVoiceMode({ sessionId: "V", isCompacting: false, muted, sendQuestion });
  return null;
}

describe("后台轮次的守卫", () => {
  it("人在别的会话也收下这一轮", () => {
    act(() => root.render(<Harness />));
    act(() => {
      useAppStore.getState().setActiveSession("O");
    });
    const accepted = runtime.runs[0].sendQuestion("后台的问题");
    expect(accepted).toBe(true);
  });

  it("结束语音之后同样的回调被拒绝", () => {
    act(() => root.render(<Harness />));
    const deps = runtime.runs[0];
    act(() => {
      useAppStore.getState().closeVoiceMode();
    });
    expect(deps.sendQuestion("迟到的问题")).toBe(false);
  });

  it("muted 变化透传到运行时", () => {
    act(() => root.render(<Harness muted={false} />));
    act(() => root.render(<Harness muted />));
    expect(runtime.setMuted).toHaveBeenCalledWith(true);
  });
});

// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "../../renderer/store";
import type { Session } from "../../renderer/types";

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

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
});

describe("语音运行时的最小化标志", () => {
  it("开语音会话时最小化归零", () => {
    const store = useAppStore.getState();
    store.addSession(session("V"));
    store.setVoiceModeMinimized(true);
    store.openVoiceMode("V");
    expect(useAppStore.getState().voiceModeMinimized).toBe(false);
  });

  it("结束运行时最小化也归零", () => {
    const store = useAppStore.getState();
    store.addSession(session("V"));
    store.openVoiceMode("V");
    store.setVoiceModeMinimized(true);
    store.closeVoiceMode();
    expect(useAppStore.getState().voiceModeMinimized).toBe(false);
    expect(useAppStore.getState().voiceModeSessionId).toBeNull();
  });

  it("换语音会话时归零（新会话从全屏开始）", () => {
    const store = useAppStore.getState();
    store.addSession(session("A"));
    store.addSession(session("B"));
    store.openVoiceMode("A");
    store.setVoiceModeMinimized(true);
    store.openVoiceMode("B");
    expect(useAppStore.getState().voiceModeSessionId).toBe("B");
    expect(useAppStore.getState().voiceModeMinimized).toBe(false);
  });

  it("普通会话打不开", () => {
    const store = useAppStore.getState();
    store.addSession(session("O", "ordinary"));
    store.openVoiceMode("O");
    expect(useAppStore.getState().voiceModeOpen).toBe(false);
  });
});

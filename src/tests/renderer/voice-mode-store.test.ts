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
    store.setVoiceModeMuted(true);
    store.openVoiceMode("B");
    expect(useAppStore.getState().voiceModeSessionId).toBe("B");
    expect(useAppStore.getState().voiceModeMinimized).toBe(false);
    // 换会话即归零：与「宿主重建」的既有语义一致
    expect(useAppStore.getState().voiceModeMuted).toBe(false);
  });
  it("普通会话打不开", () => {
    const store = useAppStore.getState();
    store.addSession(session("O", "ordinary"));
    store.openVoiceMode("O");
    expect(useAppStore.getState().voiceModeOpen).toBe(false);
  });
});

describe("语音的静音与迷你字幕", () => {
  it("初值：没在语音会话里时 voiceMiniCaption 为 null、静音为 false", () => {
    expect(useAppStore.getState().voiceMiniCaption).toBeNull();
    expect(useAppStore.getState().voiceModeMuted).toBe(false);
  });

  it("静音与字幕可写可清", () => {
    const store = useAppStore.getState();
    store.setVoiceModeMuted(true);
    store.setVoiceMiniCaption("已静音");
    expect(useAppStore.getState().voiceModeMuted).toBe(true);
    expect(useAppStore.getState().voiceMiniCaption).toBe("已静音");

    store.setVoiceMiniCaption(null);
    expect(useAppStore.getState().voiceMiniCaption).toBeNull();
  });

  it("结束运行时字幕清掉（图标据此消失）", () => {
    const store = useAppStore.getState();
    store.addSession(session("V"));
    store.openVoiceMode("V");
    store.setVoiceMiniCaption("我在说第二段");
    store.closeVoiceMode();
    expect(useAppStore.getState().voiceMiniCaption).toBeNull();
  });
});

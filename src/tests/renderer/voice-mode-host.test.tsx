// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../renderer/store";
import type { ConversationDeps } from "../../renderer/hooks/useVoiceConversation";
import type { Session } from "../../renderer/types";

const runtime = vi.hoisted(() => ({
  runs: [] as ConversationDeps[],
  convs: [] as Array<{
    stop: ReturnType<typeof vi.fn>;
    setMuted: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock("../../renderer/hooks/useVoiceConversation", () => ({
  createVoiceConversation: (deps: ConversationDeps) => {
    const conv = {
      start: async () => {},
      stop: vi.fn(),
      setBlocked: vi.fn(),
      setMuted: vi.fn(),
      sendAnswerDelta: vi.fn(),
      state: () => "listening",
    };
    runtime.runs.push(deps);
    runtime.convs.push(conv);
    return conv;
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
vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));

// 球是 canvas，jsdom 里画不了 —— 这里只关心宿主给了它哪支画笔。
const orb = vi.hoisted(() => ({ brushes: [] as unknown[] }));
vi.mock("../../renderer/components/voice-mode/star-orb", () => ({
  GLOW_BRUSH: { kind: "glow" },
  STARS_BRUSH_LIGHT: { kind: "stars", tag: "light" },
  STARS_BRUSH_DARK: { kind: "stars", tag: "dark" },
  StarOrb: ({ brush }: { brush: unknown }) => {
    orb.brushes.push(brush);
    return <canvas />;
  },
}));

import { VoiceModeHost } from "../../renderer/components/voice-mode/VoiceModeHost";
import {
  STARS_BRUSH_DARK,
  STARS_BRUSH_LIGHT,
} from "../../renderer/components/voice-mode/star-orb";

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
  orb.brushes.length = 0;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    "AudioContext",
    class {
      close = vi.fn(async () => {});
    },
  );
  runtime.runs.length = 0;
  runtime.convs.length = 0;
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

function renderHost() {
  act(() => {
    root.render(<VoiceModeHost sessionId="V" onSendQuestion={() => true} />);
  });
}

describe("VoiceModeHost", () => {
  it("人在语音会话上就画全屏", () => {
    renderHost();
    expect(
      container.querySelector('[data-testid="voice-minimize"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="voice-mini-bar"]'),
    ).toBeNull();
  });

  it("切到别的会话只换成小球，运行时一个也不重启、不停止", () => {
    renderHost();
    expect(runtime.runs.length).toBe(1);
    act(() => {
      useAppStore.getState().setActiveSession("O");
    });
    expect(
      container.querySelector('[data-testid="voice-mini-bar"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="voice-minimize"]'),
    ).toBeNull();
    expect(runtime.runs.length).toBe(1);
    expect(runtime.convs[0].stop).not.toHaveBeenCalled();
  });

  it("切走自动最小化，跳回语音会话自动展开", () => {
    renderHost();
    act(() => {
      useAppStore.getState().setActiveSession("O");
    });
    expect(useAppStore.getState().voiceModeMinimized).toBe(true);
    act(() => {
      useAppStore.getState().setActiveSession("V");
    });
    expect(useAppStore.getState().voiceModeMinimized).toBe(false);
    expect(
      container.querySelector('[data-testid="voice-minimize"]'),
    ).not.toBeNull();
  });

  it("显式最小化后停在语音会话上，不会被立刻弹回全屏", () => {
    renderHost();
    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="voice-minimize"]')!
        .click();
    });
    expect(useAppStore.getState().voiceModeMinimized).toBe(true);
    expect(
      container.querySelector('[data-testid="voice-mini-bar"]'),
    ).not.toBeNull();
  });

  it("切到别的视图（设置）也一样收进小球", () => {
    renderHost();
    act(() => {
      useAppStore.getState().setActiveView("settings");
    });
    expect(useAppStore.getState().voiceModeMinimized).toBe(true);
    expect(
      container.querySelector('[data-testid="voice-mini-bar"]'),
    ).not.toBeNull();
    act(() => {
      useAppStore.getState().setActiveView("chat");
    });
    expect(
      container.querySelector('[data-testid="voice-minimize"]'),
    ).not.toBeNull();
  });

  it("静音按钮切换运行时，图标跟着变", () => {
    renderHost();
    act(() => {
      useAppStore.getState().setActiveSession("O");
    });
    const muteButton = () =>
      container.querySelector<HTMLButtonElement>(
        '[data-testid="voice-mini-mute"]',
      )!;
    expect(muteButton().getAttribute("aria-label")).toBe("voiceMode.muteMic");

    act(() => muteButton().click());
    expect(runtime.convs[0].setMuted).toHaveBeenCalledWith(true);
    expect(muteButton().getAttribute("aria-label")).toBe("voiceMode.unmuteMic");

    act(() => muteButton().click());
    expect(runtime.convs[0].setMuted).toHaveBeenLastCalledWith(false);
  });

  it("主题变化时小球的画笔跟着主题走", () => {
    renderHost();
    // 人在别的会话 → 宿主画小球（在语音会话上时画的是全屏，那支是 GLOW_BRUSH）
    act(() => {
      useAppStore.getState().setActiveSession("O");
    });
    expect(orb.brushes.at(-1)).toBe(STARS_BRUSH_LIGHT);

    act(() => {
      useAppStore.setState((s) => ({
        settings: { ...s.settings, theme: "dark" },
      }));
    });
    expect(orb.brushes.at(-1)).toBe(STARS_BRUSH_DARK);

    act(() => {
      useAppStore.setState((s) => ({
        settings: { ...s.settings, theme: "light" },
      }));
    });
    expect(orb.brushes.at(-1)).toBe(STARS_BRUSH_LIGHT);
  });

  it("system 主题跟随 systemDarkMode", () => {
    renderHost();
    act(() => {
      useAppStore.getState().setActiveSession("O");
    });
    act(() => {
      useAppStore.setState((s) => ({
        settings: { ...s.settings, theme: "system" },
      }));
    });
    act(() => {
      useAppStore.getState().setSystemDarkMode(true);
    });
    expect(orb.brushes.at(-1)).toBe(STARS_BRUSH_DARK);

    act(() => {
      useAppStore.getState().setSystemDarkMode(false);
    });
    expect(orb.brushes.at(-1)).toBe(STARS_BRUSH_LIGHT);
  });

  it("换语音会话时旧运行时被卸载：停麦、换新", () => {
    renderHost();
    act(() => {
      useAppStore.getState().addSession(session("W"));
      useAppStore.getState().openVoiceMode("W");
    });
    // App 用 key = sessionId 重建宿主，这里手写同一条路径
    act(() => {
      root.render(
        <VoiceModeHost key="W" sessionId="W" onSendQuestion={() => true} />,
      );
    });
    expect(runtime.convs[0].stop).toHaveBeenCalledTimes(1);
    expect(runtime.runs.length).toBe(2);
  });
});

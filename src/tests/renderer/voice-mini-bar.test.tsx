// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { VoiceMiniBar } from "../../renderer/components/voice-mode/VoiceMiniBar";
import {
  STARS_BRUSH_DARK,
  STARS_BRUSH_LIGHT,
} from "../../renderer/components/voice-mode/star-orb";
import type { VoiceModeView } from "../../renderer/hooks/useVoiceMode";
import type { OrbBrush } from "../../renderer/components/voice-mode/star-orb";

// 球是 canvas，jsdom 里画不了 —— 这里只关心它拿到的是哪支画笔。
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

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));

const VIEW: VoiceModeView = {
  state: "listening",
  level: 0.2,
  transcript: "",
  answer: "",
  error: null,
};

let container: HTMLDivElement;
let root: Root;
let handlers: {
  onExpand: Mock<() => void>;
  onToggleMute: Mock<() => void>;
  onEnd: Mock<() => void>;
};

beforeEach(() => {
  orb.brushes.length = 0;
  handlers = {
    onExpand: vi.fn<() => void>(),
    onToggleMute: vi.fn<() => void>(),
    onEnd: vi.fn<() => void>(),
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(
  view: Partial<VoiceModeView> = {},
  muted = false,
  brush: OrbBrush = STARS_BRUSH_LIGHT,
) {
  act(() => {
    root.render(
      <VoiceMiniBar
        view={{ ...VIEW, ...view }}
        muted={muted}
        brush={brush}
        onExpand={handlers.onExpand}
        onToggleMute={handlers.onToggleMute}
        onEnd={handlers.onEnd}
      />,
    );
  });
}

function click(testid: string) {
  act(() => {
    container
      .querySelector<HTMLButtonElement>(`[data-testid="${testid}"]`)!
      .click();
  });
}

function caption() {
  return container.querySelector('[data-testid="voice-mini-caption"]')
    ?.textContent;
}

describe("VoiceMiniBar", () => {
  it("听的时候显示你自己的话，点球回全屏", () => {
    render({ state: "listening", transcript: "帮我整理周报" });
    expect(caption()).toBe("帮我整理周报");
    expect(
      container.querySelector('[data-testid="voice-mini-orb"] canvas'),
    ).not.toBeNull();
    click("voice-mini-orb");
    expect(handlers.onExpand).toHaveBeenCalledTimes(1);
  });

  it("想和说的时候显示回答，并去掉 markdown 标记", () => {
    render({ state: "thinking", transcript: "问题", answer: "**上午** 10 点" });
    expect(caption()).toBe("上午 10 点");
  });

  it("识别中优先显示正在说的话", () => {
    render({
      state: "capturing",
      transcript: "说到一半",
      answer: "上一轮的回答",
    });
    expect(caption()).toBe("说到一半");
  });

  it("出错时报错文字优先", () => {
    render({
      state: "listening",
      transcript: "听不清",
      error: "VOICE_MIC_DENIED",
    });
    expect(caption()).toBe("chat.voiceMicDenied");
  });

  it("画笔是透传的：给什么画什么", () => {
    // 小球没有「选画笔」的逻辑（选择在宿主），所以这里只钉透传；
    // 「小球永远不会拿到全屏那支」由 voice-mode-host.test.tsx 守住。
    render({}, false, STARS_BRUSH_LIGHT);
    render({}, false, STARS_BRUSH_DARK);
    expect(orb.brushes).toEqual([STARS_BRUSH_LIGHT, STARS_BRUSH_DARK]);
  });

  it("静音按钮两态，点结束就结束", () => {
    render({}, false);
    expect(
      container
        .querySelector('[data-testid="voice-mini-mute"]')
        ?.getAttribute("aria-label"),
    ).toBe("voiceMode.muteMic");
    click("voice-mini-mute");
    expect(handlers.onToggleMute).toHaveBeenCalledTimes(1);

    render({}, true);
    expect(
      container
        .querySelector('[data-testid="voice-mini-mute"]')
        ?.getAttribute("aria-label"),
    ).toBe("voiceMode.unmuteMic");

    click("voice-mini-end");
    expect(handlers.onEnd).toHaveBeenCalledTimes(1);
  });
});

// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { VoiceMiniBar } from "../../renderer/components/voice-mode/VoiceMiniBar";
import type { VoiceModeView } from "../../renderer/hooks/useVoiceMode";

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

function render(view: Partial<VoiceModeView> = {}, muted = false) {
  act(() => {
    root.render(
      <VoiceMiniBar
        view={{ ...VIEW, ...view }}
        muted={muted}
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

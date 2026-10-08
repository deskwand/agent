// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceMiniButton } from "../../renderer/components/voice-mode/VoiceMiniButton";
import { useAppStore } from "../../renderer/store";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** 预置 store（语音会话开着 + 一行字幕）后渲染 header 那颗图标。 */
function renderButton(caption = "我在说第二段"): void {
  useAppStore.setState({
    voiceModeOpen: true,
    voiceModeMuted: false,
    voiceMiniCaption: caption,
  });
  act(() => {
    root.render(<VoiceMiniButton />);
  });
}

function el(testid: string): HTMLElement {
  return container.querySelector(`[data-testid="${testid}"]`) as HTMLElement;
}

function click(testid: string): void {
  act(() => {
    el(testid).click();
  });
}

function caption(): string | null | undefined {
  return container.querySelector('[data-testid="voice-mini-caption"]')
    ?.textContent;
}

describe("VoiceMiniButton", () => {
  it("没有语音会话时不渲染", () => {
    act(() => root.render(<VoiceMiniButton />));
    expect(
      container.querySelector('[data-testid="voice-mini-widget"]'),
    ).toBeNull();
  });

  it("卡片渲染 store 里那一行字幕，且是下拉的悬停面板", () => {
    renderButton();
    // 字幕规则本身由 voice-caption.test.ts 覆盖；这里只证明它渲染了 store 给的那一行
    expect(caption()).toBe("我在说第二段");

    const card = el("voice-mini-card");
    expect(card.className).toContain("invisible");
    expect(card.className).toContain("group-hover:visible");
    expect(card.className).toContain("top-full");
    // 点击区自己就在拖拽区之外（不靠祖先继承）；层级盖过产物面板 z-50、低于灯箱 z-[100]
    expect(card.className).toContain("titlebar-no-drag");
    expect(card.className).toContain("z-[60]");
  });

  it("系统断点：静音两态读写 store，结束关掉会话", () => {
    renderButton();
    expect(el("voice-mini-mute").getAttribute("aria-label")).toBe(
      "voiceMode.muteMic",
    );
    click("voice-mini-mute");
    expect(useAppStore.getState().voiceModeMuted).toBe(true);
    expect(el("voice-mini-mute").getAttribute("aria-label")).toBe(
      "voiceMode.unmuteMic",
    );

    click("voice-mini-end");
    expect(useAppStore.getState().voiceModeOpen).toBe(false);
  });

  it("点球把浮层叫回来", () => {
    renderButton();
    useAppStore.setState({ voiceModeMinimized: true });
    click("voice-mini-orb");
    expect(useAppStore.getState().voiceModeMinimized).toBe(false);
  });
});

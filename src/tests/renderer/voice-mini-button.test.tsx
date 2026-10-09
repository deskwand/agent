// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceMiniButton } from "../../renderer/components/voice-mode/VoiceMiniButton";
import { useAppStore } from "../../renderer/store";
import type { ConversationState } from "../../renderer/hooks/useVoiceConversation";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));

/** canvas 在 jsdom 里画不了：这里只记录「给了哪支画笔、什么状态、什么电平」。 */
const orb = vi.hoisted(() => ({
  calls: [] as Array<{ tag?: string; state: string; level: number }>,
}));
vi.mock("../../renderer/components/voice-mode/star-orb", () => ({
  GLOW_BRUSH: { kind: "glow", tag: "glow" },
  STARS_BRUSH_LIGHT: { kind: "stars", tag: "light" },
  STARS_BRUSH_DARK: { kind: "stars", tag: "dark" },
  STARS_BRUSH_ICON_LIGHT: { kind: "stars", tag: "icon-light" },
  STARS_BRUSH_ICON_DARK: { kind: "stars", tag: "icon-dark" },
  prefersReducedMotion: () => false,
  StarOrb: ({
    brush,
    state,
    level,
  }: {
    brush: { tag?: string };
    state: string;
    level: number;
  }) => {
    orb.calls.push({ tag: brush.tag, state, level });
    return (
      <canvas
        data-testid="stub-orb"
        data-brush={brush.tag}
        data-state={state}
      />
    );
  },
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  orb.calls.length = 0;
  useAppStore.setState(useAppStore.getInitialState(), true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** 预置 store（语音会话开着 + 一行字幕 + 一个会话状态）后渲染 header 那颗图标。 */
function renderButton(
  caption = "我在说第二段",
  state: ConversationState | null = "listening",
  theme: "light" | "dark" = "light",
): void {
  useAppStore.setState({
    voiceModeOpen: true,
    voiceModeMuted: false,
    voiceMiniCaption: caption,
    voiceMiniState: state,
    settings: { ...useAppStore.getState().settings, theme },
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

/** 图标那个槽位里的球。卡片里那颗要另外从卡片里取。 */
function iconOrb(): HTMLElement | null {
  return el("voice-mini-orb").querySelector('[data-testid="stub-orb"]');
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

  it("图标是那颗星空球（24px 画布、图标档画笔），不再是静态圆点", () => {
    renderButton();
    const slot = el("voice-mini-orb");
    // 24px 画布：球界直径 = 24 * 0.335 * 2 ≈ 16px，正好是换掉的那颗圆点大小
    expect(slot.className).toContain("h-6");
    expect(slot.className).toContain("w-6");
    expect(iconOrb()?.getAttribute("data-brush")).toBe("icon-light");
    // 电平固定 0：麦克风电平刻意留在宿主里，这里不该假装有
    expect(orb.calls[0]?.level).toBe(0);
  });

  it("状态跟着 store 走，静音落到 dimmed 那一档", () => {
    renderButton("我在说", "speaking");
    expect(iconOrb()?.getAttribute("data-state")).toBe("speaking");

    act(() => {
      useAppStore.setState({ voiceMiniState: "muted" });
    });
    // ORB_STATE 把 muted 映到 calibrating（最暗的一档）——复用既有那张表，不另判一套
    expect(iconOrb()?.getAttribute("data-state")).toBe("calibrating");
  });

  it("state 缺失时落到 listening，不崩也不空着", () => {
    renderButton("还在", null);
    expect(iconOrb()?.getAttribute("data-state")).toBe("listening");
  });

  it("深色主题换星点画笔（浅底深粒子、深底浅粒子）", () => {
    renderButton("我在听", "listening", "dark");
    expect(iconOrb()?.getAttribute("data-brush")).toBe("icon-dark");
  });

  it("卡片里那颗球只在指针 / 键盘进到卡片时才挂上，离开就卸掉", () => {
    renderButton();
    const card = el("voice-mini-card");
    // 图标那颗不算：卡片里现在一颗都没有
    expect(card.querySelector('[data-testid="stub-orb"]')).toBeNull();

    act(() => {
      card.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    // 卡片里用 40px 那档画笔（300 颗），62px 画布下才看得见星空
    const inCard = card.querySelector('[data-testid="stub-orb"]');
    expect(inCard?.getAttribute("data-brush")).toBe("light");
    expect(inCard?.getAttribute("data-state")).toBe("listening");

    act(() => {
      card.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    });
    expect(card.querySelector('[data-testid="stub-orb"]')).toBeNull();
  });
});

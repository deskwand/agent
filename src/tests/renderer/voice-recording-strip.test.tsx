// @vitest-environment jsdom
//
// 录音条：卡片内、编辑器上方那一行。它替掉了原来挤在 36px 按钮里的波形 + 计时
// （那会把按钮撑成 80px 胶囊，窄 pane 下把发送键挤出可视区）。
// 采样顺序、保底高度、收尾冻结这几条是从 voice-mic-button.test.tsx 搬来的。

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  shouldShowRecordingStrip,
  VoiceRecordingStrip,
} from "../../renderer/components/VoiceRecordingStrip";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));

let container: HTMLDivElement;
let root: Root;

function render(
  props: Partial<React.ComponentProps<typeof VoiceRecordingStrip>> = {},
) {
  act(() => {
    root.render(
      <VoiceRecordingStrip
        status="recording"
        level={0}
        seconds={0}
        {...props}
      />,
    );
  });
}

const strip = () =>
  container.querySelector('[data-testid="voice-recording-strip"]');
const bars = () =>
  [...container.querySelectorAll('[data-testid="voice-strip-level-bar"]')].map(
    (el) => (el as HTMLElement).style.height,
  );

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("VoiceRecordingStrip", () => {
  it("录音中显示计时、5 条电平与一行提示", () => {
    render({ seconds: 7, level: 0.5 });

    expect(strip()).not.toBeNull();
    expect(container.textContent).toContain("0:07");
    expect(container.textContent).toContain("chat.voiceRecordingHint");
    expect(bars()).toHaveLength(5);
  });

  it("波形是装饰，不进可访问树", () => {
    render({ level: 0.5 });

    const bar = container.querySelector(
      '[data-testid="voice-strip-level-bar"]',
    )!;
    expect(bar.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it("波形取最近 5 个采样：最左最旧，空槽与静音都落在保底高度", () => {
    // 每调一次 render 就是一次重渲染，电平推进一格
    render({ seconds: 4, level: 0.2 });
    render({ seconds: 4, level: 0.6 });
    render({ seconds: 4, level: 0.9 });

    expect(bars()).toEqual(["12%", "12%", "20%", "60%", "90%"]);
  });

  it("波形只留最近 5 个采样：第 6 个进来时最老的那个被挤掉", () => {
    for (const level of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6]) {
      render({ seconds: 4, level });
    }

    // 0.1 已经被挤出去；没有上限的话这里会一直钉在最早那五格，波形看着是冻住的
    expect(bars()).toEqual(["20%", "30%", "40%", "50%", "60%"]);
  });

  it("收尾中条冻住：不再吃新采样，但整行还在，且不再许诺 Esc", () => {
    render({ seconds: 4, level: 0.2 });
    render({ status: "finishing", seconds: 4, level: 0.9 });

    expect(strip()).not.toBeNull();
    // finishing 的那次 0.9 没进去，最后一格仍是 20%
    expect(bars().slice(-1)).toEqual(["20%"]);
    // 收尾中 Esc 不再取消（useVoiceInput 的监听只认 recording / requesting），
    // 与麦克风气泡同一条规矩：不许诺按下去没反应的键。
    expect(container.textContent).not.toContain("chat.voiceRecordingHint");
  });

  it("录满 10 分钟：时间变 5 位也照样显示", () => {
    render({ seconds: 601, level: 0.5 });

    expect(container.textContent).toContain("10:01");
  });

  it("非录音态整个不渲染（不占一行高度）", () => {
    for (const status of ["idle", "requesting"] as const) {
      render({ status });
      expect(strip()).toBeNull();
    }
  });

  it("shouldShowRecordingStrip 只认 recording 与 finishing", () => {
    expect(shouldShowRecordingStrip("recording")).toBe(true);
    expect(shouldShowRecordingStrip("finishing")).toBe(true);
    for (const status of ["idle", "requesting"] as const) {
      expect(shouldShowRecordingStrip(status)).toBe(false);
    }
  });
});

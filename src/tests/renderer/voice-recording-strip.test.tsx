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
        polishing={false}
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

  it("shouldShowRecordingStrip：录音、收尾、整理三个阶段都要在", () => {
    expect(shouldShowRecordingStrip("recording", false)).toBe(true);
    expect(shouldShowRecordingStrip("finishing", false)).toBe(true);
    // 整理发生在 status 已经回到 idle 之后 —— 只看 status 会让条提前消失
    expect(shouldShowRecordingStrip("idle", true)).toBe(true);
    expect(shouldShowRecordingStrip("idle", false)).toBe(false);
    expect(shouldShowRecordingStrip("requesting", false)).toBe(false);
    // requesting 期间引擎正在起、polishing 还没熄：那一刻报"正在整理"是假的
    expect(shouldShowRecordingStrip("requesting", true)).toBe(false);
  });

  it("整理中：条还在，内容是「正在整理文字…」而不是计时", () => {
    // recording → 结束：teardown 会把 seconds / level 清零
    render({ seconds: 4, level: 0.2 });
    render({ status: "idle", polishing: true, seconds: 0, level: 0 });

    expect(strip()).not.toBeNull();
    expect(container.textContent).toContain("chat.voicePolishing");
    // teardown 清零了 seconds；显示 0:00 就是撒谎
    expect(container.textContent).not.toMatch(/\d+:\d\d/);
    // 电平冻在最后一格，不因为 level 归零而塌回保底高度
    expect(bars().slice(-1)).toEqual(["20%"]);
    // 淡化：冻住的电平不该看起来和活着的一样（环的观感同一条规矩，断言类名）
    expect(
      container.querySelector('[data-testid="voice-strip-level-bar"]')!
        .parentElement!.className,
    ).toContain("opacity-45");
  });

  it("整理中不许诺 Esc、也不再吃新采样", () => {
    render({ seconds: 4, level: 0.2 });
    render({ status: "idle", polishing: true, seconds: 0, level: 0 });
    expect(container.textContent).not.toContain("chat.voiceRecordingHint");

    // 整理中又给了新电平（不该被记下）
    render({ status: "idle", polishing: true, seconds: 0, level: 0.95 });
    expect(bars().slice(-1)).toEqual(["20%"]);
  });

  it("录音与整理同时为真时按录音渲染（Esc 提示与计时都回来）", () => {
    render({ status: "recording", polishing: true, seconds: 3, level: 0.4 });

    expect(container.textContent).toContain("0:03");
    expect(container.textContent).toContain("chat.voiceRecordingHint");
  });
});

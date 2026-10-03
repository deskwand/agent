// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceMicButton } from "../../renderer/components/VoiceMicButton";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));

let container: HTMLDivElement;
let root: Root;
const button = () => container.querySelector("button")!;
const buttonByLabel = (label: string) =>
  [...container.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === label,
  );

function render(
  props: Partial<React.ComponentProps<typeof VoiceMicButton>> = {},
) {
  act(() => {
    root.render(
      <VoiceMicButton
        status="idle"
        level={0}
        seconds={0}
        onToggle={() => {}}
        onCancel={() => {}}
        canPolish={false}
        canRevert={false}
        onPolish={() => {}}
        onRevert={() => {}}
        {...props}
      />,
    );
  });
}

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

describe("VoiceMicButton", () => {
  it("空闲态显示开始文案，点击触发 toggle", () => {
    const onToggle = vi.fn();
    render({ onToggle });

    expect(button().getAttribute("aria-label")).toBe("chat.voiceStart");
    act(() => button().click());
    expect(onToggle).toHaveBeenCalled();
  });

  it("录音态显示计时、音量条与取消", () => {
    render({ status: "recording", seconds: 7, level: 0.5 });

    expect(container.textContent).toContain("0:07");
    expect(buttonByLabel("chat.voiceStop")).toBeDefined();
    expect(buttonByLabel("chat.voiceCancel")).toBeDefined();
  });

  it("有转写文本时出现「整理」，整理后变成「还原」", () => {
    const onPolish = vi.fn();
    render({ canPolish: true, onPolish });
    act(() => buttonByLabel("chat.voicePolish")!.click());
    expect(onPolish).toHaveBeenCalled();
  });

  it("整理中：转圈在「整理」按钮上，而不是麦克风上；但麦克风要锁住", () => {
    // 踩过的坑：把 polishing 并进 busy，会让麦克风转圈 —— 但麦克风并没在干活，
    // 用户会以为还在录音。反过来完全不锁也不行：toggle() 只认 idle/recording，
    // 用户会点一个没反应的按钮。
    //
    // 用 aria-label 取麦克风，不用「第一个 button」：整理态下「整理」按钮渲染在
    // 麦克风**前面**，取第一个拿到的是它，断言就失去了意义。
    render({ status: "polishing", canPolish: true });

    const mic = buttonByLabel("chat.voiceStart")!;
    expect(mic.querySelector(".animate-spin")).toBeNull();
    expect(mic.disabled).toBe(true);
    expect(buttonByLabel("chat.voicePolish")!.disabled).toBe(true);
  });

  it("可还原时显示「还原」而不是「整理」", () => {
    render({ canPolish: false, canRevert: true });

    expect(buttonByLabel("chat.voiceRevert")).toBeDefined();
    expect(buttonByLabel("chat.voicePolish")).toBeUndefined();
  });

  it("请求权限与收尾中不允许再点", () => {
    for (const status of ["requesting", "finishing"] as const) {
      render({ status });
      expect(button().disabled).toBe(true);
    }
  });
});

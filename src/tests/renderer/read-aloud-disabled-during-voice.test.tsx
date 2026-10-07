// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "../../renderer/i18n/config";
import { MessageCard } from "../../renderer/components/MessageCard";
import { useAppStore } from "../../renderer/store";
import type { AppConfig, Message } from "../../renderer/types";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const message: Message = {
  id: "m1",
  role: "assistant",
  sessionId: "s1",
  content: [{ type: "text", text: "Hello" }],
  timestamp: Date.now(),
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.localStorage.setItem("i18nextLng", "en");
  useAppStore.setState(useAppStore.getInitialState(), true);
  // 朗读按钮只在能力开关打开时出现（仓库先例：read-aloud-settings.test.tsx）
  useAppStore
    .getState()
    .setAppConfig({ readAloud: { enabled: true } } as AppConfig);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render() {
  act(() => {
    root.render(
      React.createElement(MessageCard, { message, isLatestRound: true }),
    );
  });
}

function readAloudButton() {
  return container.querySelector<HTMLButtonElement>(
    '[data-testid="read-aloud-button"]',
  );
}

describe("语音运行时朗读互斥", () => {
  it("朗读不再有开关：没配 readAloud 也能读", () => {
    // 旧行为是「能力开关关掉就不渲染按钮」；开关已删除，可用性只由文字与模型决定。
    useAppStore.getState().setAppConfig({} as AppConfig);
    render();
    expect(readAloudButton()).not.toBeNull();
    expect(readAloudButton()!.disabled).toBe(false);
  });

  it("语音运行时朗读按钮禁用", () => {
    render();
    expect(readAloudButton()).not.toBeNull();
    expect(readAloudButton()!.disabled).toBe(false);

    act(() => {
      useAppStore.setState({ voiceModeOpen: true });
    });
    expect(readAloudButton()!.disabled).toBe(true);
  });

  it("后台运行（最小化）时同样禁用", () => {
    act(() => {
      useAppStore.setState({
        voiceModeOpen: true,
        voiceModeMinimized: true,
        voiceModeSessionId: "v1",
      });
    });
    render();
    expect(readAloudButton()!.disabled).toBe(true);
  });
});

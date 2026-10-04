// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceModeOverlay } from "../../renderer/components/VoiceModeOverlay";

// 浮层一挂载就会开麦、起朗读。这里只测 UI 行为，把整条语音链路挡掉。
vi.mock("../../renderer/hooks/useVoiceMode", () => ({
  useVoiceMode: () => ({
    state: "listening",
    level: 0.2,
    transcript: "",
    answer: "",
    error: null,
  }),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});

function render(ui: React.ReactElement) {
  act(() => {
    root = createRoot(container);
    root.render(ui);
  });
}

describe("VoiceModeOverlay", () => {
  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <VoiceModeOverlay
        sessionId="s1"
        onClose={onClose}
        isCompacting={false}
        onSendQuestion={vi.fn()}
      />,
    );
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes from the corner button", () => {
    const onClose = vi.fn();
    render(
      <VoiceModeOverlay
        sessionId="s1"
        onClose={onClose}
        isCompacting={false}
        onSendQuestion={vi.fn()}
      />,
    );
    const button = container.querySelector("button");
    expect(button).not.toBeNull();
    act(() => {
      button!.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

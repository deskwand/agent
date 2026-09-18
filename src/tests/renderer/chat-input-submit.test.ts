// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatInput } from "../../renderer/components/ChatInput";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../renderer/hooks/useIPC", () => ({
  useIPC: () => ({ isElectron: false }),
}));

describe("ChatInput submit blocking", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  function editorEl(): HTMLElement {
    return container.querySelector<HTMLElement>("[data-placeholder]")!;
  }

  async function typeText(text: string) {
    const el = editorEl();
    await act(async () => {
      el.textContent = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function pressEnter() {
    await act(async () => {
      editorEl().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
  }

  it("keeps the editor enabled but blocks submit when submitDisabled", async () => {
    const onSubmit = vi.fn();
    await act(async () => {
      root.render(
        React.createElement(ChatInput, {
          onSubmit,
          submitDisabled: true,
          placeholder: "Message",
          cardClassName: "",
          textareaClassName: "",
          bottomSlot: null,
        }),
      );
    });

    expect(editorEl().getAttribute("contenteditable")).toBe("true");

    await typeText("draft");
    await act(async () => {
      container
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("内容为 /compact 时走 compact 回调，不提交", async () => {
    const onSubmit = vi.fn();
    const onCompact = vi.fn();
    await act(async () => {
      root.render(
        React.createElement(ChatInput, {
          onSubmit,
          onCompact,
          placeholder: "Message",
          cardClassName: "",
          textareaClassName: "",
          bottomSlot: null,
        }),
      );
    });

    await typeText("/compact 把上下文收一下");
    await pressEnter();

    expect(onCompact).toHaveBeenCalledWith("把上下文收一下");
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

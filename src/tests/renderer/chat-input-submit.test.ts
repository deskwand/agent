// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChatInput,
  hasInputContent,
} from "../../renderer/components/ChatInput";
import type { ChatInputHandle } from "../../renderer/components/ChatInput";
import type { ElementSelection } from "../../shared/ipc-types";
import { selectedButton } from "../fixtures/element-selection";

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
    localStorage.clear();
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
          draftKey: "test-session",
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

  it("纯元素也是非空草稿", () => {
    expect(hasInputContent("", 0, 0, 1)).toBe(true);
    expect(hasInputContent("", 0, 0, 0)).toBe(false);
  });

  it("拾取结果进入提交数据，clear 后移除磁贴并退订", async () => {
    const original = Object.getOwnPropertyDescriptor(window, "electronAPI");
    let picked!: (selection: ElementSelection) => void;
    const unsubscribe = vi.fn();
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        browser: {
          picker: {
            onSelected: (callback: typeof picked) => {
              picked = callback;
              return unsubscribe;
            },
          },
        },
      },
    });
    const ref = React.createRef<ChatInputHandle>();
    const onSubmit = vi.fn();
    try {
      await act(async () => {
        root.render(
          React.createElement(ChatInput, {
            draftKey: "test-session",
            ref,
            onSubmit,
            placeholder: "Message",
            cardClassName: "",
            textareaClassName: "",
            bottomSlot: null,
          }),
        );
      });
      await act(async () => {
        picked(selectedButton);
      });
      expect(ref.current!.isEmpty()).toBe(false);
      await act(async () => {
        ref.current!.submit();
      });
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ elSelections: [selectedButton] }),
      );
      await act(async () => {
        ref.current!.clear();
      });
      expect(ref.current!.isEmpty()).toBe(true);
      expect(container.textContent).not.toContain("button.primary");
      await act(async () => {
        root.render(null);
      });
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    } finally {
      if (original) Object.defineProperty(window, "electronAPI", original);
      else Reflect.deleteProperty(window, "electronAPI");
    }
  });

  it("内容为 /compact 时走 compact 回调，不提交", async () => {
    const onSubmit = vi.fn();
    const onCompact = vi.fn();
    await act(async () => {
      root.render(
        React.createElement(ChatInput, {
          draftKey: "test-session",
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

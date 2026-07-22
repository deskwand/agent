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

    const textarea = container.querySelector("textarea")!;
    expect(textarea.disabled).toBe(false);

    await act(async () => {
      textarea.value = "draft";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      container
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(textarea.value).toBe("draft");
  });
});

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

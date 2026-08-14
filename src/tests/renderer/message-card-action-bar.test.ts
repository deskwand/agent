// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../renderer/i18n/config";
import { MessageCard } from "../../renderer/components/MessageCard";
import type { Message } from "../../renderer/types";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "m1",
    role: "assistant",
    sessionId: "s1",
    content: [{ type: "text", text: "Hello" }],
    timestamp: Date.now(),
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  // 锁定英文，保证 title 断言稳定（仓库先例：chat-trace-summary-merge.test.ts）
  window.localStorage.setItem("i18nextLng", "en");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderCard(
  message: Message,
  isLatestRound: boolean,
  onForkMessage?: () => void,
) {
  act(() => {
    root.render(
      React.createElement(MessageCard, {
        message,
        isLatestRound,
        onForkMessage,
      }),
    );
  });
}

describe("MessageCard action bar", () => {
  it("hides the action bar for assistant messages that are not the latest round", () => {
    renderCard(makeMessage(), false, vi.fn());
    expect(container.querySelector('[title="Copy message"]')).toBeNull();
    expect(container.querySelector('[title="Fork from here"]')).toBeNull();
  });

  it("shows the action bar for the latest assistant message", () => {
    renderCard(makeMessage(), true, vi.fn());
    expect(container.querySelector('[title="Copy message"]')).not.toBeNull();
    expect(container.querySelector('[title="Fork from here"]')).not.toBeNull();
  });

  it("keeps the action bar for user messages regardless of round", () => {
    renderCard(makeMessage({ id: "u1", role: "user" }), false, vi.fn());
    expect(container.querySelector('[title="Copy message"]')).not.toBeNull();
  });
});

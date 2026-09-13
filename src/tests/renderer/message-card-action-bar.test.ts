// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as fs from "fs";
import * as path from "path";
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
  it("shows copy and fork for assistant messages that are not the latest round", () => {
    renderCard(makeMessage(), false, vi.fn());
    expect(
      container.querySelector('[aria-label="Copy message"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[aria-label="Fork from here"]'),
    ).not.toBeNull();
  });

  it("shows the action bar for the latest assistant message", () => {
    renderCard(makeMessage(), true, vi.fn());
    expect(
      container.querySelector('[aria-label="Copy message"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[aria-label="Fork from here"]'),
    ).not.toBeNull();
  });

  it("keeps the action bar for user messages regardless of round", () => {
    renderCard(makeMessage({ id: "u1", role: "user" }), false, vi.fn());
    expect(
      container.querySelector('[aria-label="Copy message"]'),
    ).not.toBeNull();
  });

  it("excludes tool_result rows from fork (source assertion)", () => {
    // 孤立 tool_result 行渲染会触发 ContentBlockView 在 jsdom 下的 store 循环（既有问题），
    // 此处改用源码断言验证 canFork 排除 tool_result 行。
    const src = fs.readFileSync(
      path.join(__dirname, "../../renderer/components/MessageCard.tsx"),
      "utf-8",
    );
    expect(src).toContain("!isToolResultRow");
  });

  it("hides fork while streaming", () => {
    act(() => {
      root.render(
        React.createElement(MessageCard, {
          message: makeMessage(),
          isLatestRound: true,
          isStreaming: true,
          onForkMessage: vi.fn(),
        }),
      );
    });
    expect(container.querySelector('[aria-label="Fork from here"]')).toBeNull();
  });

  it("hides fork for a queued message", () => {
    renderCard(makeMessage({ localStatus: "queued" }), true, vi.fn());
    expect(container.querySelector('[aria-label="Fork from here"]')).toBeNull();
  });

  it("hides fork for a cancelled message", () => {
    renderCard(makeMessage({ localStatus: "cancelled" }), true, vi.fn());
    expect(container.querySelector('[aria-label="Fork from here"]')).toBeNull();
  });
});

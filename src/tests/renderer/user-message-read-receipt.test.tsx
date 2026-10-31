// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "../../renderer/i18n/config";
import { MessageCard } from "../../renderer/components/MessageCard";
import type { ReadReceiptState } from "../../renderer/utils/message-read";
import type { Message } from "../../renderer/types";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  // 锁英文，保证 aria-label 断言稳定（仓库先例：message-card-action-bar.test.ts）
  window.localStorage.setItem("i18nextLng", "en");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function userMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "u1",
    sessionId: "s1",
    role: "user",
    content: [{ type: "text", text: "hello" }],
    timestamp: Date.now(),
    turnId: "turn-1",
    ...overrides,
  };
}

function render(readState: ReadReceiptState | null, message = userMessage()) {
  act(() => {
    root.render(React.createElement(MessageCard, { message, readState }));
  });
}

describe("user message read receipt", () => {
  it("renders a hollow ring while unread", () => {
    render("unread");
    const ring = container.querySelector('[aria-label="Unread"]');
    expect(ring).not.toBeNull();
    expect(ring?.querySelector("path")).toBeNull();
  });

  it("renders a check ring once read", () => {
    render("read");
    const ring = container.querySelector('[aria-label="Read"]');
    expect(ring).not.toBeNull();
    expect(ring?.querySelector("path")).not.toBeNull();
  });

  it("renders no ring when the state is null", () => {
    render(null);
    expect(container.querySelector('[aria-label="Unread"]')).toBeNull();
    expect(container.querySelector('[aria-label="Read"]')).toBeNull();
  });

  it("keeps the queued status line and draws no ring", () => {
    // 排队消息只有气泡内状态行 —— 环交给真正开跑的那一轮
    render(null, userMessage({ localStatus: "queued" }));
    expect(container.textContent).toContain("Queued");
    expect(container.querySelector('[aria-label="Unread"]')).toBeNull();
  });

  it("keeps the cancelled status line and draws no ring", () => {
    render(null, userMessage({ localStatus: "cancelled" }));
    expect(container.textContent).toContain("Cancelled");
    expect(container.querySelector('[aria-label="Unread"]')).toBeNull();
    expect(container.querySelector('[aria-label="Read"]')).toBeNull();
  });

  it("keeps the copy action reachable next to the ring", () => {
    // 加了环之后动作条不能被挤掉（既有 message-card-action-bar.test.ts 的兜底）
    render("read");
    expect(
      container.querySelector('[aria-label="Copy message"]'),
    ).not.toBeNull();
  });

  it("colors the ring with theme tokens, not the fixed success green", () => {
    // `--success` 是「固定语义层」，8 套主题共用一个绿，在单色聊天区里会跳
    // 出画面。这条锁住：已读/未读都用随主题变的 foreground / muted-foreground。
    const src = readFileSync(
      path.join(
        __dirname,
        "../../renderer/components/message/ReadReceiptRing.tsx",
      ),
      "utf-8",
    );
    expect(src).not.toContain("text-success");
    expect(src).toContain("text-foreground/70");
    expect(src).toContain("text-muted-foreground/75");
  });
});

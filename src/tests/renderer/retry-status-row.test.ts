// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RetryStatusRow } from "../../renderer/components/message/RetryStatusRow";
import { useAppStore } from "../../renderer/store";

const tCalls: Array<[string, unknown]> = [];

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: unknown) => {
      tCalls.push([key, options]);
      return key;
    },
    i18n: { language: "en" },
  }),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  tCalls.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("RetryStatusRow", () => {
  it("renders the retry sentence plus the attempt count", () => {
    act(() => {
      root.render(React.createElement(RetryStatusRow, { attempt: 3 }));
    });

    expect(tCalls).toContainEqual(["messageCard.retrying", undefined]);
    expect(tCalls).toContainEqual(["messageCard.retryAttempt", { count: 3 }]);
    // 次数单独成一个等宽 span，便于视觉上与正文区分
    expect(container.querySelector("span.font-mono")?.textContent).toBe(
      "messageCard.retryAttempt",
    );
  });
});

describe("setSessionRetry", () => {
  it("stores retry state per session and clears it on end", () => {
    const { setSessionRetry } = useAppStore.getState();
    act(() => {
      setSessionRetry("s1", { active: true, attempt: 3 });
      setSessionRetry("s2", { active: true, attempt: 1 });
    });
    expect(useAppStore.getState().sessionStates.s1.retry).toEqual({
      active: true,
      attempt: 3,
    });
    expect(useAppStore.getState().sessionStates.s2.retry).toEqual({
      active: true,
      attempt: 1,
    });

    act(() => {
      setSessionRetry("s1", { active: false, attempt: 3 });
    });
    expect(useAppStore.getState().sessionStates.s1.retry).toEqual({
      active: false,
      attempt: 3,
    });
    // 另一个会话不受影响
    expect(useAppStore.getState().sessionStates.s2.retry.active).toBe(true);
  });
});

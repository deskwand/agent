// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProcessSummaryBlock } from "../../renderer/components/message/ProcessSummaryBlock";
import { useAppStore } from "../../renderer/store";
import type { Message } from "../../renderer/types";
import { buildProcessSummaryDisplayBlock } from "../../renderer/utils/tool-display-blocks";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.count === undefined ? key : `${key}:${options.count}`,
    i18n: { language: "en" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const SESSION_ID = "trigger-label-session";
const NO_MESSAGES: Message[] = [];

const BLOCK = buildProcessSummaryDisplayBlock([
  { type: "tool_use", id: "b1", name: "bash", input: { command: "rg foo" } },
  { type: "tool_use", id: "b2", name: "bash", input: { command: "ls" } },
]);

describe("process summary trigger label", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    useAppStore.setState({
      sessionStates: { [SESSION_ID]: { messages: NO_MESSAGES } },
    } as never);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(triggerLabel?: { text: string; mono: boolean }): void {
    act(() => {
      root.render(
        createElement(ProcessSummaryBlock, { block: BLOCK, triggerLabel }),
      );
    });
  }

  it("不传 triggerLabel 时仍是聚合片段（转录侧零变化）", () => {
    render();
    expect(container.textContent).toContain("tool.grouped.executedCommands");
    expect(
      container.querySelector('[data-testid="summary-trigger-label"]'),
    ).toBeNull();
  });

  it("传了 triggerLabel 就替代聚合片段，只有一个文案节点", () => {
    render({ text: "查看目录内容", mono: false });
    expect(container.textContent).toContain("查看目录内容");
    expect(container.textContent).not.toContain(
      "tool.grouped.executedCommands",
    );
    expect(
      container.querySelectorAll('[data-testid="summary-trigger-label"]'),
    ).toHaveLength(1);
  });

  it("文案是唯一可收缩项：单行省略，且不参与固定宽度", () => {
    render({ text: "curl -s https://x.dev", mono: true });
    const node = container.querySelector<HTMLElement>(
      '[data-testid="summary-trigger-label"]',
    );
    expect(node?.className).toContain("font-mono");
    expect(node?.className).toContain("min-w-0");
    expect(node?.className).toContain("overflow-hidden");
    expect(node?.className).toContain("text-ellipsis");
    expect(node?.className).toContain("whitespace-nowrap");
    expect(node?.className).not.toContain("flex-shrink-0");
    expect(node?.className).not.toContain("flex-none");
  });
});

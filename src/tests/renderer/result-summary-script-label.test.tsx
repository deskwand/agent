// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ResultSummaryBlock } from "../../renderer/components/message/ResultSummaryBlock";
import i18n from "../../renderer/i18n/config";
import { useAppStore } from "../../renderer/store";
import type { DisplayBlock } from "../../renderer/utils/tool-display-blocks";
import type { Message } from "../../renderer/types";

const child = (id: string, parentToolCallId: string, code: string) => ({
  id,
  type: "tool_use" as const,
  name: "write",
  input: { file_path: `/tmp/${id}.ts`, content: "x" },
  trace: {
    parentToolCallId,
    status: "ok" as const,
    parentStatus: "ok" as const,
    complete: true,
    source: "final" as const,
    script: { id: parentToolCallId, input: { code } },
  },
});

describe("ResultSummaryBlock 脚本行标题", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(async () => {
    await i18n.changeLanguage("zh");
  });

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    useAppStore.setState(useAppStore.getInitialState(), true);
    useAppStore.setState({
      sessionStates: {
        s1: {
          historyHydrated: true,
          hasMoreOlder: false,
          oldestMessageId: null,
          messages: [],
          partialByTurn: {},
          partialMessage: "",
          partialThinking: "",
          pendingTurns: [],
          activeTurn: null,
          executionClock: { startAt: null, endAt: null },
          traceSteps: [],
          contextWindow: 0,
          compaction: { status: "idle" },
          retry: { active: false, attempt: 0 },
          inputQueue: [],
          steerRecords: [],
          partialToolResults: {},
          backgroundAgents: [],
          subagentActivities: {},
          currentTodos: null,
          lastNonEmptyTodos: null,
          currentPlanDone: false,
          lastPlanDone: false,
        },
      },
    } as never);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function renderBlock(
    items: unknown[],
    scripts: { id: string; input: Record<string, unknown> }[],
  ) {
    const block = {
      type: "result-summary",
      items,
      summary: { editedFiles: 0, writtenFiles: items.length },
      files: [],
      scripts,
    } as Extract<DisplayBlock, { type: "result-summary" }>;
    const message: Message = {
      id: "m1",
      sessionId: "s1",
      role: "assistant",
      timestamp: 1,
      content: items as never,
    };
    act(() =>
      root.render(
        createElement(ResultSummaryBlock, {
          block,
          allBlocks: items as never,
          message,
        }),
      ),
    );
    act(() => {
      container
        .querySelector<HTMLButtonElement>("button[aria-expanded]")
        ?.click();
    });
  }

  it("两个脚本各自显示自己的意图", () => {
    const items = [
      child("w1", "s1", "// 写入价格表\nconst a = 1"),
      child("w2", "s2", "// 写入对比结论\nconst b = 1"),
    ];
    renderBlock(items, [
      { id: "s1", input: { code: "// 写入价格表\nconst a = 1" } },
      { id: "s2", input: { code: "// 写入对比结论\nconst b = 1" } },
    ]);

    const labels = [...container.querySelectorAll("[data-script-row]")].map(
      (el) => el.textContent?.trim(),
    );
    expect(labels).toEqual(["写入价格表", "写入对比结论"]);
    expect(container.textContent).not.toContain(
      i18n.t("tool.grouped.scriptDetails"),
    );
  });

  it("零子调用的脚本不算「1 步」", () => {
    const selfParent = {
      id: "s1",
      type: "tool_use" as const,
      name: "codemode",
      input: { code: "const a = 1" },
      trace: {
        parentToolCallId: "s1",
        status: "unfinished" as const,
        parentStatus: "unfinished" as const,
        complete: false,
        source: "missing" as const,
        script: { id: "s1", input: { code: "const a = 1" } },
      },
    };
    renderBlock([selfParent], [{ id: "s1", input: { code: "const a = 1" } }]);
    expect(container.querySelector("[data-script-row]")?.textContent).toBe(
      i18n.t("tool.grouped.scriptDetails"),
    );
  });

  it("没有意图注释时按步数区分", () => {
    const items = [
      child("w1", "s1", "const a = 1"),
      child("w2", "s2", "const b = 1"),
      child("w3", "s2", "const b = 2"),
    ];
    renderBlock(items, [
      { id: "s1", input: { code: "const a = 1" } },
      { id: "s2", input: { code: "const b = 1" } },
    ]);

    const labels = [...container.querySelectorAll("[data-script-row]")].map(
      (el) => el.textContent?.trim(),
    );
    expect(labels).toEqual([
      i18n.t("tool.step.scriptSteps", { count: 1 }),
      i18n.t("tool.step.scriptSteps", { count: 2 }),
    ]);
  });
});

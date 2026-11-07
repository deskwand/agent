// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProcessSummaryBlock } from "../../renderer/components/message/ProcessSummaryBlock";
import i18n from "../../renderer/i18n/config";
import { useAppStore } from "../../renderer/store";
import type { ProcessSummaryDisplayBlock } from "../../renderer/utils/tool-display-blocks";
import type { Message } from "../../renderer/types";

const block = {
  type: "process-summary",
  items: [
    {
      id: "call-1",
      type: "tool_use",
      name: "Agent",
      input: { subagent_type: "Explore", description: "find bug" },
    },
  ],
  summary: {
    readCount: 0,
    hasSearch: false,
    hasWebSearch: false,
    hasBrowse: false,
    hasMemory: false,
    commandCount: 0,
    subagentCount: 1,
    subagents: [{ name: "Explore", description: "find bug" }],
    hasGoal: false,
    usedToolCount: 0,
  },
} as unknown as ProcessSummaryDisplayBlock;

// 展开后 PSB 会渲染 ToolUseBlock，而它要读会话状态（既有实现用 `?? []` 兜底，
// 未提供 message/会话时会每帧产生新数组 → 无限重渲染）。所以这里按既有测试的
// 方式把 message 与最小会话状态备好，而不是去动那段既有代码。
const message: Message = {
  id: "m1",
  sessionId: "s1",
  role: "assistant",
  timestamp: 1,
  content: block.items,
};

describe("ProcessSummaryBlock highlight and expand", () => {
  let container: HTMLDivElement;
  let root: Root;
  const scrollIntoViewSpy = vi.fn();

  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    // jsdom 没有 scrollIntoView；失败跳转的 ref 滚动要能被观测。
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: scrollIntoViewSpy,
    });
    scrollIntoViewSpy.mockClear();
    await i18n.changeLanguage("zh");
    useAppStore.setState(useAppStore.getInitialState(), true);
    useAppStore.setState({
      sessionStates: {
        s1: {
          historyHydrated: true,
          hasMoreOlder: false,
          oldestMessageId: null,
          messages: [message],
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
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(): void {
    act(() =>
      root.render(
        createElement(ProcessSummaryBlock, {
          block,
          allBlocks: block.items,
          message,
        }),
      ),
    );
  }

  it("转录里的摘要行仍整行可点（触发器与片段保持 flex-1）", () => {
    // 不传 compactHeader —— 与 MessageCard / ChatView 的用法一致。
    // 坞里为了紧凑把头改成按内容宽，这条钉的是"别顺手把转录也改了"：
    // 一旦转录的触发按钮不再拉伸，整行 hover 与点击热区就只剩文字那么宽。
    render();
    const trigger = container.querySelector("button[aria-expanded]");
    expect(trigger?.className).toContain("flex-1");
    expect(trigger?.firstElementChild?.className).toContain("flex-1");
  });

  it("命中待展开时自动展开并消费掉，高亮时摘要行带 ring", () => {
    useAppStore.setState({ pendingExpandToolCallId: "call-1" });
    render();

    // 摘要行自己的 aria-expanded 就是展开态。不要数 button：卡片里以后可能多出按钮。
    const summaryButton = container.querySelector("button[aria-expanded]");
    expect(summaryButton?.getAttribute("aria-expanded")).toBe("true");
    // 一次性消费：字段被清空
    expect(useAppStore.getState().pendingExpandToolCallId).toBeNull();

    act(() => {
      useAppStore.setState({ highlightedToolCallId: "call-1" });
    });
    expect(container.querySelector(".ring-2")).not.toBeNull();
  });

  it("不命中时不展开、也不带 ring", () => {
    useAppStore.setState({ pendingExpandToolCallId: "other" });
    render();

    const summaryButton = container.querySelector("button[aria-expanded]");
    expect(summaryButton?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".ring-2")).toBeNull();
    // 没被消费：留着给真正命中的那条
    expect(useAppStore.getState().pendingExpandToolCallId).toBe("other");
  });

  it("折叠态不再显示失败提示，外部高亮请求仍展开并定位首个失败子项", () => {
    const failedBlock = {
      ...block,
      items: [
        {
          type: "tool_use" as const,
          id: "child",
          name: "read",
          input: {},
          trace: {
            parentToolCallId: "p",
            status: "error" as const,
            parentStatus: "ok" as const,
            complete: true,
            source: "final" as const,
          },
        },
      ],
      status: {
        running: false,
        failed: true,
        failedCount: 1,
        unfinished: false,
        unavailable: false,
        firstFailedToolCallId: "child",
      },
    } as unknown as ProcessSummaryDisplayBlock;

    act(() =>
      root.render(
        createElement(ProcessSummaryBlock, {
          block: failedBlock,
          message: { ...message, content: failedBlock.items },
          allBlocks: failedBlock.items,
        }),
      ),
    );

    // 提示条整条移除（2026-10-10 决定）：折叠态既不显示失败标签，也没有任何失败按钮。
    expect(container.textContent).not.toContain(
      i18n.t("tool.grouped.failedOperations"),
    );
    expect(container.querySelector("[data-tool-group-failure]")).toBeNull();
    expect(
      container
        .querySelector("button[aria-expanded]")
        ?.getAttribute("aria-expanded"),
    ).toBe("false");

    // 外部高亮请求（从活动面板 / 后台代理列表点进来）仍然展开、一次性消费并把失败子项滚进视野。
    act(() => useAppStore.getState().highlightToolCallId("child"));
    expect(
      container
        .querySelector("button[aria-expanded]")
        ?.getAttribute("aria-expanded"),
    ).toBe("true");
    expect(useAppStore.getState().pendingExpandToolCallId).toBeNull();
    expect(useAppStore.getState().highlightedToolCallId).toBe("child");
    // 失败条目由 ref 滚进视野，而不是 querySelector 查业务 DOM。
    expect(scrollIntoViewSpy).toHaveBeenCalled();
  });

  it("组内每个调用是一行，行间分隔靠容器（不是一堆卡片）", () => {
    const items = [
      {
        id: "c1",
        type: "tool_use" as const,
        name: "bash",
        input: { command: "ls" },
      },
      {
        id: "c2",
        type: "tool_use" as const,
        name: "read",
        input: { file_path: "/tmp/b.ts" },
      },
    ];
    const twoItemBlock = {
      type: "process-summary",
      items,
      summary: {
        ...block.summary,
        subagentCount: 0,
        subagents: [],
        commandCount: 1,
        readCount: 1,
      },
    } as unknown as ProcessSummaryDisplayBlock;

    act(() =>
      root.render(
        createElement(ProcessSummaryBlock, {
          block: twoItemBlock,
          allBlocks: items,
          message: { ...message, content: items },
        }),
      ),
    );
    act(() => {
      container
        .querySelector<HTMLButtonElement>("button[aria-expanded]")
        ?.click();
    });

    expect(container.querySelectorAll("[data-tool-step]").length).toBe(2);
    const card = container.querySelector("[data-tool-group-card]");
    expect(card).not.toBeNull();
    expect(card?.className).toContain("[&>*+*]:border-t");
  });

  it("命中被投影掉的父脚本 ID 时也展开脚本详情并高亮", () => {
    const scriptBlock = {
      ...block,
      items: [],
      summary: { ...block.summary, subagentCount: 0, subagents: [] },
      scripts: [{ id: "script-1", input: { code: "1 + 1" } }],
    } as unknown as ProcessSummaryDisplayBlock;

    useAppStore.setState({ pendingExpandToolCallId: "script-1" });
    act(() =>
      root.render(
        createElement(ProcessSummaryBlock, {
          block: scriptBlock,
          message,
          allBlocks: [],
        }),
      ),
    );

    expect(
      container
        .querySelector("button[aria-expanded]")
        ?.getAttribute("aria-expanded"),
    ).toBe("true");
    expect(useAppStore.getState().pendingExpandToolCallId).toBeNull();
    expect(container.textContent).toContain(
      i18n.t("tool.grouped.scriptDetails"),
    );
    // 脚本折叠行与工具行同一档内缩（坞与转录共用这张卡片，改一半会错位）
    expect(
      container.querySelector("[data-tool-group-card] > div")?.className,
    ).toContain("px-4");

    act(() => {
      useAppStore.setState({ highlightedToolCallId: "script-1" });
    });
    expect(container.querySelector(".ring-2")).not.toBeNull();
  });
});

// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProcessSummaryBlock } from "../../renderer/components/message/ProcessSummaryBlock";
import { ResultSummaryBlock } from "../../renderer/components/message/ResultSummaryBlock";
import { NestedToolDetails } from "../../renderer/components/message/NestedToolDetails";
import i18n from "../../renderer/i18n/config";
import { useAppStore } from "../../renderer/store";
import type {
  ContentBlock,
  Message,
  ToolUseContent,
} from "../../renderer/types";
import type {
  DisplayBlock,
  ProcessSummaryDisplayBlock,
} from "../../renderer/utils/tool-display-blocks";

const PARENT_ERROR = "EACCES: permission denied, open '/tmp/a.ts'";
const SCRIPT_CODE = "await writeFile('/tmp/a.ts', 'x')";

const parentItem: ToolUseContent = {
  id: "script-1",
  type: "tool_use",
  name: "codemode",
  input: { code: SCRIPT_CODE },
};

function child(
  overrides: Partial<ToolUseContent> & { trace: ToolUseContent["trace"] },
): ToolUseContent {
  return {
    id: "child-1",
    type: "tool_use",
    name: "read",
    input: { file_path: "/tmp/b.ts" },
    ...overrides,
  };
}

const groupedStatus = (
  firstFailedToolCallId?: string,
): NonNullable<ProcessSummaryDisplayBlock["status"]> => ({
  running: false,
  failed: true,
  unfinished: false,
  unavailable: false,
  ...(firstFailedToolCallId ? { firstFailedToolCallId } : {}),
});

describe("codemode tool group UI", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    await i18n.changeLanguage("zh");
    useAppStore.setState(useAppStore.getInitialState(), true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  // 完整会话状态：ToolUseBlock 的选择器在会话缺失时会 `?? []` 产生新数组，
  // 直接触发无限重渲染，所以必须像既有渲染测试一样把状态备齐。
  function setSession(messages: Message[]): Message {
    useAppStore.setState({
      sessionStates: {
        s1: {
          historyHydrated: true,
          hasMoreOlder: false,
          oldestMessageId: null,
          messages,
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
    return messages[0];
  }

  // 脚本详情 / 子调用详情既是原生 <details>（summary）又是 Radix Collapsible（button）：
  // 两种触发器都点一次，让下面的断言在迁移前后都成立。
  function openDetailsByLabel(label: string) {
    const trigger = [
      ...container.querySelectorAll<HTMLElement>("summary, button"),
    ].find((element) => element.textContent?.trim() === label);
    act(() => trigger?.click());
  }

  function openFirstDetails() {
    const trigger = container.querySelector<HTMLElement>("summary, button");
    act(() => trigger?.click());
  }

  /**
   * 卡片自身的开合开关。
   * 排除两样东西：外层摘要行（它不是工具卡）和 Collapsible 触发器（自带 data-state，
   * 只是个开关，不算卡片）——这样计数在迁移前后同口径。
   */
  function cardToggles(): HTMLButtonElement[] {
    return [
      ...container.querySelectorAll<HTMLButtonElement>(
        "button[aria-expanded]:not([data-state])",
      ),
    ];
  }

  it("结果组折叠时不再显示失败提示，外部高亮请求仍展开并高亮失败子项", () => {
    const failedChild = child({
      id: "write-1",
      name: "write",
      input: { file_path: "/tmp/a.ts", content: "x" },
      trace: {
        parentToolCallId: "script-1",
        status: "error",
        parentStatus: "ok",
        complete: true,
        source: "final",
      },
    });
    const block = {
      type: "result-summary",
      items: [failedChild],
      summary: { editedFiles: 0, writtenFiles: 1 },
      files: [],
      status: groupedStatus("write-1"),
      scripts: [{ id: "script-1", input: { code: SCRIPT_CODE } }],
    } as Extract<DisplayBlock, { type: "result-summary" }>;
    const allBlocks: ContentBlock[] = [
      {
        type: "tool_result",
        toolUseId: "write-1",
        content: PARENT_ERROR,
        isError: true,
      },
    ];
    const message = setSession([
      {
        id: "m1",
        sessionId: "s1",
        role: "assistant",
        timestamp: 1,
        content: allBlocks,
      },
    ]);

    act(() =>
      root.render(
        createElement(ResultSummaryBlock, { block, allBlocks, message }),
      ),
    );

    // 提示条整条移除（2026-10-10 决定）：折叠态只剩摘要行，失败明细在展开里。
    expect(container.textContent).not.toContain(
      i18n.t("tool.grouped.failedOperations"),
    );
    expect(container.querySelector("[data-tool-group-failure]")).toBeNull();
    expect(
      container
        .querySelector("button[aria-expanded]")
        ?.getAttribute("aria-expanded"),
    ).toBe("false");

    // 外部高亮请求（从活动面板点进来）仍然展开详情并一次性消费待展开标记。
    act(() => useAppStore.getState().highlightToolCallId("write-1"));

    expect(container.textContent).toContain(
      i18n.t("tool.grouped.scriptDetails"),
    );
    expect(
      container
        .querySelector("button[aria-expanded]")
        ?.getAttribute("aria-expanded"),
    ).toBe("true");
    expect(useAppStore.getState().highlightedToolCallId).toBe("write-1");
    // 一次性消费：待展开标记用完即清，之后手动收起不会被再次顶开。
    expect(useAppStore.getState().pendingExpandToolCallId).toBeNull();
    expect(container.querySelector(".ring-2")).not.toBeNull();
  });

  it("脚本详情复用原始 store 的父结果，并去重同 ID 的父条目", () => {
    const tracedChild = child({
      trace: {
        parentToolCallId: "script-1",
        status: "ok",
        parentStatus: "ok",
        complete: true,
        source: "final",
        script: { id: "script-1", input: { code: SCRIPT_CODE } },
      },
    });
    // 父结果已从虚拟分组数组移除，只在原始 store.messages 里保留。
    const parentResult: ContentBlock = {
      type: "tool_result",
      toolUseId: "script-1",
      content: PARENT_ERROR,
      isError: true,
    };
    const block = {
      type: "process-summary",
      items: [parentItem, tracedChild],
      summary: {
        readCount: 1,
        hasSearch: false,
        hasWebSearch: false,
        hasBrowse: false,
        hasMemory: false,
        commandCount: 0,
        subagentCount: 0,
        hasGoal: false,
        usedToolCount: 0,
      },
      scripts: [{ id: "script-1", input: { code: SCRIPT_CODE } }],
    } as unknown as ProcessSummaryDisplayBlock;
    const allBlocks: ContentBlock[] = [tracedChild];
    const message = setSession([
      {
        id: "m1",
        sessionId: "s1",
        role: "assistant",
        timestamp: 1,
        content: [parentItem, parentResult, tracedChild],
      },
    ]);

    act(() =>
      root.render(
        createElement(ProcessSummaryBlock, { block, allBlocks, message }),
      ),
    );
    act(() =>
      container
        .querySelector<HTMLButtonElement>("button[aria-expanded]")
        ?.click(),
    );

    // 脚本卡迁到 Collapsible 后关闭态会卸载内容 ⇒ 先展开，卡片数才对得上迁移前。
    openDetailsByLabel(i18n.t("tool.grouped.scriptDetails"));

    // 父条目与脚本引用同 ID：脚本详情只渲染一次。
    expect(
      container.textContent?.split(i18n.t("tool.grouped.scriptDetails")).length,
    ).toBe(2); // 出现 1 次
    // 摘要行 + 脚本卡 + 子调用卡；父条目没有被重复渲染成第 4 张卡。
    expect(cardToggles().length).toBe(3);

    // 脚本卡里的工具卡自己也有开合（索引 1 = 脚本卡，0 是外层摘要行）。
    act(() => cardToggles()[1]?.click());
    // 脚本卡已展开：父错误原文来自原始消息，不是追加进分组数组的合成结果。
    expect(
      [...container.querySelectorAll("pre")].some((pre) =>
        pre.textContent?.includes(PARENT_ERROR),
      ),
    ).toBe(true);
  });

  it("历史缺明细的未完成子调用显示真实工具名、省略参数与不可用提示", () => {
    const item = child({
      id: "ghost-1",
      input: {},
      trace: {
        parentToolCallId: "script-1",
        status: "unfinished",
        parentStatus: "unfinished",
        complete: false,
        source: "missing",
        argumentsBytes: 2048,
      },
    });
    const allBlocks: ContentBlock[] = [
      {
        type: "tool_result",
        toolUseId: "ghost-1",
        content: "",
        outputUnavailable: true,
      },
    ];
    const message = setSession([
      {
        id: "m1",
        sessionId: "s1",
        role: "assistant",
        timestamp: 1,
        content: allBlocks,
      },
    ]);

    act(() =>
      root.render(
        createElement(NestedToolDetails, { item, allBlocks, message }),
      ),
    );

    // 详情迁到 Collapsible 后关闭态会卸载内容 ⇒ 先展开再读正文。
    openFirstDetails();

    const text = container.textContent ?? "";
    expect(text).toContain(item.name);
    expect(text).toContain(
      i18n.t("tool.grouped.scriptOwner", { id: "script-1" }),
    );
    expect(text).toContain(i18n.t("tool.grouped.unfinishedOperations"));
    expect(text).toContain(i18n.t("tool.grouped.argumentsOmitted"));
    expect(text).toContain(i18n.t("tool.grouped.outputUnavailable"));
    // 实时/运行中不显示「历史未保存」；这里命中 outputUnavailable 才显示一次。
    expect(text.split(i18n.t("tool.grouped.outputUnavailable")).length).toBe(2);
  });

  it("已取消子调用标为已取消并保留错误原文", () => {
    const item = child({
      id: "cancel-1",
      input: { file_path: "/tmp/c.ts" },
      trace: {
        parentToolCallId: "script-1",
        status: "unfinished",
        parentStatus: "ok",
        complete: true,
        source: "final",
        cancelled: true,
      },
    });
    const allBlocks: ContentBlock[] = [
      {
        type: "tool_result",
        toolUseId: "cancel-1",
        content: PARENT_ERROR,
        isError: true,
      },
    ];
    const message = setSession([
      {
        id: "m1",
        sessionId: "s1",
        role: "assistant",
        timestamp: 1,
        content: allBlocks,
      },
    ]);

    act(() =>
      root.render(
        createElement(NestedToolDetails, { item, allBlocks, message }),
      ),
    );

    // 详情迁到 Collapsible 后关闭态会卸载内容 ⇒ 先展开再读正文。
    openFirstDetails();

    const text = container.textContent ?? "";
    expect(text).toContain(i18n.t("tool.grouped.cancelledOperation"));
    expect(text).toContain(PARENT_ERROR);
    expect(text).not.toContain(i18n.t("tool.grouped.outputUnavailable"));
  });
  it("shows omitted arguments even when live output is retained", () => {
    const item = child({
      name: "write",
      input: {},
      trace: {
        parentToolCallId: "script-1",
        parentStatus: "ok",
        status: "ok",
        source: "final",
        complete: false,
        argumentsBytes: 10033,
      },
    });
    const message = setSession([
      {
        id: "m1",
        sessionId: "s1",
        role: "assistant",
        timestamp: 1,
        content: [item],
      },
    ]);
    act(() =>
      root.render(
        createElement(NestedToolDetails, {
          item,
          message,
          allBlocks: [
            {
              type: "tool_result",
              toolUseId: item.id,
              content: "saved",
              isError: false,
            },
          ],
        }),
      ),
    );
    expect(container.textContent).toContain(
      i18n.t("tool.grouped.argumentsOmitted"),
    );
  });
});

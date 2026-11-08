// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ProcessSummaryBlock } from "../../renderer/components/message/ProcessSummaryBlock";
import i18n from "../../renderer/i18n/config";
import { useAppStore } from "../../renderer/store";
import type { ProcessSummaryDisplayBlock } from "../../renderer/utils/tool-display-blocks";
import type { Message } from "../../renderer/types";

const child = (id: string, parentToolCallId: string, code: string) => ({
  id,
  type: "tool_use" as const,
  name: "fetch_content",
  input: { url: "https://example.com" },
  trace: {
    parentToolCallId,
    status: "ok" as const,
    parentStatus: "ok" as const,
    complete: true,
    source: "final" as const,
    script: { id: parentToolCallId, input: { code } },
  },
});

describe("ProcessSummaryBlock 脚本行标题", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(async () => {
    await i18n.changeLanguage("zh");
  });

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    useAppStore.setState(useAppStore.getInitialState(), true);
    // 会话状态必须备好：无 sessionId 时选择器会返回新数组字面量（见
    // process-summary-highlight.test.ts / bash-tool-block.test.ts 的说明）。
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
      type: "process-summary",
      items,
      summary: {
        readCount: 0,
        hasSearch: false,
        hasWebSearch: true,
        hasBrowse: false,
        hasMemory: false,
        commandCount: 0,
        subagentCount: 0,
        hasGoal: false,
        usedToolCount: 0,
        scriptCount: scripts.length,
      },
      scripts,
    } as unknown as ProcessSummaryDisplayBlock;
    const message: Message = {
      id: "m1",
      sessionId: "s1",
      role: "assistant",
      timestamp: 1,
      content: items as never,
    };
    act(() =>
      root.render(
        createElement(ProcessSummaryBlock, {
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

  it("三个脚本各自显示自己的意图，不再重复「脚本详情」", () => {
    const items = [
      child("c1", "s1", "// 搜索双十一优惠码\nconst a = 1"),
      child("c2", "s2", "// 读取三个候选页面\nconst b = 1"),
      child("c3", "s3", "// 汇总价格对比\nconst c = 1"),
    ];
    const scripts = [
      { id: "s1", input: { code: "// 搜索双十一优惠码\nconst a = 1" } },
      { id: "s2", input: { code: "// 读取三个候选页面\nconst b = 1" } },
      { id: "s3", input: { code: "// 汇总价格对比\nconst c = 1" } },
    ];
    renderBlock(items, scripts);

    const labels = [...container.querySelectorAll("[data-script-row]")].map(
      (el) => el.textContent?.trim(),
    );
    expect(labels).toEqual([
      "搜索双十一优惠码",
      "读取三个候选页面",
      "汇总价格对比",
    ]);
    expect(container.textContent).not.toContain(
      i18n.t("tool.grouped.scriptDetails"),
    );
  });

  it("没有意图注释时按步数区分", () => {
    const items = [
      child("c1", "s1", "const a = 1"),
      child("c2", "s1", "const a = 2"),
      child("c3", "s2", "const b = 1"),
    ];
    const scripts = [
      { id: "s1", input: { code: "const a = 1" } },
      { id: "s2", input: { code: "const b = 1" } },
    ];
    renderBlock(items, scripts);

    const labels = [...container.querySelectorAll("[data-script-row]")].map(
      (el) => el.textContent?.trim(),
    );
    expect(labels).toEqual([
      i18n.t("tool.step.scriptSteps", { count: 2 }),
      i18n.t("tool.step.scriptSteps", { count: 1 }),
    ]);
  });

  it("零子调用的脚本不算「1 步」：投影会把父块自己推回来，别把它数成一个子调用", () => {
    // 历史缺明细时 nested-tool-display 的 source:"missing" 路径就是长这样：
    // 只有父块自己，id === trace.parentToolCallId。
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

  it("chevron 尺寸要压过 Button 基类的 [&_svg]:size-4", () => {
    renderBlock(
      [child("c1", "s1", "// 搜索优惠码\nconst a = 1")],
      [{ id: "s1", input: { code: "// 搜索优惠码\nconst a = 1" } }],
    );
    const row = container.querySelector<HTMLElement>("[data-script-row]")!;
    // 基类的 .cls svg {width:1rem} 特异性 (0,1,1)，高于 svg 自己的 .h-3.5 (0,1,0)
    expect(row.className).toContain("[&_svg]:size-3.5");
  });

  it("脚本行排版与工具行一致：14px、字重 400、右缘 chevron", () => {
    renderBlock(
      [child("c1", "s1", "// 搜索优惠码\nconst a = 1")],
      [{ id: "s1", input: { code: "// 搜索优惠码\nconst a = 1" } }],
    );

    const row = container.querySelector<HTMLElement>("[data-script-row]")!;
    // 14px + 400：与 ToolStepRow 完全一致（Button 基类是 text-sm/500，两个都得顶掉）
    expect(row.className).toContain("text-sm");
    expect(row.className).toContain("font-normal");
    expect(row.className).not.toContain("font-medium");
    // 右缘箭头：靠 group-data-[state=open] 旋转，不需要额外 state
    expect(row.querySelector("svg")).not.toBeNull();

    act(() => row.click());
    const detail = container.querySelector("[data-script-detail]");
    expect(detail).not.toBeNull();
    // 与 ToolStepRow 的内嵌块同一套类
    expect(detail?.className).toContain("rounded-lg");
    expect(detail?.className).toContain("border-border/60");
    // 内嵌块也要和标签左缘对齐（ToolStepRow 用 px-4 pb-3 的 wrapper）
    expect(detail?.parentElement?.className).toContain("px-4");
    expect(detail?.parentElement?.className).toContain("pb-3");
  });
});

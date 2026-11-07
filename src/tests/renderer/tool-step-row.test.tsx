// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ToolStepRow } from "../../renderer/components/message/ToolStepRow";
import i18n from "../../renderer/i18n/config";
import { useAppStore } from "../../renderer/store";
import type { ContentBlock, Message } from "../../renderer/types";

const readItem = {
  id: "call-read",
  type: "tool_use" as const,
  name: "read",
  input: { file_path: "/tmp/a.ts" },
};

const readResult: ContentBlock = {
  type: "tool_result",
  toolUseId: "call-read",
  content: "line one\nline two",
};

const message: Message = {
  id: "m1",
  sessionId: "s1",
  role: "assistant",
  timestamp: 1,
  content: [readItem, readResult],
};

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
  } as never);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("ToolStepRow", () => {
  it("行头显示标签与摘要，默认收起", () => {
    act(() =>
      root.render(
        createElement(ToolStepRow, {
          item: readItem,
          allBlocks: [readItem, readResult],
          message,
        }),
      ),
    );
    const trigger = container.querySelector<HTMLButtonElement>(
      "button[aria-expanded]",
    )!;
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    // getToolLabel 会缩短路径（shortenPath），不钉绝对路径
    expect(container.querySelector("[data-step-label]")?.textContent).toContain(
      "a.ts",
    );
    // 摘要来自既有 collapsed summary：读文件给的是首行预览（kind=text）
    expect(container.querySelector("[data-step-meta]")?.textContent).toContain(
      '"line one"',
    );
    expect(container.querySelector("[data-step-body]")).toBeNull();
  });

  it("点行头展开详情，再点收起", () => {
    act(() =>
      root.render(
        createElement(ToolStepRow, {
          item: readItem,
          allBlocks: [readItem, readResult],
          message,
        }),
      ),
    );
    const trigger = container.querySelector<HTMLButtonElement>(
      "button[aria-expanded]",
    )!;
    act(() => trigger.click());
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector("[data-step-body]")).not.toBeNull();
    act(() => trigger.click());
    expect(container.querySelector("[data-step-body]")).toBeNull();
  });

  it("description 优先作为行标题", () => {
    const bashItem = {
      id: "call-bash",
      type: "tool_use" as const,
      name: "bash",
      input: {
        command: "wrangler whoami",
        description: "查看 wrangler 登录状态",
      },
    };
    act(() =>
      root.render(
        createElement(ToolStepRow, {
          item: bashItem,
          allBlocks: [bashItem],
          message,
        }),
      ),
    );
    expect(container.querySelector("[data-step-label]")?.textContent).toBe(
      "查看 wrangler 登录状态",
    );
  });

  it("失败调用带 error 状态标记", () => {
    const failed: ContentBlock = {
      type: "tool_result",
      toolUseId: "call-read",
      content: "ENOENT",
      isError: true,
    };
    act(() =>
      root.render(
        createElement(ToolStepRow, {
          item: readItem,
          allBlocks: [readItem, failed],
          message,
        }),
      ),
    );
    expect(
      container.querySelector('[data-step-status="error"]'),
    ).not.toBeNull();
  });

  it("trace 未完成 / 已取消 / 输出不可用时行头有状态标记，不冒充成功", () => {
    const cases = [
      {
        status: "unfinished" as const,
        cancelled: false,
        key: "tool.grouped.unfinishedOperations",
      },
      {
        status: "ok" as const,
        cancelled: true,
        key: "tool.grouped.cancelledOperation",
      },
    ];
    for (const item of cases) {
      const traced = {
        id: "child",
        type: "tool_use" as const,
        name: "read",
        input: {},
        trace: {
          parentToolCallId: "p",
          status: item.status,
          parentStatus: "ok" as const,
          complete: false,
          cancelled: item.cancelled,
          source: "final" as const,
        },
      };
      act(() =>
        root.render(
          createElement(ToolStepRow, {
            item: traced,
            allBlocks: [traced],
            message,
          }),
        ),
      );
      expect(
        container.querySelector('[data-step-status="unavailable"]'),
      ).not.toBeNull();
      expect(container.textContent).toContain(i18n.t(item.key));
    }
  });

  it("输出不可用的调用也标出来", () => {
    const unavailable: ContentBlock = {
      type: "tool_result",
      toolUseId: "call-read",
      content: "",
      outputUnavailable: true,
    };
    act(() =>
      root.render(
        createElement(ToolStepRow, {
          item: readItem,
          allBlocks: [readItem, unavailable],
          message,
        }),
      ),
    );
    expect(
      container.querySelector('[data-step-status="unavailable"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain(
      i18n.t("tool.step.statusUnavailable"),
    );
  });

  it("摘要过长时被截断，不把箭头挤出容器", () => {
    const longResult: ContentBlock = {
      type: "tool_result",
      toolUseId: "call-read",
      content: `${"x".repeat(400)}\nsecond`,
    };
    act(() =>
      root.render(
        createElement(ToolStepRow, {
          item: readItem,
          allBlocks: [readItem, longResult],
          message,
        }),
      ),
    );
    const meta = container.querySelector("[data-step-meta]")!;
    expect(meta.className).toContain("truncate");
    expect(meta.className).toContain("max-w-");
  });

  it("description 里的换行折成空格，尖括号按文本显示", () => {
    const bashItem = {
      id: "call-bash",
      type: "tool_use" as const,
      name: "bash",
      input: {
        command: "echo x",
        description: "<b>x</b>\nsecond line",
      },
    };
    act(() =>
      root.render(
        createElement(ToolStepRow, {
          item: bashItem,
          allBlocks: [bashItem],
          message,
        }),
      ),
    );
    const label = container.querySelector("[data-step-label]");
    expect(label?.textContent).toBe("<b>x</b> second line");
    expect(label?.querySelector("b")).toBeNull();
  });

  it("行头是真 button：原生键盘开合靠的就是这个元素类型", () => {
    act(() =>
      root.render(
        createElement(ToolStepRow, {
          item: readItem,
          allBlocks: [readItem, readResult],
          message,
        }),
      ),
    );
    const trigger = container
      .querySelector("[data-step-label]")
      ?.closest("button");
    expect(trigger?.tagName).toBe("BUTTON");
    expect(trigger?.getAttribute("type")).toBe("button");
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
  });

  it("被高亮时自动展开", () => {
    act(() =>
      root.render(
        createElement(ToolStepRow, {
          item: readItem,
          allBlocks: [readItem, readResult],
          message,
          highlighted: true,
        }),
      ),
    );
    expect(
      container
        .querySelector("button[aria-expanded]")
        ?.getAttribute("aria-expanded"),
    ).toBe("true");
  });
});

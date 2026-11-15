// @vitest-environment jsdom
//
// 任务坞的行为契约：清单卡（计数 / 进行中项 / 收尾态 / 长清单内滚动），
// 动作行（文案 + 秒表），以及"只在运行中与 5s 收尾窗口内可见"这条显隐规则。
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChatTaskDock,
  resolveDockAction,
  resolveDockStepCandidate,
  resolveHeldStep,
  STEP_DWELL_MS,
} from "../../renderer/components/ChatTaskDock";
import type { CurrentTodos } from "../../renderer/utils/current-todos";
import { useAppStore } from "../../renderer/store";
import type { Message } from "../../renderer/types";
import { buildProcessSummaryDisplayBlock } from "../../renderer/utils/tool-display-blocks";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.count === undefined ? key : `${key}:${options.count}`,
    i18n: { language: "en" },
  }),
  // 坞内嵌 ProcessSummaryBlock，它的依赖链在导入期就会 use(initReactI18next)
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

// 展开摘要会渲染 ToolStepRow，它的 store 选择器是
// `sessionStates[id]?.messages ?? []` —— 缺会话状态时每帧都返回新数组，
// 触发 zustand 的 "getSnapshot should be cached" 无限重渲染。
// ⇒ 这里给一个稳定的空数组兜住（同 todo-write-card.test.ts 的做法）。
const TEST_SESSION_ID = "dock-session";
const NO_MESSAGES: Message[] = [];
const TEST_MESSAGE: Message = {
  id: "m1",
  sessionId: TEST_SESSION_ID,
  role: "assistant",
  timestamp: 0,
  content: [],
};

const PLAN: CurrentTodos = [
  { content: "建表", status: "completed" },
  { content: "写迁移", status: "in_progress", activeForm: "正在写迁移" },
];

describe("chat task dock", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    useAppStore.setState({
      sessionStates: {
        [TEST_SESSION_ID]: { messages: NO_MESSAGES },
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

  function render(props: Parameters<typeof ChatTaskDock>[0]): void {
    act(() => {
      root.render(createElement(ChatTaskDock, props));
    });
  }

  function dock(): HTMLElement | null {
    return container.querySelector<HTMLElement>(
      '[data-testid="chat-task-dock"]',
    );
  }

  it("运行中渲染清单：计数、进行中项标记与动作文案", () => {
    render({ status: { type: "thinking" }, running: true, currentTodos: PLAN });
    expect(dock()).not.toBeNull();
    expect(container.textContent).toContain("1/2");
    expect(container.textContent).toContain("写迁移");
    expect(container.textContent).toContain("chat.processing");
    // 进行中项带 data-active（供内部滚动定位），旁边有旋转图标
    expect(
      container.querySelector('li[data-active="true"]')?.textContent,
    ).toContain("写迁移");
    expect(
      container.querySelector('[data-testid="dock-status-glyph"]'),
    ).not.toBeNull();
  });

  it("不在运行、也不在收尾窗口 → 整块不渲染", () => {
    render({
      status: null,
      running: false,
      executionClock: { startAt: 1_000, endAt: 2_000 },
      currentTodos: PLAN,
    });
    expect(dock()).toBeNull();
  });

  it("收尾窗口内（endAt 刚过去 1 秒）仍然渲染，且显示压缩结果", () => {
    render({
      status: { type: "compaction-success" },
      running: false,
      executionClock: {
        startAt: Date.now() - 5_000,
        endAt: Date.now() - 1_000,
      },
      currentTodos: PLAN,
    });
    expect(dock()).not.toBeNull();
    expect(container.textContent).toContain("chat.compacted");
  });

  it("没有清单也有动作态时只有动作行", () => {
    render({
      status: { type: "responding" },
      running: true,
      currentTodos: [],
      lastNonEmptyTodos: null,
    });
    expect(container.textContent).toContain("chat.responding");
    expect(container.querySelector("ul")).toBeNull();
  });

  it("finishing：清空后仍显示记住那份的计数与「已清空」，进行中项不再呈实时态", () => {
    render({
      status: { type: "thinking" },
      running: true,
      currentTodos: [],
      lastNonEmptyTodos: [
        { content: "建表", status: "completed" },
        { content: "写迁移", status: "in_progress" },
      ],
    });
    expect(container.textContent).toContain("1/2");
    expect(container.textContent).toContain("activity.statusCleared");
    expect(container.querySelector('li[data-active="true"]')).toBeNull();
  });

  it("planDone 且全部完成 → 行尾显示已完成", () => {
    render({
      status: { type: "thinking" },
      running: true,
      currentTodos: [{ content: "建表", status: "completed" }],
      currentPlanDone: true,
    });
    expect(container.textContent).toContain("activity.statusDone");
  });

  it("planDone 但有取消项 → 报出取消数量", () => {
    render({
      status: { type: "thinking" },
      running: true,
      currentTodos: [
        { content: "建表", status: "completed" },
        { content: "放弃", status: "cancelled" },
      ],
      currentPlanDone: true,
    });
    expect(container.textContent).toContain("activity.statusCancelled:1");
  });

  it("进行中项的文案优先取 activeForm", () => {
    render({
      status: { type: "thinking" },
      running: true,
      currentTodos: PLAN,
    });
    expect(container.textContent).toContain("正在写迁移");
  });

  it("currentTodos 为 null 时不进收尾态（没有依据就不能显示上一轮）", () => {
    // Review Focus #2：`null` = 从未有过 / 重启未水合，与"被清空"是两件事。
    render({
      status: { type: "thinking" },
      running: true,
      currentTodos: null,
      lastNonEmptyTodos: [
        { content: "建表", status: "completed" },
        { content: "补测试", status: "completed" },
      ],
      lastPlanDone: true,
    });
    expect(container.textContent).not.toContain("2/2");
    expect(container.textContent).not.toContain("activity.statusCleared");
    expect(container.textContent).not.toContain("activity.statusDone");
    expect(container.querySelector("ul")).toBeNull();
  });

  it("全完成但未声明 done → 不说已完成（done 由模型声明负责）", () => {
    render({
      status: { type: "thinking" },
      running: true,
      currentTodos: [{ content: "建表", status: "completed" }],
      currentPlanDone: false,
    });
    expect(container.textContent).toContain("1/1");
    expect(container.textContent).not.toContain("activity.statusDone");
  });

  it("目标长跑时不单独挂一只裸秒表（耗时归输入框上方的目标段）", () => {
    render({
      status: {
        type: "goal-active",
        objective: "跑一个长任务",
        iteration: 1,
        timeUsedSeconds: 5,
        activePeriodStartedAt: Date.now(),
      },
      running: false,
      executionClock: {
        startAt: Date.now() - 9_000,
        endAt: Date.now() - 1_000,
      },
      currentTodos: [],
      lastNonEmptyTodos: null,
    });
    // 收尾窗口内本来就该整块在；但没有动作文案时不该只剩一格耗时
    expect(dock()).toBeNull();
    expect(
      container.querySelector('[data-testid="turn-elapsed-visible"]'),
    ).toBeNull();
  });

  it("运行中把过程摘要与动作态合成一行，不再重复「思考中」", () => {
    // 两块原来各占一行（转录里一块、坞里一块），说的是同一件事。
    const block = buildProcessSummaryDisplayBlock([
      { type: "tool_use", id: "b1", name: "bash", input: { command: "ls" } },
    ]);
    render({
      status: { type: "thinking" },
      running: true,
      currentTodos: PLAN,
      executionClock: { startAt: Date.now(), endAt: null },
      summary: { block, allBlocks: [] },
    });
    // 摘要进来了：显示的是**当前那一步**，不再是聚合计数
    expect(container.textContent).toContain("tool.labelBash");
    expect(container.textContent).not.toContain(
      "tool.grouped.executedCommands",
    );
    // 进行态措辞不再重复（摘要说的已经是这件事）
    expect(container.textContent).not.toContain("chat.processing");
    // 旋转图标与回合耗时都还在这一行里
    expect(
      container.querySelector('[data-testid="dock-status-glyph"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="turn-elapsed-visible"]'),
    ).not.toBeNull();
    // 摘要与动作态同处**一行**：图标、摘要触发器、耗时都在同一个 flex 行里，
    // 且全坞只有一个摘要触发器（多一层壳就会多一个折叠按钮）。
    const actionRow = container.querySelector(
      '[data-testid="dock-status-glyph"]',
    )?.parentElement?.parentElement;
    expect(actionRow).toBeTruthy();
    expect(actionRow?.querySelectorAll("button[aria-expanded]")).toHaveLength(
      1,
    );
    expect(
      actionRow?.contains(
        container.querySelector('[data-testid="turn-elapsed-visible"]'),
      ),
    ).toBe(true);
  });

  it("展开时图标与耗时都贴着第一行，不跟着整块垂直居中", async () => {
    const block = buildProcessSummaryDisplayBlock([
      { type: "tool_use", id: "b1", name: "bash", input: { command: "ls" } },
    ]);
    render({
      status: { type: "thinking" },
      running: true,
      currentTodos: [],
      lastNonEmptyTodos: null,
      executionClock: { startAt: Date.now(), endAt: null },
      summary: { block, message: TEST_MESSAGE },
    });
    // 摘要展开后整块会变高；行容器若仍 items-center，图标与耗时会被拉到中间
    const glyph = container.querySelector('[data-testid="dock-status-glyph"]');
    const row = glyph?.parentElement?.parentElement;
    expect(row?.className).toContain("items-start");

    // 关键：图标/耗时必须与「摘要触发器」同高。
    // ⚠️ 触发器的实际高度来自 <Button> 的默认档（h-9），不是行盒 —— 按文字行高
    // 去猜会高估/低估，这就是"图标看起来偏高"的根因。这里直接比两边的 h-* 档位：
    // 哪天按钮默认档改了，这条会先红，提醒同步改坞里的盒子。
    const heights = (cls: string | undefined) =>
      (cls ?? "").split(/\s+/).filter((c) => /^h-(?:\d|\[)/.test(c));
    const trigger = container.querySelector<HTMLButtonElement>(
      "button[aria-expanded]",
    );
    // 先钉死档位：只比"两边相等"会在一侧为空数组时绿得没道理
    expect(heights(trigger?.className)).toEqual(["h-9"]);
    const elapsed = container.querySelector(
      '[data-testid="turn-elapsed-visible"]',
    );
    const assertAligned = () => {
      const expected = heights(trigger?.className);
      expect(heights(glyph?.parentElement?.className)).toEqual(expected);
      expect(heights(elapsed?.parentElement?.parentElement?.className)).toEqual(
        expected,
      );
    };
    assertAligned();

    // 真展开一次再验：展开让整块变高，首行那几个盒子的高度不该跟着变
    await act(async () => {
      trigger?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(
      container.querySelector("button[aria-expanded='true']"),
    ).not.toBeNull();
    expect(row?.className).toContain("items-start");
    assertAligned();
  });

  it("动作文案的省略号还在（truncate 在内层 span 上）", () => {
    render({
      status: { type: "thinking" },
      running: true,
      currentTodos: [],
      lastNonEmptyTodos: null,
    });
    const box = container.querySelector('[data-testid="dock-action-text"]');
    expect(box).toBeTruthy();
    // 盒子是 flex（靠它垂直居中），truncate 必须在里面的 span 上 ——
    // 挂在 flex 容器上时 text-overflow 不生效，文字会被硬裁掉、没有省略号。
    expect(box?.className).not.toContain("truncate");
    expect(box?.querySelector("span.truncate")?.textContent).toBe(
      "chat.processing",
    );
  });

  it("耗时与摘要同号（14px），不再小一号", () => {
    const block = buildProcessSummaryDisplayBlock([
      { type: "tool_use", id: "b1", name: "bash", input: { command: "ls" } },
    ]);
    render({
      status: { type: "thinking" },
      running: true,
      currentTodos: [],
      lastNonEmptyTodos: null,
      executionClock: { startAt: Date.now(), endAt: null },
      summary: { block },
    });
    const glyph = container.querySelector('[data-testid="dock-status-glyph"]');
    const row = glyph?.parentElement?.parentElement;
    expect(row?.className).toContain("text-sm");
    expect(row?.className).not.toContain("text-xs");
  });

  it("坞头紧凑：摘要片段不再吸收空白，箭头与耗时紧贴文案", () => {
    const block = buildProcessSummaryDisplayBlock([
      { type: "tool_use", id: "b1", name: "bash", input: { command: "ls" } },
    ]);
    render({
      status: { type: "thinking" },
      running: true,
      currentTodos: [],
      lastNonEmptyTodos: null,
      executionClock: { startAt: Date.now(), endAt: null },
      summary: { block },
    });
    const trigger = container.querySelector("button[aria-expanded]");
    const fragments = trigger?.firstElementChild;
    // 坞里：片段不再吸走空白（否则箭头与耗时被推到行末，头部成一条长杠）
    expect(fragments?.className).not.toContain("flex-1");
    // 但必须保留单行省略能力
    expect(fragments?.className).toContain("min-w-0");
    expect(fragments?.className).toContain("overflow-hidden");
    // 触发按钮本身也不再拉伸
    expect(trigger?.className).not.toContain("flex-1");
  });

  it("耗时进触发器行内：不再在摘要块外面占一列（展开时卡片铺满整行）", () => {
    const block = buildProcessSummaryDisplayBlock([
      { type: "tool_use", id: "b1", name: "bash", input: { command: "ls" } },
    ]);
    render({
      status: { type: "thinking" },
      running: true,
      currentTodos: [],
      lastNonEmptyTodos: null,
      executionClock: { startAt: Date.now(), endAt: null },
      summary: { block },
    });
    const trigger = container.querySelector("button[aria-expanded]");
    const elapsed = container.querySelector(
      '[data-testid="turn-elapsed-visible"]',
    );
    // ① 耗时归触发按钮所有（它是行内一段文本，不再是一列兄弟元素）
    expect(elapsed?.closest("button")).toBe(trigger);
    // ② 摘要容器因此能占满剩余宽度 → 展开的卡片铺满整行
    const summaryWrapper = trigger?.closest(".flex-1");
    expect(summaryWrapper, "摘要容器应带 flex-1").not.toBeNull();
    expect(summaryWrapper?.contains(elapsed ?? null)).toBe(true);
    // ③ 全坞只有一个「已运行」，不会两边各渲染一份
    expect(
      container.querySelectorAll('[data-testid="turn-elapsed-visible"]'),
    ).toHaveLength(1);
  });

  it("速度挂在秒表后面，同一个 h-9 行盒里、排在耗时之后", () => {
    render({
      status: { type: "responding" },
      running: true,
      currentTodos: [],
      lastNonEmptyTodos: null,
      executionClock: { startAt: Date.now() - 12_000, endAt: null },
      tokenSpeedLabel: "38 tok/s",
    });

    const elapsed = container.querySelector(
      '[data-testid="turn-elapsed-visible"]',
    );
    const speed = container.querySelector('[data-testid="turn-speed-visible"]');
    expect(speed?.textContent).toContain("38 tok/s");
    // 与耗时同处那个 h-9 盒子（不去数 DOM 层级：哨兵 grid 的位置可变，
    // 真正要守的是「同一个行盒」和「速率在后」）
    expect(speed?.closest(".h-9")).toBe(elapsed?.closest(".h-9"));
    expect(speed?.closest(".h-9")).not.toBeNull();
    // 顺序：耗时在前，速率在后
    expect(
      elapsed!.compareDocumentPosition(speed!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("收尾窗口里与冻结的耗时同排，且不多出一个前缀分隔符", () => {
    const endAt = Date.now() - 1_000;
    render({
      status: null,
      running: false,
      currentTodos: [],
      lastNonEmptyTodos: null,
      executionClock: { startAt: endAt - 12_000, endAt },
      tokenSpeedLabel: "38 tok/s",
    });

    const text = dock()?.textContent ?? "";
    expect(text).toContain("chat.elapsedDone");
    expect(text).toContain("38 tok/s");
    // 没有动作文案/摘要时不应多出开头的「· 」：整行只有一个分隔符
    expect(text.split("·")).toHaveLength(2);
  });

  it("目标长跑时不挂速率（整块不渲染，耗时归输入框上方的目标段）", () => {
    render({
      status: {
        type: "goal-active",
        objective: "跑一个长任务",
        iteration: 1,
        timeUsedSeconds: 5,
        activePeriodStartedAt: Date.now(),
      },
      running: false,
      executionClock: {
        startAt: Date.now() - 9_000,
        endAt: Date.now() - 1_000,
      },
      currentTodos: [],
      lastNonEmptyTodos: null,
      tokenSpeedLabel: "38 tok/s",
    });

    expect(dock()).toBeNull();
    expect(
      container.querySelector('[data-testid="turn-speed-visible"]'),
    ).toBeNull();
  });

  it("没有速度数据时不渲染速度段（不留占位、不留裸分隔符）", () => {
    render({
      status: { type: "responding" },
      running: true,
      currentTodos: [],
      lastNonEmptyTodos: null,
      executionClock: { startAt: Date.now() - 12_000, endAt: null },
    });

    expect(
      container.querySelector('[data-testid="turn-speed-visible"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="turn-elapsed-visible"]'),
    ).not.toBeNull();
  });

  it("有过程摘要时速度跟着耗时进触发器行内，不另起一列", () => {
    const block = buildProcessSummaryDisplayBlock([
      { type: "tool_use", id: "b1", name: "bash", input: { command: "ls" } },
    ]);
    render({
      status: { type: "thinking" },
      running: true,
      currentTodos: [],
      lastNonEmptyTodos: null,
      executionClock: { startAt: Date.now(), endAt: null },
      summary: { block, message: TEST_MESSAGE },
      tokenSpeedLabel: "约 42 tok/s",
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      "button[aria-expanded]",
    );
    const speed = container.querySelector('[data-testid="turn-speed-visible"]');
    // 估算值的「约」前缀原样透传，坞内不再加工
    expect(speed?.textContent).toContain("约 42 tok/s");
    // 与耗时同处触发器行内（既有的 trailing 位置），没有多出一列
    expect(speed?.closest("button")).toBe(trigger);
  });

  it("没有摘要时耗时仍是行内兄弟（不进按钮）", () => {
    render({
      status: { type: "thinking" },
      running: true,
      currentTodos: [],
      lastNonEmptyTodos: null,
      executionClock: { startAt: Date.now(), endAt: null },
    });
    const elapsed = container.querySelector(
      '[data-testid="turn-elapsed-visible"]',
    );
    expect(elapsed).not.toBeNull();
    expect(elapsed?.closest("button")).toBeNull();
  });

  it("一次性结果（压缩完成）不因摘要存在而被吞掉", () => {
    const block = buildProcessSummaryDisplayBlock([
      { type: "tool_use", id: "b1", name: "bash", input: { command: "ls" } },
    ]);
    render({
      status: { type: "compaction-success" },
      running: true,
      currentTodos: [],
      lastNonEmptyTodos: null,
      summary: { block },
    });
    expect(container.textContent).toContain("chat.compacted");
    // 一次性结果独占这一行：不再同时挂着聚合计数
    expect(container.textContent).not.toContain(
      "tool.grouped.executedCommands",
    );
  });

  const BASH_BLOCK = buildProcessSummaryDisplayBlock([
    {
      type: "tool_use",
      id: "b1",
      name: "bash",
      input: { command: "git status", description: "查看仓库状态和最近提交" },
    },
  ]);

  it("长命令跑很久也一直显示它的描述（不能 1.5 秒后说「正在回复」）", async () => {
    vi.useFakeTimers(); // ⚠️ 必须在 render 之前装，否则 interval 是真的
    try {
      render({
        status: { type: "responding" },
        running: true,
        currentTodos: [],
        executionClock: { startAt: Date.now(), endAt: null },
        // b1 还没有 tool_result → 还在跑
        summary: { block: BASH_BLOCK, allBlocks: [] },
      });
      expect(container.textContent).toContain("查看仓库状态和最近提交");
      await act(async () => {
        vi.advanceTimersByTime(8000);
      });
      expect(container.textContent).toContain("查看仓库状态和最近提交");
      expect(container.textContent).not.toContain("chat.responding");
    } finally {
      vi.useRealTimers();
    }
  });

  it("命令已结束：驻留 1.5s 后回到动作文案", async () => {
    vi.useFakeTimers();
    try {
      render({
        status: { type: "responding" },
        running: true,
        currentTodos: [],
        executionClock: { startAt: Date.now(), endAt: null },
        summary: {
          block: BASH_BLOCK,
          // b1 已有结果 → 已停
          allBlocks: [{ type: "tool_result", toolUseId: "b1", content: "" }],
        },
      });
      expect(container.textContent).toContain("查看仓库状态和最近提交");
      await act(async () => {
        vi.advanceTimersByTime(STEP_DWELL_MS + 1000);
      });
      expect(container.textContent).not.toContain("查看仓库状态和最近提交");
      expect(container.textContent).toContain("chat.responding");
    } finally {
      vi.useRealTimers();
    }
  });

  it("没有 description 时回落到本地动词表", () => {
    const block = buildProcessSummaryDisplayBlock([
      {
        type: "tool_use",
        id: "b1",
        name: "bash",
        input: { command: "git status" },
      },
    ]);
    render({
      status: { type: "thinking" },
      running: true,
      currentTodos: [],
      summary: { block, allBlocks: [] },
    });
    expect(container.textContent).toContain("tool.step.cmdGitStatus");
  });

  it("右侧耗时与速率在同一行内且不可收缩（窄窗先截断文案）", () => {
    const block = buildProcessSummaryDisplayBlock([
      {
        type: "tool_use",
        id: "b1",
        name: "bash",
        input: {
          command: "rg --count-matches 一些特别长的搜索串",
          description:
            "在仓库里搜索所有引用这个特别长的符号名的地方并统计出现次数",
        },
      },
    ]);
    render({
      status: { type: "thinking" },
      running: true,
      currentTodos: [],
      executionClock: { startAt: Date.now(), endAt: null },
      summary: { block, allBlocks: [] },
      tokenSpeedLabel: "38 tok/s",
    });
    const label = container.querySelector(
      '[data-testid="summary-trigger-label"]',
    );
    const speed = container.querySelector('[data-testid="turn-speed-visible"]');
    // ① 文案可收缩、单行省略
    expect(label?.className).toContain("min-w-0");
    expect(label?.className).toContain("overflow-hidden");
    expect(label?.className).toContain("text-ellipsis");
    // ② 速率挂在不可收缩的容器里，且不在文案那一层
    expect(speed?.closest(".flex-none")).not.toBeNull();
    expect(label?.contains(speed ?? null)).toBe(false);
    // ③ 仍在同一行
    const actionRow = container.querySelector(
      '[data-testid="dock-status-glyph"]',
    )?.parentElement?.parentElement;
    expect(actionRow?.contains(speed ?? null)).toBe(true);
  });

  it("摘要存在时不再另起动作文案节点（这一行只说一件事）", () => {
    render({
      status: { type: "responding" },
      running: true,
      currentTodos: [],
      executionClock: { startAt: Date.now(), endAt: null },
      summary: { block: BASH_BLOCK, allBlocks: [] },
    });
    expect(
      container.querySelector('[data-testid="dock-action-text"]'),
    ).toBeNull();
  });

  it("组里有多个调用时，钉住正在跑的那一个", () => {
    const block = buildProcessSummaryDisplayBlock([
      { type: "tool_use", id: "b1", name: "bash", input: { command: "ls" } },
      {
        type: "tool_use",
        id: "b2",
        name: "bash",
        input: { command: "npm test", description: "运行相关测试" },
      },
      { type: "tool_use", id: "b3", name: "bash", input: { command: "pwd" } },
    ]);
    render({
      status: { type: "thinking" },
      running: true,
      currentTodos: [],
      summary: {
        block,
        // b1、b3 已有结果，b2 还没有 → 正在跑的是 b2
        allBlocks: [
          { type: "tool_result", toolUseId: "b1", content: "" },
          { type: "tool_result", toolUseId: "b3", content: "" },
        ],
      },
    });
    const label = container.querySelector(
      '[data-testid="summary-trigger-label"]',
    );
    expect(label?.textContent).toBe("运行相关测试");
  });

  it("codemode 里正在跑的嵌套调用也能当这一行的文案", () => {
    const block = buildProcessSummaryDisplayBlock([
      {
        type: "tool_use",
        id: "s1",
        name: "codemode",
        input: { code: "// 读配置" },
        trace: {
          parentToolCallId: "s1",
          status: "running",
          parentStatus: "running",
          complete: false,
          source: "live",
        },
      },
      {
        type: "tool_use",
        id: "n1",
        name: "read",
        input: { path: "src/config.ts" },
        trace: {
          parentToolCallId: "s1",
          status: "running",
          parentStatus: "running",
          complete: false,
          source: "live",
          script: { id: "s1", input: { code: "// 读配置" } },
        },
      },
    ]);
    render({
      status: { type: "thinking" },
      running: true,
      currentTodos: [],
      summary: { block, allBlocks: [] },
    });
    const label = container.querySelector(
      '[data-testid="summary-trigger-label"]',
    );
    expect(label?.textContent).toContain("tool.labelRead");
  });

  it("失败的那一步：文案与失败计数同处一行", () => {
    const block = buildProcessSummaryDisplayBlock([
      {
        type: "tool_use",
        id: "b1",
        name: "bash",
        input: { command: "npm run lint", description: "跑 lint" },
        trace: {
          parentToolCallId: "p1",
          status: "error",
          parentStatus: "error",
          complete: true,
          source: "final",
          script: { id: "p1", input: { command: "npm run lint" } },
        },
      },
    ]);
    render({
      status: { type: "thinking" },
      running: true,
      currentTodos: [],
      summary: { block, allBlocks: [] },
    });
    const label = container.querySelector(
      '[data-testid="summary-trigger-label"]',
    );
    expect(label?.textContent).toBe("跑 lint");
    // 失败计数仍在（与文案同处一行，不互相顶掉）
    expect(
      container.querySelector("[data-tool-group-failure-count]")?.textContent,
    ).toContain("tool.grouped.failedCount");
  });

  it("拿不到 allBlocks 时不把标签钉死（驻留窗口照常结束）", async () => {
    vi.useFakeTimers();
    try {
      render({
        status: { type: "responding" },
        running: true,
        currentTodos: [],
        executionClock: { startAt: Date.now(), endAt: null },
        // 没有 allBlocks：无从判断"是否还在跑" → 按已停处理
        summary: { block: BASH_BLOCK },
      });
      expect(container.textContent).toContain("查看仓库状态和最近提交");
      await act(async () => {
        vi.advanceTimersByTime(STEP_DWELL_MS + 1000);
      });
      expect(container.textContent).not.toContain("查看仓库状态和最近提交");
      expect(container.textContent).toContain("chat.responding");
    } finally {
      vi.useRealTimers();
    }
  });

  it("超长清单只在卡内滚动，不把消息区挤没", () => {
    const many: CurrentTodos = Array.from({ length: 50 }, (_, i) => ({
      content: `第 ${i + 1} 项`,
      status: i === 0 ? ("in_progress" as const) : ("pending" as const),
    }));
    render({ status: { type: "thinking" }, running: true, currentTodos: many });
    const list = container.querySelector("ul");
    expect(list?.className).toContain("max-h-[44vh]");
    expect(list?.className).toContain("overflow-y-auto");
  });
});

describe("resolveDockAction", () => {
  const t = ((key: string) => key) as never;

  it("运行态与会话态文案各自对应", () => {
    expect(resolveDockAction({ type: "sending" }, t)).toEqual({
      text: "chat.sending",
      toneClass: "text-foreground",
      isRunning: true,
    });
    expect(resolveDockAction({ type: "compaction-failed" }, t)).toEqual({
      text: "chat.compactFailed",
      toneClass: "text-muted-foreground",
      isRunning: false,
    });
  });

  it("goal 与子代理状态不进坞（各有归属）", () => {
    expect(
      resolveDockAction(
        { type: "goal-active", objective: "把活干完", iteration: 2 },
        t,
      ),
    ).toBeNull();
    expect(
      resolveDockAction({ type: "background-agent", count: 2 }, t),
    ).toBeNull();
    expect(resolveDockAction(null, t)).toBeNull();
  });
});

// 回合秒表的宽度稳定性与收尾窗口：从 ChatInputStatusBar 的旧测试整组搬来
// （秒表随动作态一起迁进坞）。fake timers 下 Date.now() 也走假时钟。
describe("dock turn clock", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.innerHTML = "";
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  async function render(
    status: Parameters<typeof ChatTaskDock>[0]["status"],
    executionClock?: { startAt: number | null; endAt: number | null },
    running = true,
  ): Promise<void> {
    await act(async () =>
      root.render(
        createElement(ChatTaskDock, {
          status,
          running,
          executionClock,
          currentTodos: PLAN,
        }),
      ),
    );
  }

  /** 只读可见的那一格：隐形哨兵也在 textContent 里，直接读 container 会把它算进来。
   *  返回 null 表示这一格整个不存在（秒表没渲染）—— 与「存在但文本为空」区分开，
   *  否则 toBe("") 在元素缺失时会空过。 */
  function visibleElapsed(): string | null {
    return (
      container.querySelector('[data-testid="turn-elapsed-visible"]')
        ?.textContent ?? null
    );
  }

  it("ticks the running time once per second", async () => {
    const t0 = Date.now();
    await render({ type: "thinking" }, { startAt: t0, endAt: null });
    expect(visibleElapsed()).toBe("chat.elapsedRunning");
    await act(async () => {
      vi.advanceTimersByTime(12_000);
    });
    expect(visibleElapsed()).toBe("chat.elapsedRunning");
    // 具体秒数由格式化函数决定，这里只钉「挂的那一格仍在、且没变成收尾态」
    expect(
      container.querySelectorAll('[data-testid="turn-elapsed-visible"]'),
    ).toHaveLength(1);
  });

  it("shows the frozen time for 5s after the run ends, then hides it", async () => {
    const t0 = Date.now();
    await render({ type: "thinking" }, { startAt: t0, endAt: null });
    await act(async () => {
      vi.advanceTimersByTime(12_000);
    });
    // 这一轮在第 12s 结束：状态已解析成 null，坞只剩收尾窗口撑着
    await render(null, { startAt: t0, endAt: t0 + 12_000 }, false);
    expect(visibleElapsed()).not.toBeNull();
    expect(container.textContent).toContain("chat.elapsedDone");

    await act(async () => {
      vi.advanceTimersByTime(4_000);
    });
    expect(visibleElapsed()).not.toBeNull();

    // 第 5 秒起整块消失（坞与秒表同一刻退场）
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(visibleElapsed()).toBeNull();
    expect(
      container.querySelector('[data-testid="chat-task-dock"]'),
    ).toBeNull();
  });

  it("shows nothing without a clock or without an origin", async () => {
    await render({ type: "thinking" });
    expect(visibleElapsed()).toBeNull();

    await render({ type: "thinking" }, { startAt: null, endAt: null });
    expect(visibleElapsed()).toBeNull();

    await render({ type: "thinking" }, { startAt: Date.now(), endAt: null });
    expect(visibleElapsed()).not.toBeNull();
  });

  it("does not add a second timer next to the goal clock", async () => {
    await render(
      {
        type: "goal-active",
        objective: "fix login",
        iteration: 1,
        timeUsedSeconds: 0,
        activePeriodStartedAt: Date.now(),
      },
      { startAt: Date.now(), endAt: null },
    );
    // 目标态的气归输入框上方的目标段，坞里不该再挂一只秒表
    expect(visibleElapsed()).toBeNull();
    expect(
      container.querySelectorAll('[data-testid="turn-elapsed-slot"]'),
    ).toHaveLength(0);
  });

  it("keeps the slot in the DOM so the row never shifts", async () => {
    await render({ type: "thinking" }, { startAt: Date.now(), endAt: null });
    const slots = container.querySelectorAll(
      '[data-testid="turn-elapsed-slot"]',
    );
    // 只一个哨兵：第二个会让槽位被 stretch 到更宽的子格，留白贴不到 0。
    expect(slots).toHaveLength(1);
    expect(slots[0].getAttribute("aria-hidden")).toBe("true");
    expect(
      container.querySelectorAll('[data-testid="turn-elapsed-visible"]'),
    ).toHaveLength(1);
  });
});

describe("resolveDockStepCandidate", () => {
  const t = ((key: string, options?: Record<string, unknown>) =>
    options ? `${key}:${JSON.stringify(options)}` : key) as never;

  const bash = (id: string, input: Record<string, unknown>) => ({
    type: "tool_use" as const,
    id,
    name: "bash",
    input,
  });

  it("采信 description（人话、非等宽）", () => {
    const block = buildProcessSummaryDisplayBlock([
      bash("b1", {
        command: "git status",
        description: "查看仓库状态和最近提交",
      }),
    ]);
    const found = resolveDockStepCandidate(block, t, new Set());
    expect(found?.key).toBe("b1");
    expect(found?.label).toEqual({
      text: "查看仓库状态和最近提交",
      mono: false,
    });
  });

  it("没有 description 回落到本地动词表", () => {
    const block = buildProcessSummaryDisplayBlock([
      bash("b1", { command: "git status" }),
    ]);
    expect(resolveDockStepCandidate(block, t, new Set())?.label).toEqual({
      text: "tool.step.cmdGitStatus",
      mono: false,
    });
  });

  it("两头都没有就回落 $ 命令，等宽显示", () => {
    const block = buildProcessSummaryDisplayBlock([
      bash("b1", { command: "curl -s https://x.dev" }),
    ]);
    const label = resolveDockStepCandidate(block, t, new Set())?.label;
    expect(label?.mono).toBe(true);
    expect(label?.text).toContain("tool.labelBash");
  });

  it("没有 trace 的调用：本轮还没有它的结果 → 仍在跑", () => {
    const block = buildProcessSummaryDisplayBlock([
      bash("b1", { command: "npm test" }),
    ]);
    expect(resolveDockStepCandidate(block, t, new Set())?.running).toBe(true);
  });

  it("没有 trace 的调用：本轮已有它的结果 → 已停", () => {
    const block = buildProcessSummaryDisplayBlock([
      bash("b1", { command: "npm test" }),
    ]);
    expect(resolveDockStepCandidate(block, t, new Set(["b1"]))?.running).toBe(
      false,
    );
  });

  it("多个调用里优先正在跑的那个，而不是最后一个", () => {
    const block = buildProcessSummaryDisplayBlock([
      bash("b1", { command: "npm test" }),
      bash("b2", { command: "ls" }),
    ]);
    const found = resolveDockStepCandidate(block, t, new Set(["b2"]));
    expect(found?.key).toBe("b1");
    expect(found?.running).toBe(true);
  });

  it("全都停下来了也取最后一条（已跑完 ≠ 没东西可说）", () => {
    const block = buildProcessSummaryDisplayBlock([
      bash("b1", { command: "npm test" }),
      bash("b2", { command: "ls" }),
    ]);
    const found = resolveDockStepCandidate(block, t, new Set(["b1", "b2"]));
    expect(found?.key).toBe("b2");
    expect(found?.running).toBe(false);
  });

  it("codemode 嵌套调用以 trace 为准（trace 存在时不看结果集）", () => {
    const block = buildProcessSummaryDisplayBlock([
      {
        type: "tool_use",
        id: "c1",
        name: "read",
        input: { path: "src/a.ts" },
        trace: {
          parentToolCallId: "p1",
          status: "running",
          parentStatus: "running",
          complete: false,
          source: "live",
        },
      },
    ]);
    const found = resolveDockStepCandidate(block, t, new Set(["c1"]));
    expect(found?.running).toBe(true);
  });

  it("没有 items 时返回 null", () => {
    expect(resolveDockStepCandidate(null, t, new Set())).toBeNull();
    expect(
      resolveDockStepCandidate(
        buildProcessSummaryDisplayBlock([]),
        t,
        new Set(),
      ),
    ).toBeNull();
  });
});

describe("step dwell window", () => {
  const label = { text: "查看目录内容", mono: false };
  const cand = (running: boolean, key = "b1") => ({ key, label, running });

  it("新出现的一步立刻显示，并从此刻起算", () => {
    const { hold, label: shown } = resolveHeldStep(null, cand(true), 1000);
    expect(hold).toEqual({ key: "b1", label, refreshedAt: 1000 });
    expect(shown).toEqual(label);
  });

  it("还在跑就一直刷新时间戳（长命令整段可见）", () => {
    const first = resolveHeldStep(null, cand(true), 0);
    const later = resolveHeldStep(first.hold, cand(true), 8000);
    expect(later.hold?.refreshedAt).toBe(8000);
    expect(later.label).toEqual(label);
  });

  it("停下后 1.5s 内还在显示，之后交还给动作文案", () => {
    const running = resolveHeldStep(null, cand(true), 0);
    // 命令在 100ms 就结束了：同一把 key，时间戳停在最后一次"还在跑"
    const stopped = resolveHeldStep(running.hold, cand(false), 200);
    expect(stopped.hold?.refreshedAt).toBe(0);
    expect(stopped.label).toEqual(label);
    expect(
      resolveHeldStep(stopped.hold, cand(false), STEP_DWELL_MS - 1).label,
    ).toEqual(label);
    expect(
      resolveHeldStep(stopped.hold, cand(false), STEP_DWELL_MS + 1).label,
    ).toBeNull();
  });

  it("驻留期间来了新的一步，立刻换成新的", () => {
    const held = resolveHeldStep(null, cand(false), 0);
    const next = resolveHeldStep(
      held.hold,
      {
        key: "b2",
        label: { text: "运行相关测试", mono: false },
        running: true,
      },
      500,
    );
    expect(next.hold?.key).toBe("b2");
    expect(next.label?.text).toBe("运行相关测试");
  });

  it("同一把 key 的文案变了也要跟上（切语言不留在旧说法）", () => {
    const first = resolveHeldStep(null, cand(false), 0);
    const renamed = resolveHeldStep(
      first.hold,
      {
        key: "b1",
        label: { text: "Running tests", mono: false },
        running: false,
      },
      300,
    );
    expect(renamed.label?.text).toBe("Running tests");
    // 时间戳不动：这不是"新的一步"，驻留窗口不该被续命
    expect(renamed.hold?.refreshedAt).toBe(0);
  });

  it("同一个 now 重复调用结果一致（StrictMode 双渲染安全）", () => {
    const once = resolveHeldStep(null, cand(true), 700);
    const twice = resolveHeldStep(once.hold, cand(true), 700);
    expect(twice.hold).toBe(once.hold);
    expect(twice.label).toEqual(once.label);
  });
});

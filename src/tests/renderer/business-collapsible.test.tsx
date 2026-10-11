// @vitest-environment jsdom
/**
 * Task 9b：ProcessSummaryBlock / ResultSummaryBlock 的外层摘要行，与欢迎页
 * ConnectCards 的「连接订阅」卡和「粘 Key」行，折叠外壳统一改由
 * `components/ui/collapsible.tsx`（Radix Collapsible）承载后的业务契约守卫。
 *
 * 不重测 Radix 自身语义；锁的是迁移不能改掉的既有行为：默认折叠、aria-expanded
 * 与内容状态一致、aria-controls 解析到真实内容 id、触发条仍是可聚焦的原生 button、
 * 折叠与展开两态的计数/分组文案不变、外部自动展开与连接入口 handler/禁用态照旧。
 *
 * 键盘：jsdom 26 不实现 keydown→click 的默认动作（实测原生 button 上派发
 * Enter/Space 后 click 计数仍为 0），且本任务不允许新增 testing-library 依赖；
 * 因此键盘用例锁的是原生 button 契约（真实 `<button type="button">`、可获得焦点）
 * 与「激活即切换」，不伪造 keydown 事件冒充键盘路径。
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProcessSummaryBlock } from "../../renderer/components/message/ProcessSummaryBlock";
import { ResultSummaryBlock } from "../../renderer/components/message/ResultSummaryBlock";
import { ConnectCards } from "../../renderer/components/welcome/connect-cards";
import i18n from "../../renderer/i18n/config";
import { useAppStore, type SessionState } from "../../renderer/store";
import type {
  ContentBlock,
  Message,
  ToolUseContent,
} from "../../renderer/types";
import type { DisplayBlock } from "../../renderer/utils/tool-display-blocks";

const SESSION = "s1";

// ── 两个摘要块的夹具 ──

const READ_1: ToolUseContent = {
  type: "tool_use",
  id: "read-1",
  name: "read",
  input: { file_path: "/tmp/a.ts" },
};
const READ_2: ToolUseContent = {
  type: "tool_use",
  id: "read-2",
  name: "read",
  input: { file_path: "/tmp/b.ts" },
};
const BASH_1: ToolUseContent = {
  type: "tool_use",
  id: "bash-1",
  name: "bash",
  input: { command: "npm run build" },
};
const EDIT_1: ToolUseContent = {
  type: "tool_use",
  id: "edit-1",
  name: "edit",
  input: { file_path: "/tmp/a.ts", old_string: "x", new_string: "y" },
};

const BASH_RESULT: ContentBlock = {
  type: "tool_result",
  toolUseId: "bash-1",
  content: "process-panel-output-marker",
  isError: false,
};

/** zh 文案的完整拼接：两个片段时用「并」连接（`joinAnd`），不换行。 */
const PROCESS_SUMMARY_TEXT = "已读取 2 个文件 并 已执行了 1 条命令";
const RESULT_SUMMARY_TEXT = "已修改 1 个文件并已写入 2 个文件";

const PROCESS_ITEMS: ToolUseContent[] = [READ_1, READ_2, BASH_1];

const processBlock = {
  type: "process-summary",
  items: PROCESS_ITEMS,
  summary: {
    readCount: 2,
    hasSearch: false,
    hasWebSearch: false,
    hasBrowse: false,
    hasMemory: false,
    commandCount: 1,
    subagentCount: 0,
    hasGoal: false,
    usedToolCount: 0,
  },
  scripts: [{ id: "script-1", input: { code: "1 + 1" } }],
} as unknown as Extract<DisplayBlock, { type: "process-summary" }>;

const RESULT_ITEMS: ToolUseContent[] = [EDIT_1];

const resultBlock = {
  type: "result-summary",
  items: RESULT_ITEMS,
  summary: { editedFiles: 1, writtenFiles: 2 },
  files: [
    {
      path: "/tmp/a.ts",
      edits: 1,
      writes: 0,
      addedLines: 0,
      removedLines: 0,
    },
  ],
  scripts: [{ id: "script-2", input: { code: "await edit()" } }],
} as unknown as Extract<DisplayBlock, { type: "result-summary" }>;

function message(blocks: ContentBlock[]): Message {
  return {
    id: "m1",
    sessionId: SESSION,
    role: "assistant",
    timestamp: 1,
    content: blocks,
  };
}

function sessionState(extra: Partial<SessionState> = {}): SessionState {
  return {
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
    ...extra,
  };
}

// ── 渲染工具（仓内无 @testing-library/*，沿用 tool-collapsible 的 root+act 先例）──

let container: HTMLDivElement;
let root: Root;

async function render(el: ReactElement): Promise<void> {
  await act(async () => {
    root.render(el);
  });
}

async function activate(el: HTMLElement | null): Promise<void> {
  await act(async () => {
    el?.click();
  });
}

function firstToggle(scope: HTMLElement): HTMLButtonElement {
  return scope.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
}

/** 触发器 aria-controls 指向的那个节点；折叠时原语不下发 aria-controls，这里就是 null。 */
function panelOf(trigger: HTMLElement): HTMLElement | null {
  const id = trigger.getAttribute("aria-controls");
  return id ? document.getElementById(id) : null;
}

/** 摘要行文本（忽略图标与折行空白）。 */
function textOf(el: HTMLElement): string {
  return (el.textContent ?? "").replace(/\s+/g, " ").trim();
}

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("zh");
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({ sessionStates: { [SESSION]: sessionState() } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  document.body.innerHTML = "";
});

// ── 两个摘要块共用的外层折叠语义 ──

interface SummaryCase {
  label: string;
  /** 折叠态就应出现在摘要行里的计数/分组文案（zh 文案原样钉住）。 */
  summaryText: string;
  /** 展开后内容区里稳定存在的分组入口。 */
  el: () => ReactElement;
  /** 触发该块自动展开的 store 目标 id（items 或 scripts 里的一个）。 */
  pendingId: string;
}

const CASES: SummaryCase[] = [
  {
    label: "ProcessSummaryBlock",
    summaryText: PROCESS_SUMMARY_TEXT,
    pendingId: "read-2",
    el: () =>
      createElement(ProcessSummaryBlock, {
        block: processBlock,
        allBlocks: [...PROCESS_ITEMS, BASH_RESULT],
        message: message([...PROCESS_ITEMS, BASH_RESULT]),
      }),
  },
  {
    label: "ResultSummaryBlock",
    summaryText: RESULT_SUMMARY_TEXT,
    pendingId: "edit-1",
    el: () =>
      createElement(ResultSummaryBlock, {
        block: resultBlock,
        allBlocks: RESULT_ITEMS,
        message: message(RESULT_ITEMS),
      }),
  },
];

describe.each(CASES)(
  "$label 外层折叠语义",
  ({ summaryText, el, pendingId }) => {
    it("默认折叠：摘要行的 aria-expanded 与内容同时为关，正文不挂载", async () => {
      await render(el());

      const trigger = firstToggle(container);
      expect(trigger.tagName).toBe("BUTTON");
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      // 摘要行自己的开合就是这块的状态：折叠态没有任何内容节点，也不留 open 标记。
      expect(panelOf(trigger)).toBeNull();
      expect(container.querySelector('[data-state="open"]')).toBeNull();
      expect(textOf(trigger)).toBe(summaryText);
    });

    it("点击摘要行展开：aria-controls 解析到真实内容 id", async () => {
      await render(el());

      const trigger = firstToggle(container);
      await activate(trigger);

      expect(trigger.getAttribute("aria-expanded")).toBe("true");
      expect(trigger.getAttribute("data-state")).toBe("open");
      const panel = panelOf(trigger);
      expect(panel, "展开后必须能由 aria-controls 找到内容节点").not.toBeNull();
      expect(panel!.dataset.state).toBe("open");
      expect(panel!.hidden).toBe(false);
      // 展开的是内容区：脚本详情入口是分组内的稳定标记。
      expect(panel!.textContent).toContain(
        i18n.t("tool.grouped.scriptDetails"),
      );
    });

    it("折叠与展开两态的计数/分组文案完全一致", async () => {
      await render(el());

      const trigger = firstToggle(container);
      expect(textOf(trigger)).toBe(summaryText);

      await activate(trigger);
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
      expect(textOf(firstToggle(container))).toBe(summaryText);

      await activate(trigger);
      expect(textOf(firstToggle(container))).toBe(summaryText);
    });

    it("触发条是原生 button：聚焦后激活（Enter/Space 默认动作）切换", async () => {
      await render(el());

      const trigger = firstToggle(container);
      expect(trigger.getAttribute("type")).toBe("button");
      trigger.focus();
      expect(document.activeElement).toBe(trigger);

      // 原生 button 上 Enter 与 Space 都派发 click；jsdom 不实现该默认动作，
      // 这里直接走与真实按键同一条激活路径，不伪造 keydown。
      await activate(trigger);
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
      await activate(trigger);
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
    });

    it("折叠后重开：正文按原 keep-mounted 策略卸载再挂回", async () => {
      await render(el());

      const trigger = firstToggle(container);
      await activate(trigger);
      const firstId = trigger.getAttribute("aria-controls");
      expect(firstId).not.toBeNull();
      expect(document.getElementById(firstId!)!.textContent).toContain(
        i18n.t("tool.grouped.scriptDetails"),
      );

      // 原策略是关闭即卸载（没有 forceMount），迁移后语义不变。
      await activate(trigger);
      expect(trigger.getAttribute("aria-controls")).toBeNull();
      expect(document.getElementById(firstId!)).toBeNull();
      expect(container.textContent).not.toContain(
        i18n.t("tool.grouped.scriptDetails"),
      );

      await activate(trigger);
      const reopened = panelOf(trigger);
      expect(reopened, "重开后内容节点必须再次可寻址").not.toBeNull();
      expect(reopened!.textContent).toContain(
        i18n.t("tool.grouped.scriptDetails"),
      );
    });

    it("外部请求的自动展开同样落到同一原语上", async () => {
      useAppStore.setState({ pendingExpandToolCallId: pendingId });
      await render(el());

      const trigger = firstToggle(container);
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
      const panel = panelOf(trigger);
      expect(panel).not.toBeNull();
      // 一次性消费：之后手动收起不会被再次顶开。
      expect(useAppStore.getState().pendingExpandToolCallId).toBeNull();
      await activate(trigger);
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      expect(panelOf(trigger)).toBeNull();
    });
  },
);

describe("ResultSummaryBlock 折叠态的文件摘要行", () => {
  it("文件行不受外层开合影响，展开后仍在", async () => {
    await render(CASES[1].el());

    expect(container.textContent).toContain("a.ts");
    await activate(firstToggle(container));
    expect(container.textContent).toContain("a.ts");
    expect(firstToggle(container).getAttribute("aria-expanded")).toBe("true");
  });
});

// ── 欢迎页 ConnectCards 的两处折叠 ──

const KEY_BAILIAN = "custom:subscription-bailian-coding";
const KEY_ARK = "custom:subscription-ark-coding";

interface ConnectHandlers {
  // 显式标注签名：否则 vi.fn() 的通用 Mock 类型不能赋给组件的动作签名
  onOpenCloud: ReturnType<typeof vi.fn<() => void>>;
  onOpenApiKey: ReturnType<typeof vi.fn<() => void>>;
  onConnectOAuth: ReturnType<
    typeof vi.fn<(providerId: string, name: string) => Promise<void>>
  >;
  onConnectSubscription: ReturnType<
    typeof vi.fn<(profileKey: string, apiKey: string) => Promise<void>>
  >;
}

function connectEl(handlers: ConnectHandlers): ReactElement {
  return createElement(ConnectCards, {
    onOpenCloud: handlers.onOpenCloud,
    onOpenApiKey: handlers.onOpenApiKey,
    onConnectOAuth: handlers.onConnectOAuth,
    onConnectSubscription: handlers.onConnectSubscription,
  });
}

function connectHandlers(): ConnectHandlers {
  return {
    onOpenCloud: vi.fn(),
    onOpenApiKey: vi.fn(),
    onConnectOAuth: vi.fn(async () => {}),
    onConnectSubscription: vi.fn(async () => {}),
  };
}

function byTestId<T extends HTMLElement>(id: string): T | null {
  return container.querySelector<T>(`[data-testid="${id}"]`);
}

function subscriptionCard(): HTMLButtonElement {
  return byTestId<HTMLButtonElement>("connect-card-subscription")!;
}

describe("ConnectCards 折叠外壳", () => {
  it("连接订阅卡：默认折叠，点击展开出全部入口，再点收起", async () => {
    const handlers = connectHandlers();
    await render(connectEl(handlers));

    const card = subscriptionCard();
    expect(card.getAttribute("aria-expanded")).toBe("false");
    expect(panelOf(card)).toBeNull();
    expect(byTestId("connect-row-anthropic")).toBeNull();

    await activate(card);
    expect(card.getAttribute("aria-expanded")).toBe("true");
    const panel = panelOf(card);
    expect(panel, "展开后必须能由 aria-controls 找到面板").not.toBeNull();
    for (const row of [
      "connect-row-anthropic",
      "connect-row-openai-codex",
      "connect-row-github-copilot",
      "connect-row-openrouter",
      `connect-row-${KEY_BAILIAN}`,
      `connect-row-${KEY_ARK}`,
    ]) {
      expect(byTestId(row), `${row} 必须仍在展开面板里`).not.toBeNull();
    }
    expect(panel!.textContent).toContain(i18n.t("connect.groupOAuth"));
    expect(panel!.textContent).toContain(
      i18n.t("connect.groupSubscriptionKey"),
    );

    // 点它只开合自己，不触发任何连接动作。
    expect(handlers.onOpenCloud).not.toHaveBeenCalled();
    expect(handlers.onOpenApiKey).not.toHaveBeenCalled();
    expect(handlers.onConnectOAuth).not.toHaveBeenCalled();
    expect(handlers.onConnectSubscription).not.toHaveBeenCalled();

    await activate(card);
    expect(card.getAttribute("aria-expanded")).toBe("false");
    expect(panelOf(card)).toBeNull();
    expect(byTestId("connect-row-anthropic")).toBeNull();
  });

  it("三张卡各只执行自身 action，触发条仍是可聚焦的原生 button", async () => {
    const handlers = connectHandlers();
    await render(connectEl(handlers));

    const card = subscriptionCard();
    expect(card.tagName).toBe("BUTTON");
    expect(card.getAttribute("type")).toBe("button");
    card.focus();
    expect(document.activeElement).toBe(card);
    await activate(card);
    expect(card.getAttribute("aria-expanded")).toBe("true");
    await activate(card);
    expect(card.getAttribute("aria-expanded")).toBe("false");

    await activate(byTestId("connect-card-cloud"));
    expect(handlers.onOpenCloud).toHaveBeenCalledTimes(1);
    expect(handlers.onOpenApiKey).not.toHaveBeenCalled();

    await activate(byTestId("connect-card-api-key"));
    expect(handlers.onOpenApiKey).toHaveBeenCalledTimes(1);
    expect(handlers.onConnectOAuth).not.toHaveBeenCalled();
    expect(handlers.onConnectSubscription).not.toHaveBeenCalled();
  });

  it("粘 Key 行：行内展开只影响自身，保存走原 handler，pending 期间入口禁用", async () => {
    const handlers = connectHandlers();
    let resolveSave: (() => void) | undefined;
    handlers.onConnectSubscription.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );
    await render(connectEl(handlers));
    await activate(subscriptionCard());

    const rowA = byTestId<HTMLButtonElement>(`connect-row-${KEY_BAILIAN}`)!;
    const rowB = byTestId<HTMLButtonElement>(`connect-row-${KEY_ARK}`)!;
    expect(rowA.getAttribute("aria-expanded")).toBe("false");

    await activate(rowA);
    expect(rowA.getAttribute("aria-expanded")).toBe("true");
    const rowPanel = panelOf(rowA);
    expect(rowPanel, "行内输入区必须能由 aria-controls 找到").not.toBeNull();
    expect(byTestId(`connect-key-input-${KEY_BAILIAN}`)).not.toBeNull();

    // 打开另一行时上一行收起：keyRow 仍是单个受控状态。
    await activate(rowB);
    expect(rowB.getAttribute("aria-expanded")).toBe("true");
    expect(rowA.getAttribute("aria-expanded")).toBe("false");

    const input = byTestId<HTMLInputElement>(`connect-key-input-${KEY_ARK}`)!;
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setValue.call(input, "  sk-ark-test  ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await activate(byTestId(`connect-key-save-${KEY_ARK}`));
    expect(handlers.onConnectSubscription).toHaveBeenCalledTimes(1);
    expect(handlers.onConnectSubscription).toHaveBeenCalledWith(
      KEY_ARK,
      "sk-ark-test",
    );
    // pending 期间所有入口禁用：再点不会重复提交。
    expect(
      byTestId<HTMLButtonElement>(`connect-key-save-${KEY_ARK}`)!.disabled,
    ).toBe(true);
    expect(
      byTestId<HTMLButtonElement>(`connect-row-${KEY_BAILIAN}`)!.disabled,
    ).toBe(true);
    await activate(byTestId(`connect-key-save-${KEY_ARK}`));
    await activate(byTestId("connect-row-anthropic"));
    expect(handlers.onConnectSubscription).toHaveBeenCalledTimes(1);
    expect(handlers.onConnectOAuth).not.toHaveBeenCalled();

    // 成功后收起该行并清空草稿（原逻辑：setKeyRow(null) + setKeyDraft("")）。
    await act(async () => {
      resolveSave?.();
    });
    expect(rowB.getAttribute("aria-expanded")).toBe("false");
    expect(byTestId(`connect-key-input-${KEY_ARK}`)).toBeNull();
  });
});

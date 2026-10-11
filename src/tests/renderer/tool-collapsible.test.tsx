// @vitest-environment jsdom
/**
 * Task 9a：Bash / File / ToolResult / ToolUse 四个工具块的外层折叠改由
 * `components/ui/collapsible.tsx`（Radix Collapsible）承载后的业务契约守卫。
 *
 * 不重测 Radix 自身语义；锁的是迁移不能改掉的既有行为：折叠隐藏 / 展开可见、
 * aria 关联由原语下发、流式与晚到结果仍保持展开、关闭重开后正文与正文内 handler
 * 仍按原逻辑工作、失败态与附件仍渲染。
 *
 * 键盘：jsdom 26 不实现 keydown→click 的默认动作（实测原生 button 上派发
 * Enter/Space 后 click 计数仍为 0），且本任务不允许新增 testing-library 依赖；
 * 因此键盘用例锁的是原生 button 契约（真实 `<button type="button">`、可获得焦点）
 * 与「激活即切换」，不伪造 keydown 事件冒充键盘路径。
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BashToolBlock } from "../../renderer/components/message/BashToolBlock";
import { FileToolBlock } from "../../renderer/components/message/FileToolBlock";
import { ToolResultBlock } from "../../renderer/components/message/ToolResultBlock";
import { ToolUseBlock } from "../../renderer/components/message/ToolUseBlock";
import i18n from "../../renderer/i18n/config";
import { useAppStore, type SessionState } from "../../renderer/store";
import type {
  ContentBlock,
  Message,
  ToolResultContent,
  ToolUseContent,
} from "../../renderer/types";

const SESSION = "s1";
const TURN = { turnId: "turn-1", userMessageId: "user-1" };

const BASH_USE: ToolUseContent = {
  type: "tool_use",
  id: "bash-1",
  name: "bash",
  input: { command: "npm run build" },
};
const FILE_USE: ToolUseContent = {
  type: "tool_use",
  id: "read-1",
  name: "read",
  input: { path: "src/marker.ts" },
};
const GREP_USE: ToolUseContent = {
  type: "tool_use",
  id: "grep-1",
  name: "grep",
  input: { pattern: "needle" },
};
const ORPHAN_RESULT: ToolResultContent = {
  type: "tool_result",
  toolUseId: "orphan-1",
  content: "orphan-output-marker",
  isError: false,
};

function message(block: ContentBlock): Message {
  return {
    id: "m1",
    sessionId: SESSION,
    role: "assistant",
    timestamp: 1,
    content: [block],
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

const writeText = vi.fn<(text: string) => Promise<void>>(async () => {});

interface Harness {
  container: HTMLDivElement;
  render: (el: ReactElement) => Promise<void>;
  updateStore: (extra: Partial<SessionState>) => Promise<void>;
}

const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

function harness(storeExtra: Partial<SessionState> = {}): Harness {
  useAppStore.setState({
    sessionStates: { [SESSION]: sessionState(storeExtra) },
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  return {
    container,
    async render(el) {
      await act(async () => {
        root.render(el);
      });
    },
    async updateStore(extra) {
      await act(async () => {
        useAppStore.setState({
          sessionStates: {
            [SESSION]: sessionState({ ...storeExtra, ...extra }),
          },
        });
      });
    },
  };
}

function trigger(container: HTMLElement): HTMLButtonElement {
  return container.querySelector<HTMLButtonElement>("button")!;
}

/** aria-controls 指向的那个节点；折叠时原语不下发 aria-controls，这里就是 null。 */
function panel(container: HTMLElement): HTMLElement | null {
  const id = trigger(container).getAttribute("aria-controls");
  return id ? document.getElementById(id) : null;
}

async function activate(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.click();
  });
}

async function expand(container: HTMLElement): Promise<HTMLElement> {
  await activate(trigger(container));
  const node = panel(container);
  expect(node, "展开后必须能由 aria-controls 找到内容节点").not.toBeNull();
  return node!;
}

// ── 四个组件的最小 fixture（形状取自 renderer/types 与既有工具块测试）──

const bashEl = (result?: ToolResultContent) =>
  createElement(BashToolBlock, {
    block: BASH_USE,
    allBlocks: result ? [BASH_USE, result] : [BASH_USE],
    message: message(BASH_USE),
  });

const bashResult = (content: string, isError = false): ToolResultContent => ({
  type: "tool_result",
  toolUseId: BASH_USE.id,
  content,
  isError,
});

const fileEl = (result: ToolResultContent) =>
  createElement(FileToolBlock, {
    block: FILE_USE,
    allBlocks: [FILE_USE, result],
    message: message(FILE_USE),
    action: "read" as const,
  });

const fileResult = (content: string, isError = false): ToolResultContent => ({
  type: "tool_result",
  toolUseId: FILE_USE.id,
  content,
  isError,
});

const toolEl = (result?: ToolResultContent) =>
  createElement(ToolUseBlock, {
    block: GREP_USE,
    allBlocks: result ? [GREP_USE, result] : [GREP_USE],
    message: message(GREP_USE),
  });

const grepResult = (content: string, isError = false): ToolResultContent => ({
  type: "tool_result",
  toolUseId: GREP_USE.id,
  content,
  isError,
});

const orphanEl = (block: ToolResultContent) =>
  createElement(ToolResultBlock, {
    block,
    allBlocks: [block],
    message: message(block),
  });

const IMAGE = { mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUg==" };

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({ sessionStates: { [SESSION]: sessionState() } });
  writeText.mockClear();
  Object.defineProperty(window.navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

afterEach(async () => {
  while (mounted.length > 0) {
    const entry = mounted.pop()!;
    await act(async () => {
      entry.root.unmount();
    });
    entry.container.remove();
  }
  document.body.innerHTML = "";
});

// ── 四块共用的折叠语义 ──

const CASES: Array<{
  label: string;
  marker: string;
  el: () => ReactElement;
}> = [
  {
    label: "BashToolBlock",
    marker: "bash-output-marker",
    el: () => bashEl(bashResult("bash-output-marker")),
  },
  {
    label: "FileToolBlock",
    marker: "fileOutputMarker",
    el: () => fileEl(fileResult("  1\tconst fileOutputMarker = 1\n")),
  },
  {
    label: "ToolResultBlock",
    marker: "orphan-output-marker",
    el: () => orphanEl(ORPHAN_RESULT),
  },
  {
    label: "ToolUseBlock",
    marker: "tool-output-marker",
    el: () => toolEl(grepResult("tool-output-marker")),
  },
];

describe.each(CASES)("$label 折叠语义", ({ marker, el }) => {
  it("默认折叠：正文不在 DOM，aria-expanded=false", async () => {
    const h = harness();
    await h.render(el());

    const t = trigger(h.container);
    expect(t.getAttribute("aria-expanded")).toBe("false");
    expect(h.container.querySelector('[data-state="closed"]')).not.toBeNull();
    // 没展开过：原语不下发 aria-controls，内容节点也不存在
    expect(t.getAttribute("aria-controls")).toBeNull();
    expect(panel(h.container)).toBeNull();
  });

  it("点击标题行展开：aria-controls 指向真实内容 id", async () => {
    const h = harness();
    await h.render(el());

    const t = trigger(h.container);
    const node = await expand(h.container);

    expect(t.getAttribute("aria-expanded")).toBe("true");
    expect(node.dataset.state).toBe("open");
    expect(node.hidden).toBe(false);
    expect(node.textContent).toContain(marker);

    // 关闭后内容必须真的从 DOM 卸载：不接受 hidden 占位的退场残留。
    // 迁移前是 `{expanded && …}`，Radix Presence 的退场宽限不能把懒挂载改掉。
    const contentId = t.getAttribute("aria-controls")!;
    await activate(t);
    expect(document.getElementById(contentId)).toBeNull();
    expect(t.getAttribute("aria-controls")).toBeNull();
    expect(panel(h.container)).toBeNull();
  });

  it("触发条是原生 button：聚焦后激活（Enter/Space 默认动作）切换", async () => {
    const h = harness();
    await h.render(el());

    const t = trigger(h.container);
    expect(t.tagName).toBe("BUTTON");
    expect(t.getAttribute("type")).toBe("button");
    t.focus();
    expect(document.activeElement).toBe(t);

    // 原生 button 上 Enter 与 Space 都派发 click；jsdom 不实现该默认动作，
    // 这里直接走与真实按键同一条激活路径，不伪造 keydown。
    await activate(t);
    expect(t.getAttribute("aria-expanded")).toBe("true");
    await activate(t);
    expect(t.getAttribute("aria-expanded")).toBe("false");
  });

  it("关闭后重开：正文仍在", async () => {
    const h = harness();
    await h.render(el());

    const first = await expand(h.container);
    expect(first.textContent).toContain(marker);
    const firstId = first.id;
    await activate(trigger(h.container));
    expect(document.getElementById(firstId)).toBeNull();
    expect(panel(h.container)).toBeNull();

    const second = await expand(h.container);
    expect(second.textContent).toContain(marker);
    expect(trigger(h.container).getAttribute("aria-expanded")).toBe("true");
  });
});

// ── Bash：流式 partial 更新与晚到最终结果 ──

describe("BashToolBlock 流式与失败", () => {
  it("流式 partial 更新后仍展开且全文更新", async () => {
    const h = harness({
      activeTurn: TURN,
      partialToolResults: {
        [BASH_USE.id]: { content: "bash-stream-1", isError: false },
      },
    });
    await h.render(bashEl());

    const first = await expand(h.container);
    expect(first.textContent).toContain("bash-stream-1");

    await h.updateStore({
      activeTurn: TURN,
      partialToolResults: {
        [BASH_USE.id]: {
          content: "bash-stream-1\nbash-stream-2",
          isError: false,
        },
      },
    });

    expect(trigger(h.container).getAttribute("aria-expanded")).toBe("true");
    const updated = panel(h.container)!;
    expect(updated.textContent).toContain("bash-stream-1");
    expect(updated.textContent).toContain("bash-stream-2");
  });

  it("晚到的最终结果替换流式区，仍展开且全文可见", async () => {
    const h = harness({
      activeTurn: TURN,
      partialToolResults: {
        [BASH_USE.id]: { content: "bash-stream-1", isError: false },
      },
    });
    await h.render(bashEl());
    await expand(h.container);

    await h.render(bashEl(bashResult("bash-final-marker\nsecond line")));

    expect(trigger(h.container).getAttribute("aria-expanded")).toBe("true");
    const node = panel(h.container)!;
    expect(node.textContent).toContain("bash-final-marker");
    expect(node.textContent).toContain("second line");
    expect(node.textContent).not.toContain("bash-stream-1");
  });

  it("失败态正文与破坏色仍渲染", async () => {
    const h = harness();
    await h.render(bashEl(bashResult("bash-error-marker", true)));

    const node = await expand(h.container);
    expect(node.textContent).toContain("bash-error-marker");
    expect(h.container.querySelector(".bg-destructive\\/5")).not.toBeNull();
  });
});

// ── File：晚到新结果、复制 handler、失败态 ──

describe("FileToolBlock 结果更新与复制", () => {
  it("打开状态下拿到新结果：仍展开且全文更新", async () => {
    const h = harness();
    await h.render(fileEl(fileResult("  1\tconst firstMarker = 1\n")));
    await expand(h.container);
    expect(h.container.textContent).toContain("firstMarker");

    await h.render(
      fileEl(
        fileResult("  1\tconst firstMarker = 1\n  2\tconst secondMarker = 2\n"),
      ),
    );

    expect(trigger(h.container).getAttribute("aria-expanded")).toBe("true");
    const node = panel(h.container)!;
    expect(node.textContent).toContain("firstMarker");
    expect(node.textContent).toContain("secondMarker");
  });

  it("关闭重开后复制 handler 各调一次原逻辑，且点复制不折叠", async () => {
    const h = harness();
    await h.render(fileEl(fileResult("  1\tconst copyMarker = 1\n")));
    await expand(h.container);

    await activate(
      panel(h.container)!.querySelector<HTMLButtonElement>("button")!,
    );
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("const copyMarker = 1\n");
    // 正文内的 action 不能穿透到折叠触发器
    expect(trigger(h.container).getAttribute("aria-expanded")).toBe("true");

    await activate(trigger(h.container));
    await expand(h.container);
    await act(async () => {
      panel(h.container)!.querySelector<HTMLButtonElement>("button")!.click();
    });

    expect(writeText).toHaveBeenCalledTimes(2);
    expect(writeText.mock.calls[1][0]).toBe("const copyMarker = 1\n");
  });

  it("失败态渲染原始错误正文", async () => {
    const h = harness();
    await h.render(fileEl(fileResult("file-error-marker", true)));

    const node = await expand(h.container);
    expect(node.textContent).toContain("file-error-marker");
    expect(node.querySelector("pre.text-destructive")).not.toBeNull();
  });
});

// ── ToolResult：晚到新结果、失败态、附件 ──

describe("ToolResultBlock 结果更新与附件", () => {
  it("打开状态下拿到新结果：仍展开且全文更新", async () => {
    const h = harness();
    await h.render(
      orphanEl({ ...ORPHAN_RESULT, content: "orphan-first-marker" }),
    );
    await expand(h.container);

    const next = { ...ORPHAN_RESULT, content: "orphan-second-marker" };
    await h.render(
      createElement(ToolResultBlock, {
        block: next,
        allBlocks: [next],
        message: message(ORPHAN_RESULT),
      }),
    );

    expect(trigger(h.container).getAttribute("aria-expanded")).toBe("true");
    const node = panel(h.container)!;
    expect(node.textContent).toContain("orphan-second-marker");
    expect(node.textContent).not.toContain("orphan-first-marker");
  });

  it("失败态正文仍渲染", async () => {
    const h = harness();
    await h.render(orphanEl({ ...ORPHAN_RESULT, isError: true }));

    const node = await expand(h.container);
    expect(node.textContent).toContain("orphan-output-marker");
    expect(node.querySelector("pre.text-destructive")).not.toBeNull();
  });

  it("附件图片仍渲染，且非白名单 MIME 被过滤", async () => {
    const h = harness();
    await h.render(
      orphanEl({
        ...ORPHAN_RESULT,
        content: "image-output-marker",
        images: [IMAGE, { mimeType: "image/svg+xml", data: "PHN2Zz4=" }],
      }),
    );

    const node = await expand(h.container);
    const images = node.querySelectorAll("img");
    expect(images).toHaveLength(1);
    expect(images[0].getAttribute("src")).toBe(
      `data:image/png;base64,${IMAGE.data}`,
    );
    expect(node.textContent).toContain("image-output-marker");
  });
});

// ── ToolUse：流式、失败态、附件、嵌套子代理步骤 ──

describe("ToolUseBlock 流式、失败态与嵌套展示", () => {
  it("流式 partial 更新后仍展开且全文更新", async () => {
    const h = harness({
      activeTurn: TURN,
      partialToolResults: {
        [GREP_USE.id]: { content: "grep-stream-1", isError: false },
      },
    });
    await h.render(toolEl());

    const first = await expand(h.container);
    expect(first.textContent).toContain("grep-stream-1");

    await h.updateStore({
      activeTurn: TURN,
      partialToolResults: {
        [GREP_USE.id]: {
          content: "grep-stream-1\ngrep-stream-2",
          isError: false,
        },
      },
    });

    expect(trigger(h.container).getAttribute("aria-expanded")).toBe("true");
    const node = panel(h.container)!;
    expect(node.textContent).toContain("grep-stream-1");
    expect(node.textContent).toContain("grep-stream-2");
  });

  it("失败态输出仍带破坏色", async () => {
    const h = harness();
    await h.render(toolEl(grepResult("tool-error-marker", true)));

    const node = await expand(h.container);
    expect(node.textContent).toContain("tool-error-marker");
    expect(node.querySelector("pre.text-destructive")).not.toBeNull();
  });

  it("附件图片仍渲染", async () => {
    const h = harness();
    await h.render(
      toolEl({
        ...grepResult("tool-image-text"),
        images: [IMAGE],
      }),
    );

    const node = await expand(h.container);
    const images = node.querySelectorAll("img");
    expect(images).toHaveLength(1);
    expect(images[0].getAttribute("src")).toBe(
      `data:image/png;base64,${IMAGE.data}`,
    );
  });

  it("嵌套子代理步骤区仍在展开内容里", async () => {
    const h = harness({
      subagentActivities: {
        [GREP_USE.id]: {
          sessionId: SESSION,
          agentId: "agent-1",
          parentToolCallId: GREP_USE.id,
          status: "running",
          steps: [],
          stats: { toolUses: 1, durationMs: 42 },
        },
      },
    });
    await h.render(toolEl());

    const node = await expand(h.container);
    // 42ms 只可能来自 SubagentSteps 的统计行（traceSteps 为空）
    expect(node.textContent).toContain("42ms");
  });
});

// ── Task 9a 专项（ToolResult / ToolUse 两个组件）：折叠壳契约与重路径守卫 ──
//
// 与上面四块共用的用例刻意分开：这里只锁这两个组件自己的契约 —— Trigger 与
// Content 的 aria 关联、键盘可达性，以及展开区里的重路径（ask_user 专属卡片、
// 子代理步骤区、diff 行、附件图片）没有在换折叠壳时被带坏。
// 键盘口径同文件头：jsdom 不实现原生 button 的 Enter/Space 默认动作，这里锁的是
// 「真实 <button type="button"> + 可聚焦 + 走同一条激活切换路径」，不伪造 keydown。

const RES_ORPHAN_BASE: ToolResultContent = {
  type: "tool_result",
  toolUseId: "res-orphan-9a",
  content: "res-collapsed-marker",
  isError: false,
};

const resEl = (block: ToolResultContent = RES_ORPHAN_BASE) =>
  createElement(ToolResultBlock, {
    block,
    allBlocks: [block],
    message: message(block),
  });

const STREAM_USE: ToolUseContent = {
  type: "tool_use",
  id: "use-stream-9a",
  name: "grep",
  input: { pattern: "collapsible" },
};

const useEl = (
  result?: ToolResultContent,
  block: ToolUseContent = STREAM_USE,
) =>
  createElement(ToolUseBlock, {
    block,
    allBlocks: result ? [block, result] : [block],
    message: message(block),
  });

const useResult = (
  extra: Partial<ToolResultContent> = {},
): ToolResultContent => ({
  type: "tool_result",
  toolUseId: STREAM_USE.id,
  content: "use-output-marker",
  isError: false,
  ...extra,
});

const ASK_USE: ToolUseContent = {
  type: "tool_use",
  id: "ask-9a",
  name: "ask_user",
  input: {
    questions: [
      {
        question: "部署到生产环境吗？",
        header: "部署",
        type: "choice",
        options: [
          { label: "AskOptionRelease", description: "立即发布" },
          { label: "AskOptionHold", description: "先等一下" },
        ],
      },
    ],
  },
};

const AGENT_USE: ToolUseContent = {
  type: "tool_use",
  id: "agent-9a",
  name: "Agent",
  input: { subagent_type: "Explore", description: "找折叠壳" },
};

describe("ToolResultBlock 折叠壳（task-9a 专项）", () => {
  it("默认折叠：正文与附件都不在 DOM，aria-expanded=false", async () => {
    const h = harness();
    await h.render(resEl({ ...RES_ORPHAN_BASE, images: [IMAGE] }));

    const t = trigger(h.container);
    expect(t.getAttribute("aria-expanded")).toBe("false");
    // 标题行里的摘要会回显正文片段，所以这里只锁「正文容器不存在」：
    // 折叠时既没有 pre，也没有附件图片。
    expect(h.container.querySelector("pre")).toBeNull();
    expect(h.container.querySelector("img")).toBeNull();
    expect(panel(h.container)).toBeNull();
  });

  it("点击标题行展开：aria-controls 与内容节点同一 id，收起后回到关闭态", async () => {
    const h = harness();
    await h.render(resEl());

    const t = trigger(h.container);
    await activate(t);

    expect(t.getAttribute("aria-expanded")).toBe("true");
    const contentId = t.getAttribute("aria-controls");
    expect(contentId).toBeTruthy();
    const node = document.getElementById(contentId!);
    expect(node).not.toBeNull();
    // Trigger 的 aria-controls 必须落到同一个 id 的内容节点上
    expect(node!.id).toBe(contentId);
    expect(node).toBe(panel(h.container));
    expect(node!.dataset.state).toBe("open");
    expect(node!.hidden).toBe(false);
    expect(node!.textContent).toContain("res-collapsed-marker");

    await activate(t);
    expect(t.getAttribute("aria-expanded")).toBe("false");
    expect(panel(h.container)).toBeNull();
    // 收起即卸载：不能留着 hidden 的空壳节点
    expect(document.getElementById(contentId!)).toBeNull();
  });

  it('触发条是原生 <button type="button">：可聚焦，激活切换且 aria-expanded 跟随', async () => {
    const h = harness();
    await h.render(resEl());

    const t = trigger(h.container);
    expect(t.tagName).toBe("BUTTON");
    expect(t.getAttribute("type")).toBe("button");
    expect(t.hasAttribute("disabled")).toBe(false);
    expect(t.tabIndex).toBeGreaterThanOrEqual(0);
    t.focus();
    expect(document.activeElement).toBe(t);

    // 原生 button 上 Enter 与 Space 都派发 click；jsdom 不实现该默认动作，
    // 这里直接走与真实按键同一条激活路径，不伪造 keydown。
    await activate(t);
    expect(t.getAttribute("aria-expanded")).toBe("true");
    await activate(t);
    expect(t.getAttribute("aria-expanded")).toBe("false");
    expect(panel(h.container)).toBeNull();
  });

  it("展开后拿到更新的结果：仍保持展开且正文整体替换", async () => {
    const h = harness();
    await h.render(resEl({ ...RES_ORPHAN_BASE, content: "res-first-marker" }));
    await expand(h.container);
    expect(h.container.textContent).toContain("res-first-marker");

    await h.render(resEl({ ...RES_ORPHAN_BASE, content: "res-second-marker" }));

    expect(trigger(h.container).getAttribute("aria-expanded")).toBe("true");
    const node = panel(h.container)!;
    expect(node.textContent).toContain("res-second-marker");
    expect(node.textContent).not.toContain("res-first-marker");
  });

  it("失败态：破坏色正文与长输出滚动容器保留", async () => {
    const h = harness();
    await h.render(
      resEl({
        ...RES_ORPHAN_BASE,
        content: `${Array.from({ length: 40 }, (_, i) => `res-error-line-${i}`).join("\n")}\n`,
        isError: true,
      }),
    );

    const node = await expand(h.container);
    const pre = node.querySelector("pre.text-destructive");
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toContain("res-error-line-39");
    expect(pre!.className).toContain("overflow-y-auto");
    expect(pre!.className).toContain("max-h-[300px]");
  });

  it("附件图片仍在展开内容里渲染，非白名单 MIME 仍被过滤", async () => {
    const h = harness();
    await h.render(
      resEl({
        ...RES_ORPHAN_BASE,
        content: "res-image-text",
        images: [IMAGE, { mimeType: "image/svg+xml", data: "PHN2Zz4=" }],
      }),
    );

    const node = await expand(h.container);
    const images = node.querySelectorAll("img");
    expect(images).toHaveLength(1);
    expect(images[0].getAttribute("src")).toBe(
      `data:image/png;base64,${IMAGE.data}`,
    );
    expect(node.textContent).toContain("res-image-text");
  });
});

describe("ToolUseBlock 折叠壳（task-9a 专项）", () => {
  it("默认折叠：输入与输出都不在 DOM，aria-expanded=false", async () => {
    const h = harness();
    await h.render(useEl(useResult()));

    const t = trigger(h.container);
    expect(t.getAttribute("aria-expanded")).toBe("false");
    expect(h.container.querySelector("pre")).toBeNull();
    expect(h.container.textContent).not.toContain("use-output-marker");
    expect(panel(h.container)).toBeNull();
  });

  it("点击标题行展开：aria-controls 与内容节点同一 id，收起后回到关闭态", async () => {
    const h = harness();
    await h.render(useEl(useResult()));

    const t = trigger(h.container);
    await activate(t);

    expect(t.getAttribute("aria-expanded")).toBe("true");
    const contentId = t.getAttribute("aria-controls");
    expect(contentId).toBeTruthy();
    const node = document.getElementById(contentId!);
    expect(node).not.toBeNull();
    expect(node!.id).toBe(contentId);
    expect(node).toBe(panel(h.container));
    expect(node!.dataset.state).toBe("open");
    // 输入段与输出段都还在同一块内容里
    expect(node!.textContent).toContain("Input");
    expect(node!.textContent).toContain("Output");
    expect(node!.textContent).toContain("use-output-marker");

    await activate(t);
    expect(t.getAttribute("aria-expanded")).toBe("false");
    expect(panel(h.container)).toBeNull();
    // 收起即卸载：不能留着 hidden 的空壳节点
    expect(document.getElementById(contentId!)).toBeNull();
  });

  it('触发条是原生 <button type="button">：可聚焦，激活切换且 aria-expanded 跟随', async () => {
    const h = harness();
    await h.render(useEl(useResult()));

    const t = trigger(h.container);
    expect(t.tagName).toBe("BUTTON");
    expect(t.getAttribute("type")).toBe("button");
    expect(t.hasAttribute("disabled")).toBe(false);
    expect(t.tabIndex).toBeGreaterThanOrEqual(0);
    t.focus();
    expect(document.activeElement).toBe(t);

    // 同文件头口径：走原生 button 与真实 Enter/Space 相同的激活路径。
    await activate(t);
    expect(t.getAttribute("aria-expanded")).toBe("true");
    await activate(t);
    expect(t.getAttribute("aria-expanded")).toBe("false");
    expect(panel(h.container)).toBeNull();
  });

  it("流式 partial 更新后仍展开且追加后的全文可见", async () => {
    const h = harness({
      activeTurn: TURN,
      partialToolResults: {
        [STREAM_USE.id]: { content: "use-stream-1", isError: false },
      },
    });
    await h.render(useEl());

    const first = await expand(h.container);
    expect(first.textContent).toContain("use-stream-1");

    await h.updateStore({
      activeTurn: TURN,
      partialToolResults: {
        [STREAM_USE.id]: {
          content: "use-stream-1\nuse-stream-2",
          isError: false,
        },
      },
    });

    expect(trigger(h.container).getAttribute("aria-expanded")).toBe("true");
    const node = panel(h.container)!;
    expect(node.dataset.state).toBe("open");
    expect(node.textContent).toContain("use-stream-1");
    expect(node.textContent).toContain("use-stream-2");
  });

  it("ask_user 专属卡片不经折叠壳：问题与选项无需点击即可见", async () => {
    const h = harness();
    await h.render(useEl(undefined, ASK_USE));

    // 专属卡片是早返回路径，不该被套进折叠壳
    expect(h.container.querySelector("[aria-expanded]")).toBeNull();
    expect(h.container.textContent).toContain("部署到生产环境吗？");
    expect(h.container.textContent).toContain("AskOptionRelease");
    expect(h.container.textContent).toContain("AskOptionHold");
  });

  it("展开内容仍渲染子代理步骤区、diff 行与附件图片", async () => {
    const agent = harness({
      subagentActivities: {
        [AGENT_USE.id]: {
          sessionId: SESSION,
          agentId: "agent-9a",
          parentToolCallId: AGENT_USE.id,
          status: "running",
          steps: [
            {
              id: "step-9a",
              toolName: "grep",
              args: { pattern: "needle" },
              done: true,
              durationMs: 12,
            },
          ],
          stats: { toolUses: 2, durationMs: 42 },
        },
      },
    });
    await agent.render(useEl(undefined, AGENT_USE));

    // 折叠时不渲染步骤区
    expect(agent.container.textContent).not.toContain("2 steps");
    const agentPanel = await expand(agent.container);
    expect(agentPanel.textContent).toContain("Steps");
    expect(agentPanel.textContent).toContain("2 steps");
    expect(agentPanel.textContent).toContain("42ms");

    const diff = harness();
    await diff.render(
      useEl(
        useResult({
          content: "",
          diff: "+diff-added-marker\n-diff-removed-marker",
          images: [IMAGE],
        }),
      ),
    );
    const diffPanel = await expand(diff.container);
    expect(diffPanel.querySelector(".diff-add")?.textContent).toBe(
      "+diff-added-marker",
    );
    expect(diffPanel.querySelector(".diff-del")?.textContent).toBe(
      "-diff-removed-marker",
    );
    const pre = diffPanel.querySelector("pre")!;
    expect(pre.className).toContain("overflow-y-auto");
    expect(pre.className).toContain("max-h-[300px]");
    expect(diffPanel.querySelectorAll("img")).toHaveLength(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 任务 9a：Bash / File 两个工具块的折叠原语接线守卫（本段为增量追加）
//
// 锁的是「手绘展开/折叠 → components/ui/collapsible（Radix）」这次迁移的对外契约：
// state 仍留在组件内、默认折叠语义不变、Trigger 就是原来那行标题（i18n 文案、图标、
// 语义 token、animate-fade-in 都在）且是真正可聚焦的原生 button、Content 与 Trigger
// 的 aria-controls 指向同一个原语下发的 id。
// ══════════════════════════════════════════════════════════════════════════

/** 本段专用剪贴板替身，不与上文共用。 */
const K9_CLIP = vi.fn<(text: string) => Promise<void>>(async () => {});

const K9_BASH = (content: string, isError = false): ToolResultContent => ({
  type: "tool_result",
  toolUseId: BASH_USE.id,
  content,
  isError,
});

const K9_FILE = (content: string, isError = false): ToolResultContent => ({
  type: "tool_result",
  toolUseId: FILE_USE.id,
  content,
  isError,
});

const k9BashEl = (result?: ToolResultContent) =>
  createElement(BashToolBlock, {
    block: BASH_USE,
    allBlocks: result ? [BASH_USE, result] : [BASH_USE],
    message: message(BASH_USE),
  });

const k9FileEl = (result: ToolResultContent) =>
  createElement(FileToolBlock, {
    block: FILE_USE,
    allBlocks: [FILE_USE, result],
    message: message(FILE_USE),
    action: "read" as const,
  });

/** 折叠容器根节点：原语把 data-state 挂在它上面。 */
function k9Root(container: HTMLElement): HTMLElement {
  const root = container.firstElementChild;
  expect(root, "组件必须渲染出一个根节点").not.toBeNull();
  return root as HTMLElement;
}

/** aria-controls 指向的节点：展开时它必须真实存在。 */
function k9Panel(container: HTMLElement): HTMLElement {
  const id = trigger(container).getAttribute("aria-controls");
  expect(id, "展开时触发器必须下发 aria-controls").toBeTruthy();
  const node = document.getElementById(id!);
  expect(node, `aria-controls=${id} 必须指向真实存在的节点`).not.toBeNull();
  return node!;
}

/**
 * 键盘激活：真实浏览器里 `<button>` 的 Enter/Space 走 HTML 的 activation behavior
 * 派发一次 click；jsdom 26 不实现这一步（实测：原生 button 上派发 Enter 后 click
 * 计数仍为 0）。这里显式走两步 —— 先派发真的 KeyboardEvent（bubbles + cancelable），
 * 再按规范补上**只对原生 `<button type=button>` 生效**的 click。
 * 触发器若退化成 div[role=button] + onKeyDown，第二步不会发生，用例在断言处失败，
 * harness 不替它兜底。
 */
async function k9PressKey(
  el: HTMLElement,
  key: "Enter" | " ",
): Promise<KeyboardEvent> {
  const down = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
  });
  await act(async () => {
    el.dispatchEvent(down);
  });
  const nativeButton =
    el.tagName === "BUTTON" && el.getAttribute("type") === "button";
  if (nativeButton && !down.defaultPrevented) {
    await act(async () => {
      el.click();
    });
  }
  return down;
}

describe("任务 9a · BashToolBlock 折叠原语契约", () => {
  it("默认折叠：正文与终端区都不在 DOM，根节点是原语下发的 closed", async () => {
    const h = harness();
    await h.render(k9BashEl(K9_BASH("k9-bash-body-marker")));

    const t = trigger(h.container);
    expect(t.getAttribute("aria-expanded")).toBe("false");
    expect(k9Root(h.container).dataset.state).toBe("closed");
    expect(h.container.textContent).not.toContain("k9-bash-body-marker");
    // 终端区（唯一带 --terminal-bg 的节点）属于展开体，折叠时不应存在
    expect(h.container.querySelector('[style*="--terminal-bg"]')).toBeNull();
    expect(t.getAttribute("aria-controls")).toBeNull();
  });

  it("点击标题行展开/收起：aria-expanded 跟随，正文出现又消失", async () => {
    const h = harness();
    await h.render(k9BashEl(K9_BASH("k9-bash-body-marker")));
    const t = trigger(h.container);

    await activate(t);
    expect(k9Root(h.container).dataset.state).toBe("open");
    expect(t.getAttribute("aria-expanded")).toBe("true");
    expect(k9Panel(h.container).textContent).toContain("k9-bash-body-marker");

    await activate(t);
    expect(t.getAttribute("aria-expanded")).toBe("false");
    expect(k9Root(h.container).dataset.state).toBe("closed");
    expect(h.container.textContent).not.toContain("k9-bash-body-marker");
  });

  it("Enter 与 Space 都能切换：一次按键只翻一次（原生 button 激活行为）", async () => {
    const h = harness();
    await h.render(k9BashEl(K9_BASH("k9-bash-body-marker")));
    const t = trigger(h.container);
    t.focus();
    expect(document.activeElement).toBe(t);
    expect(t.tagName).toBe("BUTTON");
    expect(t.getAttribute("type")).toBe("button");

    const down = await k9PressKey(t, "Enter");
    expect(down.defaultPrevented).toBe(false);
    expect(t.getAttribute("aria-expanded")).toBe("true");

    await k9PressKey(t, " ");
    expect(t.getAttribute("aria-expanded")).toBe("false");

    await k9PressKey(t, "Enter");
    await k9PressKey(t, " ");
    expect(t.getAttribute("aria-expanded")).toBe("false");
  });

  it("aria-controls 指向原语下发的唯一 id，且就是那个 open 展开体", async () => {
    const h = harness();
    await h.render(k9BashEl(K9_BASH("k9-bash-body-marker")));
    await activate(trigger(h.container));

    const id = trigger(h.container).getAttribute("aria-controls")!;
    expect(id).toBeTruthy();
    expect(document.querySelectorAll(`[id="${id}"]`)).toHaveLength(1);
    const node = k9Panel(h.container);
    expect(node.dataset.state).toBe("open");
    expect(node.hidden).toBe(false);
    expect(h.container.contains(node)).toBe(true);
    expect(node.textContent).toContain("k9-bash-body-marker");
    // 渐显类跟着展开体走，没有被迁移抹掉
    expect(node.querySelector(".animate-fade-in")).not.toBeNull();
  });

  it("流式 partial 追加后仍展开且全文更新；晚到结果不折叠", async () => {
    const h = harness({
      activeTurn: TURN,
      partialToolResults: {
        [BASH_USE.id]: { content: "k9-stream-1", isError: false },
      },
    });
    await h.render(k9BashEl());
    expect((await expand(h.container)).textContent).toContain("k9-stream-1");

    await h.updateStore({
      activeTurn: TURN,
      partialToolResults: {
        [BASH_USE.id]: {
          content: "k9-stream-1\nk9-stream-2",
          isError: false,
        },
      },
    });
    expect(trigger(h.container).getAttribute("aria-expanded")).toBe("true");
    const mid = k9Panel(h.container);
    expect(mid.textContent).toContain("k9-stream-1");
    expect(mid.textContent).toContain("k9-stream-2");

    await h.render(k9BashEl(K9_BASH("k9-final-1\nk9-final-2")));
    expect(trigger(h.container).getAttribute("aria-expanded")).toBe("true");
    const fin = k9Panel(h.container);
    expect(fin.textContent).toContain("k9-final-1");
    expect(fin.textContent).toContain("k9-final-2");
    expect(fin.textContent).not.toContain("k9-stream-1");
  });

  it("失败态、长输出滚动容器、ANSI 转义都还在；内容区点击不穿透折叠", async () => {
    const h = harness();
    await h.render(
      k9BashEl(K9_BASH("k9-error-marker\n<b>k9-raw-tag</b>", true)),
    );

    const node = await expand(h.container);
    expect(h.container.querySelector(".bg-destructive\\/5")).not.toBeNull();
    // 长输出：终端正文自己带 300px 上限与滚动条
    expect(node.innerHTML).toContain("max-h-[300px]");
    expect(node.innerHTML).toContain("overflow-y-auto");
    // 输出里的尖括号必须是被转义的文本，不能变成真元素
    expect(node.querySelector("b")).toBeNull();
    expect(node.textContent).toContain("<b>k9-raw-tag</b>");

    // 点展开体内部不能把折叠状态点掉
    const body = node.querySelector<HTMLElement>('[style*="--terminal-bg"]')!;
    await act(async () => {
      body.click();
    });
    expect(trigger(h.container).getAttribute("aria-expanded")).toBe("true");
  });
});

describe("任务 9a · FileToolBlock 折叠原语契约", () => {
  beforeEach(() => {
    K9_CLIP.mockClear();
    Object.defineProperty(window.navigator, "clipboard", {
      value: { writeText: K9_CLIP },
      configurable: true,
    });
  });

  it("默认折叠：文件正文与复制按钮都不在 DOM，根节点是 closed", async () => {
    const h = harness();
    await h.render(k9FileEl(K9_FILE("  1\tconst k9FileBody = 1\n")));

    const t = trigger(h.container);
    expect(t.getAttribute("aria-expanded")).toBe("false");
    expect(k9Root(h.container).dataset.state).toBe("closed");
    expect(h.container.textContent).not.toContain("k9FileBody");
    expect(h.container.querySelector("pre.code-block")).toBeNull();
    // 内容区里的复制按钮只有展开后才存在：容器里只剩触发器这一个 button
    expect(h.container.querySelectorAll("button")).toHaveLength(1);
    expect(t.getAttribute("aria-controls")).toBeNull();
  });

  it("点击标题行展开/收起：aria-expanded 跟随，正文出现又消失", async () => {
    const h = harness();
    await h.render(k9FileEl(K9_FILE("  1\tconst k9FileBody = 1\n")));
    const t = trigger(h.container);

    await activate(t);
    expect(k9Root(h.container).dataset.state).toBe("open");
    expect(t.getAttribute("aria-expanded")).toBe("true");
    expect(k9Panel(h.container).textContent).toContain("k9FileBody");

    await activate(t);
    expect(t.getAttribute("aria-expanded")).toBe("false");
    expect(h.container.textContent).not.toContain("k9FileBody");
    expect(panel(h.container)).toBeNull();
  });

  it("Enter 与 Space 都能切换：触发器可聚焦、原生 button、一次按键只翻一次", async () => {
    const h = harness();
    await h.render(k9FileEl(K9_FILE("  1\tconst k9FileBody = 1\n")));
    const t = trigger(h.container);
    t.focus();
    expect(document.activeElement).toBe(t);
    expect(t.tagName).toBe("BUTTON");
    expect(t.getAttribute("type")).toBe("button");

    const down = await k9PressKey(t, "Enter");
    expect(down.defaultPrevented).toBe(false);
    expect(t.getAttribute("aria-expanded")).toBe("true");

    await k9PressKey(t, " ");
    expect(t.getAttribute("aria-expanded")).toBe("false");
  });

  it("aria-controls 指向原语下发的唯一 id；失败态正文与滚动容器仍在展开体里", async () => {
    const h = harness();
    await h.render(k9FileEl(K9_FILE("k9-file-error-marker", true)));
    await activate(trigger(h.container));

    const id = trigger(h.container).getAttribute("aria-controls")!;
    expect(id).toBeTruthy();
    expect(document.querySelectorAll(`[id="${id}"]`)).toHaveLength(1);
    const node = k9Panel(h.container);
    expect(node.dataset.state).toBe("open");
    expect(node.hidden).toBe(false);
    expect(h.container.contains(node)).toBe(true);

    const pre = node.querySelector<HTMLElement>("pre.text-destructive")!;
    expect(pre.textContent).toContain("k9-file-error-marker");
    expect(pre.className).toContain("max-h-[300px]");
    expect(pre.className).toContain("overflow-y-auto");
    expect(node.querySelector(".animate-fade-in")).not.toBeNull();
  });

  it("展开状态下拿到新结果：仍展开且全文更新（行号前缀照旧剥掉）", async () => {
    const h = harness();
    await h.render(k9FileEl(K9_FILE("  1\tconst k9First = 1\n")));
    expect((await expand(h.container)).textContent).toContain("k9First");

    await h.render(
      k9FileEl(K9_FILE("  1\tconst k9First = 1\n  2\tconst k9Second = 2\n")),
    );

    expect(trigger(h.container).getAttribute("aria-expanded")).toBe("true");
    const node = k9Panel(h.container);
    expect(node.textContent).toContain("k9First");
    expect(node.textContent).toContain("k9Second");
    expect(node.textContent).not.toContain("1\tconst");
  });

  it("关闭重开：复制 handler 每轮各调一次原文，且点复制不折叠", async () => {
    const h = harness();
    await h.render(k9FileEl(K9_FILE("  1\tconst k9Copy = 1\n")));

    const first = await expand(h.container);
    await activate(first.querySelector<HTMLButtonElement>("button")!);
    expect(K9_CLIP).toHaveBeenCalledTimes(1);
    expect(K9_CLIP).toHaveBeenCalledWith("const k9Copy = 1\n");
    expect(trigger(h.container).getAttribute("aria-expanded")).toBe("true");

    await activate(trigger(h.container));
    expect(panel(h.container)).toBeNull();

    const second = await expand(h.container);
    await activate(second.querySelector<HTMLButtonElement>("button")!);
    expect(K9_CLIP).toHaveBeenCalledTimes(2);
    expect(K9_CLIP.mock.calls[1][0]).toBe("const k9Copy = 1\n");
  });
});

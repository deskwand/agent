// @vitest-environment jsdom
// Thinking/Todo 折叠迁到 Radix Collapsible 后的行为契约（Task 8）。
// 断言只描述观感与语义：折叠不挂载正文、Trigger 是原生按钮可键盘激活、
// 展开后 aria-controls 指向真实正文 id，以及既有预览截断/计数/摘要文案不变。
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "../../renderer/i18n/config";
import { ThinkingBlock } from "../../renderer/components/message/ThinkingBlock";
import { TodoWriteBlock } from "../../renderer/components/message/TodoWriteBlock";
import type { TodoItem } from "../../renderer/components/message/types";
import type { ToolUseContent } from "../../renderer/types";

const PREVIEW_CHARS = 600;
const THINKING_TAIL = "全文尾部-TAIL-标记";
const LONG_THINKING = "思".repeat(PREVIEW_CHARS) + THINKING_TAIL;

const TODOS: TodoItem[] = [
  { content: "写 spec", status: "completed" },
  { content: "写计划", status: "in_progress", activeForm: "正在写计划" },
  { content: "被取消的项", status: "cancelled" },
  { content: "待办项", status: "pending" },
];

function todoBlock(todos: TodoItem[]): ToolUseContent {
  return {
    type: "tool_use",
    id: "todo-1",
    name: "todo_write",
    input: { todos },
  };
}

describe("thinking / todo 折叠原语", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    await i18n.changeLanguage("zh");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function renderThinking(thinking: string) {
    await act(async () => {
      root.render(
        createElement(ThinkingBlock, { block: { type: "thinking", thinking } }),
      );
    });
  }

  async function renderTodo(todos: TodoItem[]) {
    const block = todoBlock(todos);
    await act(async () => {
      root.render(createElement(TodoWriteBlock, { block }));
    });
  }

  function trigger(): HTMLButtonElement | null {
    return container.querySelector<HTMLButtonElement>("button[aria-expanded]");
  }

  /** 展开态下由 aria-controls 解析出的真实正文节点。 */
  function contentFor(el: HTMLElement): HTMLElement | null {
    const id = el.getAttribute("aria-controls");
    return id ? document.getElementById(id) : null;
  }

  /**
   * jsdom 不实现原生 button 的「Enter/Space → click」激活行为（探针实测：只派发
   * keydown 不会产生 click）。这里按 HTML 规范补上激活那一步；但它只对原生
   * <button> 生效 —— 触发器若被写成 div/span，本助手不会 click，断言随即变红。
   */
  async function pressActivationKey(el: HTMLElement, key: "Enter" | " ") {
    el.focus();
    // click 触发的 React 状态更新要在 act 内 flush，否则断言读到的是上一帧 DOM。
    await act(async () => {
      const event = new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
      });
      el.dispatchEvent(event);
      if (
        el instanceof HTMLButtonElement &&
        !el.disabled &&
        !event.defaultPrevented
      ) {
        el.click();
      }
    });
  }

  it("thinking 空文本不渲染", async () => {
    await renderThinking("");
    expect(container.textContent).toBe("");
  });

  it("thinking 默认折叠：预览截断到 600 字，正文不挂载", async () => {
    await renderThinking(LONG_THINKING);
    const el = trigger()!;
    expect(el.tagName).toBe("BUTTON");
    expect(el.getAttribute("aria-expanded")).toBe("false");
    expect(el.getAttribute("data-state")).toBe("closed");
    const preview = el.querySelector("span.truncate")!;
    expect(preview.textContent).toBe("思".repeat(PREVIEW_CHARS));
    expect(container.textContent).not.toContain(THINKING_TAIL);
  });

  it("thinking 点击 Trigger 展开全文，aria-controls 指向真实正文", async () => {
    await renderThinking(LONG_THINKING);
    const el = trigger()!;
    expect(contentFor(el)).toBeNull();

    await act(async () => {
      el.click();
    });
    expect(el.getAttribute("aria-expanded")).toBe("true");
    expect(el.getAttribute("data-state")).toBe("open");
    // Radix 1.1.21 只在展开时输出 aria-controls（非展开态正文根本不挂载），
    // 所以这里断言展开后的 id 真实可解析，而不是折叠态存在一个悬空引用。
    const contentId = el.getAttribute("aria-controls");
    expect(contentId).toBeTruthy();
    const content = contentFor(el)!;
    expect(content).toBeTruthy();
    expect(content.textContent).toContain(THINKING_TAIL);
    expect(el.contains(content)).toBe(false);
    expect(el.querySelector("span.truncate")).toBeNull();

    await act(async () => {
      el.click();
    });
    expect(el.getAttribute("aria-expanded")).toBe("false");
    expect(el.getAttribute("data-state")).toBe("closed");
    // 迁移前正文是 `{expanded && …}`（折叠即卸载），迁移后保持同一契约：
    // 折叠态连 Content 外壳都不在 DOM 里 —— 绝不把「隐藏的重内容」继续挂着。
    expect(document.getElementById(contentId!)).toBeNull();
    expect(el.querySelector("span.truncate")).toBeTruthy();
  });

  it("thinking 键盘 Enter/Space 可切换", async () => {
    await renderThinking("键盘可切换");
    const el = trigger()!;
    expect(el instanceof HTMLButtonElement).toBe(true);
    el.focus();
    expect(document.activeElement).toBe(el);

    await pressActivationKey(el, "Enter");
    expect(el.getAttribute("aria-expanded")).toBe("true");
    await pressActivationKey(el, " ");
    expect(el.getAttribute("aria-expanded")).toBe("false");
  });

  it("thinking 重新渲染新文本不重置展开态", async () => {
    await renderThinking("第一轮思考");
    const el = trigger()!;
    await act(async () => {
      el.click();
    });
    expect(el.getAttribute("aria-expanded")).toBe("true");

    await renderThinking("第二轮思考 new-text");
    expect(trigger()!.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("第二轮思考 new-text");
  });

  it("todo 默认展开：摘要行 activeForm、计数与清单同时可见", async () => {
    await renderTodo(TODOS);
    const el = trigger()!;
    expect(el.getAttribute("aria-expanded")).toBe("true");
    expect(el.getAttribute("data-state")).toBe("open");
    expect(container.textContent).toContain(i18n.t("messageCard.taskProgress"));
    expect(container.textContent).toContain("正在写计划");
    // completed 计 1 项；cancelled 不进完成数但进总数。
    expect(container.textContent).toContain("1/4");

    const contentId = el.getAttribute("aria-controls");
    expect(contentId).toBeTruthy();
    const content = contentFor(el)!;
    expect(content).toBeTruthy();
    expect(content.textContent).toContain("写 spec");
    expect(content.textContent).toContain("待办项");
  });

  it("todo 折叠后清单不可见、摘要行仍在", async () => {
    await renderTodo(TODOS);
    const el = trigger()!;
    const contentId = el.getAttribute("aria-controls")!;

    await act(async () => {
      el.click();
    });
    expect(el.getAttribute("aria-expanded")).toBe("false");
    expect(el.getAttribute("data-state")).toBe("closed");
    // 同 thinking：折叠即卸载（`{expanded && …}` 的原有契约）。
    expect(document.getElementById(contentId)).toBeNull();
    expect(container.textContent).not.toContain("待办项");
    expect(container.textContent).toContain("1/4");
    expect(container.textContent).toContain("正在写计划");
  });

  it("todo 键盘 Enter/Space 可切换", async () => {
    await renderTodo(TODOS);
    const el = trigger()!;
    expect(el instanceof HTMLButtonElement).toBe(true);
    el.focus();
    expect(document.activeElement).toBe(el);

    await pressActivationKey(el, "Enter");
    expect(el.getAttribute("aria-expanded")).toBe("false");
    await pressActivationKey(el, " ");
    expect(el.getAttribute("aria-expanded")).toBe("true");
  });

  it("todo 展开中追加条目保持展开且新条目可见", async () => {
    await renderTodo([{ content: "第一步", status: "in_progress" }]);
    expect(trigger()!.getAttribute("aria-expanded")).toBe("true");

    await renderTodo([
      { content: "第一步", status: "completed" },
      { content: "新追加的第二步", status: "in_progress" },
    ]);
    expect(trigger()!.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("新追加的第二步");
    expect(container.textContent).toContain("1/2");
  });

  it("todo 被拒绝时空态如实显示，不渲染清单与触发器", async () => {
    await renderTodo([
      { content: "先做 A", status: "in_progress" },
      { content: "先做 B", status: "in_progress" },
    ]);
    expect(container.textContent).toContain("任务清单未生效");
    expect(trigger()).toBeNull();
    expect(container.textContent).not.toContain("先做 A");
  });
});

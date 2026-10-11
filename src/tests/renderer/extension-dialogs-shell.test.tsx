// @vitest-environment jsdom
//
// Task 4：扩展交互弹窗外壳迁移（自建 `fixed inset-0` 遮罩 → Occluding* 原语）。
//
// 迁移前 ExtensionDialogs 是一整块自建遮罩：每个请求手画 `fixed inset-0 bg-black/50`、
// 没有 role、没有 occlusion（浏览器面板打开时会被原生视图盖住）、select 的选项是
// `<li onClick>`（键盘不可达）、没有回焦。本文件锁「外壳换了，响应协议与业务一条没丢」：
//   - 四类请求 role 正确（confirm → alertdialog；input/editor/select → dialog）+ 标题
//   - 信任提示 role=alertdialog + 标题/路径，两按钮分别回 trusted / untrusted
//   - 关闭矩阵（constraints.md 任务 4 行）：遮罩/Escape 禁止（preventDefault，不是只禁按钮），
//     输入草稿原样保留；只允许「取消 / 确认」两个入口，且不新增 Escape→cancel 路径
//   - 回值精确：取消一定是 undefined；input/editor 是原输入值；select 是原 option 字符串
//   - **既有异常（本轮只锁定、不修）**：confirm 的确认走的是 `respond(inputValue)`，
//     初始化后是空字符串而不是 boolean true（见下面 confirm 用例的注释）
//   - 队列语义不变：`queue[0]` 控制当前项，取消第一个只出队第一个且 respond 恰一次，
//     不能因为 Radix 的 onOpenChange 在队列推进后又把下一项取消掉
//   - editor prefill 随队列推进重置；空选项列表仍可取消
//   - 信任提示与普通请求重叠时，关一个另一个仍在且仍占用 occlusion
//   - 回焦：取消后回到 opener；opener 已被移除时走 onRestoreFocus fallback；
//     队列推进不回背景（下一个 Content 继续 autofocus）
//
// 有意不覆盖：
//   - 不引入 RadioGroup / 二次提交语义：select 的选项是立即回值的真实按钮，不是单选控件
//   - 不 mock Dialog/AlertDialog 原语 —— 本文件要验的正是原语本身的行为；
//     事件用组件真实的 `window.electronAPI.on` 订阅（收集 listener 后投递 ServerEvent），
//     只把 `piUi.respond` / `piExtensions.respondTrust` 换成 spy
//   - 重叠弹窗之间的焦点交接交给 Radix FocusScope 栈，本文件只锁 occlusion 与在场性
//
// 查询作用域是 `document.body`：Radix 的 Content 经 Portal 挂到 body，查 container 会假绿。
import "../../renderer/i18n/config";
import i18n from "../../renderer/i18n/config";
import type { ReactNode } from "react";
import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../renderer/store";
import { ExtensionDialogs } from "../../renderer/components/ExtensionDialogs";
import type { PiUiRequest } from "../../shared/ipc-types";
import type { ServerEvent } from "../../renderer/types";

let container: HTMLDivElement;
let root: Root;
let respond: ReturnType<typeof vi.fn>;
let respondTrust: ReturnType<typeof vi.fn>;
/** 组件用 `window.electronAPI.on` 订阅主进程事件；把 handler 存下来精确投递。 */
let emit!: (event: ServerEvent) => void;

async function render(node: ReactNode): Promise<void> {
  await act(async () => {
    root.render(node);
  });
}

/** Radix 的 Presence / FocusScope 在 setTimeout(…, 0) 里挂载与回焦，断言前推一个宏任务。 */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function emitEvent(event: ServerEvent): Promise<void> {
  await act(async () => {
    emit(event);
  });
  await flush();
}

function uiRequest(payload: PiUiRequest): ServerEvent {
  return { type: "pi.ui-request", payload };
}

function confirmRequest(
  id: string,
  title: string,
  message?: string,
): ServerEvent {
  return uiRequest({
    type: "extension_ui_request",
    id,
    method: "confirm",
    title,
    message,
  });
}

function inputRequest(
  id: string,
  title: string,
  placeholder?: string,
): ServerEvent {
  return uiRequest({
    type: "extension_ui_request",
    id,
    method: "input",
    title,
    placeholder,
  });
}

function editorRequest(
  id: string,
  title: string,
  prefill?: string,
): ServerEvent {
  return uiRequest({
    type: "extension_ui_request",
    id,
    method: "editor",
    title,
    prefill,
  });
}

function selectRequest(
  id: string,
  title: string,
  options?: string[],
): ServerEvent {
  return uiRequest({
    type: "extension_ui_request",
    id,
    method: "select",
    title,
    options,
  });
}

function trustPrompt(cwd: string): ServerEvent {
  return { type: "pi.trust-prompt", payload: { cwd } };
}

function occlusionCount(): number {
  return useAppStore.getState().browserOcclusionIds.size;
}

function queryAlertDialog(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('[role="alertdialog"]');
}

function queryDialog(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('[role="dialog"]');
}

function buttonByText(
  scope: ParentNode | null,
  text: string,
): HTMLButtonElement | null {
  if (!scope) return null;
  return (
    [...scope.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === text,
    ) ?? null
  );
}

function textareaEl(): HTMLTextAreaElement | null {
  return document.body.querySelector<HTMLTextAreaElement>("textarea");
}

/** React 受控输入：用原生 setter 写值再派发 input，jsdom 的 click 不会带上值。 */
async function typeInto(
  textarea: HTMLTextAreaElement,
  value: string,
): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setter?.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(el: Element | null): Promise<void> {
  expect(el, "要点击的元素必须存在").not.toBeNull();
  await act(async () => {
    el?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });
}

async function pressEscape(): Promise<void> {
  await act(async () => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        // 不声明 cancelable 的话 Radix 的 preventDefault 是空操作
        cancelable: true,
      }),
    );
  });
}

/** 遮罩/外部点击：Radix 的 DismissableLayer 监听 document 的 pointerdown。 */
async function pointerDownOutside(): Promise<void> {
  await act(async () => {
    document.body.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
    );
    document.body.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
  });
}

/** 取消键：普通请求与 confirm/信任提示各取自己的容器。 */
function cancelButton(scope: HTMLElement | null): HTMLButtonElement | null {
  return buttonByText(scope, i18n.t("common.cancel"));
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useAppStore.setState({ browserOcclusionIds: new Set<string>() });
  respond = vi.fn().mockResolvedValue(undefined);
  respondTrust = vi.fn().mockResolvedValue(undefined);
  window.electronAPI = {
    on: (handler: (event: ServerEvent) => void) => {
      emit = handler;
      return () => {};
    },
    piUi: { respond },
    piExtensions: { respondTrust },
  } as never;
  // jsdom 的 navigator.language 是 en-US；强制中文，断言才对得上 locale。
  await i18n.changeLanguage("zh");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  // Portal 挂在 document.body 上，不随 container 移除
  document.body
    .querySelectorAll('[role="dialog"], [role="alertdialog"]')
    .forEach((el) => el.remove());
  useAppStore.setState({ browserOcclusionIds: new Set<string>() });
  delete (window as { electronAPI?: unknown }).electronAPI;
  vi.unstubAllGlobals();
});

describe("四类请求的外壳与 role", () => {
  it("confirm 渲染进 alertdialog，标题与消息可见", async () => {
    await render(<ExtensionDialogs />);
    await emitEvent(confirmRequest("request-1", "Sure?", "Go?"));

    const el = queryAlertDialog();
    expect(el).not.toBeNull();
    expect(el?.textContent).toContain("Sure?");
    expect(el?.textContent).toContain("Go?");
    // confirm 不允许出现普通 dialog 外壳（role 决定键盘/读屏语义）
    expect(queryDialog()).toBeNull();
    expect(occlusionCount()).toBe(1);
  });

  it("input 渲染进 dialog，标题与 placeholder 可见", async () => {
    await render(<ExtensionDialogs />);
    await emitEvent(inputRequest("request-1", "Type something", "hint"));

    const el = queryDialog();
    expect(el).not.toBeNull();
    expect(el?.textContent).toContain("Type something");
    expect(textareaEl()?.getAttribute("placeholder")).toBe("hint");
    expect(queryAlertDialog()).toBeNull();
    expect(occlusionCount()).toBe(1);
  });

  it("editor 渲染进 dialog，prefill 预填进输入框", async () => {
    await render(<ExtensionDialogs />);
    await emitEvent(editorRequest("request-1", "Edit this", "line one"));

    expect(queryDialog()?.textContent).toContain("Edit this");
    expect(textareaEl()?.value).toBe("line one");
    expect(queryAlertDialog()).toBeNull();
  });

  it("select 渲染进 dialog，选项是可聚焦的真实按钮", async () => {
    await render(<ExtensionDialogs />);
    await emitEvent(selectRequest("request-1", "Pick one", ["Alpha", "Beta"]));

    const el = queryDialog();
    expect(el?.textContent).toContain("Pick one");
    const options = [...(el?.querySelectorAll("li button") ?? [])];
    expect(options).toHaveLength(2);
    for (const option of options) {
      expect(option).toBeInstanceOf(HTMLButtonElement);
      expect(option.getAttribute("type")).toBe("button");
    }
    // 键盘可达：不是只能点、不能聚焦的 li
    expect(el?.querySelector("li[onclick]")).toBeNull();
  });

  it("信任提示渲染进 alertdialog，标题与 cwd 可见", async () => {
    await render(<ExtensionDialogs />);
    await emitEvent(trustPrompt("/tmp/project"));

    const el = queryAlertDialog();
    expect(el).not.toBeNull();
    expect(el?.textContent).toContain(i18n.t("piExtensions.trustTitle"));
    expect(el?.textContent).toContain("/tmp/project");
    expect(queryDialog()).toBeNull();
    expect(occlusionCount()).toBe(1);
  });
});

describe("关闭矩阵：遮罩 / Escape 都禁止，草稿保留", () => {
  it("input：Escape 与外部点击都不关闭，输入值原样保留", async () => {
    await render(<ExtensionDialogs />);
    await emitEvent(inputRequest("request-1", "Type something"));
    await typeInto(textareaEl() as HTMLTextAreaElement, "keep me");

    await pressEscape();
    await pointerDownOutside();
    await flush();

    expect(respond).not.toHaveBeenCalled();
    expect(queryDialog()).not.toBeNull();
    expect(textareaEl()?.value).toBe("keep me");
  });

  it("editor：Escape 与外部点击都不关闭，编辑内容原样保留", async () => {
    await render(<ExtensionDialogs />);
    await emitEvent(editorRequest("request-1", "Edit this", "prefill"));
    await typeInto(textareaEl() as HTMLTextAreaElement, "edited");

    await pressEscape();
    await pointerDownOutside();
    await flush();

    expect(respond).not.toHaveBeenCalled();
    expect(textareaEl()?.value).toBe("edited");
  });

  it("confirm：Escape 与外部点击都不关闭，也不产生 cancel 响应", async () => {
    await render(<ExtensionDialogs />);
    await emitEvent(confirmRequest("request-1", "Sure?"));

    await pressEscape();
    await pointerDownOutside();
    await flush();

    expect(respond).not.toHaveBeenCalled();
    expect(queryAlertDialog()).not.toBeNull();
  });

  it("信任提示：Escape 与外部点击都不关闭，也不产生任何响应", async () => {
    await render(<ExtensionDialogs />);
    await emitEvent(trustPrompt("/tmp/project"));

    await pressEscape();
    await pointerDownOutside();
    await flush();

    expect(respondTrust).not.toHaveBeenCalled();
    expect(queryAlertDialog()).not.toBeNull();
  });
});

describe("响应协议值（迁移不得改变）", () => {
  it("confirm：取消回复 undefined；确认回复既有实际值（空字符串，不是 true）", async () => {
    await render(<ExtensionDialogs />);

    // 既有异常（本轮只锁定，不修）：非 select 的确认都调用 respond(inputValue)，
    // confirm 初始化后 inputValue 是空字符串。要改成 boolean true 是另一个 bug + 协议变更，
    // 需要单独授权，不能混进这次外壳迁移。
    await emitEvent(confirmRequest("request-1", "Sure?"));
    await click(buttonByText(queryAlertDialog(), i18n.t("common.confirm")));
    await flush();
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith("request-1", "");
    expect(respond.mock.calls[0]?.[1]).not.toBe(true);
    expect(queryAlertDialog()).toBeNull();

    await emitEvent(confirmRequest("request-2", "Sure again?"));
    await click(buttonByText(queryAlertDialog(), i18n.t("common.cancel")));
    await flush();
    expect(respond).toHaveBeenCalledTimes(2);
    expect(respond).toHaveBeenLastCalledWith("request-2", undefined);
  });

  it("input：确认回复原输入值", async () => {
    await render(<ExtensionDialogs />);
    await emitEvent(inputRequest("request-1", "Type something"));
    await typeInto(textareaEl() as HTMLTextAreaElement, "hello world");

    await click(buttonByText(queryDialog(), i18n.t("common.confirm")));
    await flush();

    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith("request-1", "hello world");
    expect(queryDialog()).toBeNull();
  });

  it("editor：确认回复编辑后的文本", async () => {
    await render(<ExtensionDialogs />);
    await emitEvent(editorRequest("request-1", "Edit this", "prefill"));
    await typeInto(textareaEl() as HTMLTextAreaElement, "edited text");

    await click(buttonByText(queryDialog(), i18n.t("common.confirm")));
    await flush();

    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith("request-1", "edited text");
  });

  it("select：点击选项立即回复原 option 字符串", async () => {
    await render(<ExtensionDialogs />);
    await emitEvent(selectRequest("request-1", "Pick one", ["Alpha", "Beta"]));

    const options = [...(queryDialog()?.querySelectorAll("li button") ?? [])];
    await click(options[1] ?? null);
    await flush();

    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith("request-1", "Beta");
    expect(queryDialog()).toBeNull();
  });

  it("select：空选项列表仍可取消并回复 undefined", async () => {
    await render(<ExtensionDialogs />);
    await emitEvent(selectRequest("request-1", "Nothing to pick", []));

    expect(queryDialog()?.querySelectorAll("li button")).toHaveLength(0);
    await click(cancelButton(queryDialog()));
    await flush();

    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith("request-1", undefined);
    expect(queryDialog()).toBeNull();
  });

  it("信任提示：允许/拒绝分别回复 trusted / untrusted，不自动产生 cancel", async () => {
    await render(<ExtensionDialogs />);

    await emitEvent(trustPrompt("/tmp/project"));
    await click(
      buttonByText(queryAlertDialog(), i18n.t("piExtensions.trustAllow")),
    );
    await flush();
    expect(respondTrust).toHaveBeenCalledTimes(1);
    expect(respondTrust).toHaveBeenCalledWith("/tmp/project", "trusted");
    expect(queryAlertDialog()).toBeNull();
    expect(occlusionCount()).toBe(0);

    await emitEvent(trustPrompt("/tmp/other"));
    await click(
      buttonByText(queryAlertDialog(), i18n.t("piExtensions.trustDeny")),
    );
    await flush();
    expect(respondTrust).toHaveBeenCalledTimes(2);
    expect(respondTrust).toHaveBeenLastCalledWith("/tmp/other", "untrusted");
  });
});

describe("队列语义（queue[0] 不变）", () => {
  it("连续两个请求：取消第一个只出队第一个，respond 恰一次，第二个文案出现", async () => {
    await render(<ExtensionDialogs />);
    await emitEvent(confirmRequest("request-1", "First request"));
    await emitEvent(inputRequest("request-2", "Second request"));

    expect(document.body.textContent).toContain("First request");
    expect(document.body.textContent).not.toContain("Second request");

    await click(cancelButton(queryAlertDialog()));
    // 两个宏任务：Radix 的 close autofocus 在 setTimeout(0) 里，若它误触发第二次出队会在这里显形
    await flush();
    await flush();

    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith("request-1", undefined);
    expect(document.body.textContent).toContain("Second request");
    expect(document.body.textContent).not.toContain("First request");
    expect(queryDialog()).not.toBeNull();

    // 第二个请求仍然完整可用
    await click(cancelButton(queryDialog()));
    await flush();
    await flush();
    expect(respond).toHaveBeenCalledTimes(2);
    expect(respond).toHaveBeenLastCalledWith("request-2", undefined);
    expect(document.body.textContent).not.toContain("Second request");
  });

  it("队列推进把 editor 的 prefill 重置为下一请求的值", async () => {
    await render(<ExtensionDialogs />);
    await emitEvent(
      editorRequest("request-1", "First editor", "first-prefill"),
    );
    await emitEvent(
      editorRequest("request-2", "Second editor", "second-prefill"),
    );
    expect(textareaEl()?.value).toBe("first-prefill");

    await typeInto(textareaEl() as HTMLTextAreaElement, "typed by me");
    await click(cancelButton(queryDialog()));
    await flush();

    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith("request-1", undefined);
    expect(textareaEl()?.value).toBe("second-prefill");
    expect(document.body.textContent).toContain("Second editor");
  });
});

describe("信任提示与普通请求重叠", () => {
  it("关掉普通请求后信任提示仍在，并且仍然遮挡浏览器", async () => {
    await render(<ExtensionDialogs />);
    await emitEvent(inputRequest("request-1", "Type something"));
    expect(occlusionCount()).toBe(1);

    await emitEvent(trustPrompt("/tmp/project"));
    expect(occlusionCount()).toBe(2);
    expect(queryDialog()).not.toBeNull();
    expect(queryAlertDialog()).not.toBeNull();

    await click(cancelButton(queryDialog()));
    await flush();

    expect(respond).toHaveBeenCalledWith("request-1", undefined);
    expect(respondTrust).not.toHaveBeenCalled();
    expect(queryDialog()).toBeNull();
    expect(queryAlertDialog()).not.toBeNull();
    // 关掉一层，另一层仍占着 occlusion —— 浏览器面板不能提前露出来
    expect(occlusionCount()).toBe(1);

    await click(
      buttonByText(queryAlertDialog(), i18n.t("piExtensions.trustDeny")),
    );
    await flush();

    expect(respondTrust).toHaveBeenCalledWith("/tmp/project", "untrusted");
    expect(occlusionCount()).toBe(0);
    expect(document.body.textContent).not.toContain(
      i18n.t("piExtensions.trustTitle"),
    );
  });

  it("关掉信任提示后普通请求仍在，并且仍然遮挡浏览器", async () => {
    await render(<ExtensionDialogs />);
    await emitEvent(inputRequest("request-1", "Type something"));
    await emitEvent(trustPrompt("/tmp/project"));
    expect(occlusionCount()).toBe(2);

    await click(
      buttonByText(queryAlertDialog(), i18n.t("piExtensions.trustAllow")),
    );
    await flush();

    expect(respondTrust).toHaveBeenCalledWith("/tmp/project", "trusted");
    expect(respond).not.toHaveBeenCalled();
    expect(queryAlertDialog()).toBeNull();
    expect(queryDialog()).not.toBeNull();
    expect(occlusionCount()).toBe(1);
  });
});

describe("回焦", () => {
  /** 真实 opener（在 React 树里）+ 真实可聚焦 fallback（父级根容器的忠实替身）。 */
  function FocusHarness({
    onRestoreFocus,
  }: {
    onRestoreFocus?: () => void;
  }): JSX.Element {
    const fallbackRef = useRef<HTMLDivElement>(null);
    return (
      <>
        <button type="button" data-testid="opener">
          opener
        </button>
        <div ref={fallbackRef} data-testid="fallback" tabIndex={-1} />
        <ExtensionDialogs
          onRestoreFocus={() => {
            onRestoreFocus?.();
            fallbackRef.current?.focus({ preventScroll: true });
          }}
        />
      </>
    );
  }

  it("取消后焦点回到 opener", async () => {
    await render(<FocusHarness />);
    const opener = container.querySelector<HTMLButtonElement>(
      '[data-testid="opener"]',
    ) as HTMLButtonElement;
    opener.focus();
    expect(document.activeElement).toBe(opener);

    await emitEvent(inputRequest("request-1", "Type something"));
    // 弹窗打开时焦点在弹窗内（Radix 自动聚焦），不再留在背景
    expect(queryDialog()?.contains(document.activeElement)).toBe(true);

    await click(cancelButton(queryDialog()));
    await flush();

    expect(document.activeElement).toBe(opener);
  });

  /**
   * opener 会在弹窗打开期间被卸载的 harness。
   * 不能直接 `opener.remove()`：它在 React 树里，外部删节点会让 React 下一次提交抛
   * NotFoundError —— 入口只能由 React 自己卸载，这才是「入口被移除」的真实形态。
   */
  function RemovableOpenerHarness({
    onRestoreFocus,
  }: {
    onRestoreFocus?: () => void;
  }): JSX.Element {
    const [openerMounted, setOpenerMounted] = useState(true);
    const fallbackRef = useRef<HTMLDivElement>(null);
    return (
      <>
        {openerMounted && (
          <button type="button" data-testid="opener">
            opener
          </button>
        )}
        <div ref={fallbackRef} data-testid="fallback" tabIndex={-1} />
        <button
          type="button"
          data-testid="remove-opener"
          onClick={() => setOpenerMounted(false)}
        >
          remove opener
        </button>
        <ExtensionDialogs
          onRestoreFocus={() => {
            onRestoreFocus?.();
            fallbackRef.current?.focus({ preventScroll: true });
          }}
        />
      </>
    );
  }

  it("opener 已被移除时走 onRestoreFocus fallback", async () => {
    const onRestoreFocus = vi.fn();
    await render(<RemovableOpenerHarness onRestoreFocus={onRestoreFocus} />);

    const opener = container.querySelector<HTMLButtonElement>(
      '[data-testid="opener"]',
    ) as HTMLButtonElement;
    opener.focus();
    await emitEvent(inputRequest("request-1", "Type something"));

    // 入口在弹窗打开期间被卸载：记下的返回目标已断开
    await click(container.querySelector('[data-testid="remove-opener"]'));
    expect(opener.isConnected).toBe(false);

    await click(cancelButton(queryDialog()));
    await flush();

    expect(onRestoreFocus).toHaveBeenCalled();
    expect(document.activeElement).toBe(
      container.querySelector('[data-testid="fallback"]'),
    );
  });

  it("队列推进不回背景：焦点留在下一个 Content 里", async () => {
    await render(<FocusHarness />);
    const opener = container.querySelector<HTMLButtonElement>(
      '[data-testid="opener"]',
    ) as HTMLButtonElement;
    opener.focus();

    await emitEvent(confirmRequest("request-1", "First request"));
    await emitEvent(inputRequest("request-2", "Second request"));

    await click(cancelButton(queryAlertDialog()));
    await flush();
    await flush();

    expect(respond).toHaveBeenCalledTimes(1);
    expect(document.activeElement).not.toBe(opener);
    expect(queryDialog()?.contains(document.activeElement)).toBe(true);
  });
});

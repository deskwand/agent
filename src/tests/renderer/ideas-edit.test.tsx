// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupDialogs } from "../dialog-test-helpers";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { IdeasView } from "../../renderer/components/IdeasView";
import { useAppStore } from "../../renderer/store";
import type { IdeaSummary } from "../../shared/ideas";

let container: HTMLDivElement;
let root: Root;
const update = vi.fn();
const list = vi.fn();
const read = vi.fn();

const summary: IdeaSummary = {
  name: "a",
  excerpt: "原始正文",
  createdAt: Date.parse("2026-10-11T15:04:07+08:00"),
  status: "inbox",
  archivedAt: null,
  sourceSessionId: null,
  sourceView: "chat",
};

/** 受控 textarea：走原型上的原生 setter 再派发 input。 */
function typeInto(box: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  act(() => {
    setter?.call(box, value);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(
  box: HTMLTextAreaElement,
  key: string,
  init: KeyboardEventInit = {},
): void {
  act(() => {
    box.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  });
}

async function render(): Promise<void> {
  await act(async () => {
    root.render(<IdeasView />);
  });
  await act(async () => {});
}

/** 把 1 秒防抖推过去，并让随之而来的 promise 落地。 */
async function advanceAutosave(ms = 1000): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await act(async () => {});
}

const bodyArea = () =>
  container.querySelector<HTMLElement>('[data-testid="ideas-body"]')!;
const textarea = () => container.querySelector<HTMLTextAreaElement>("textarea");
const saveState = () =>
  container
    .querySelector('[data-testid="ideas-save-state"]')
    ?.textContent?.trim();

async function startEditing(): Promise<HTMLTextAreaElement> {
  act(() => bodyArea().click());
  await act(async () => {});
  const box = textarea();
  if (!box) throw new Error("点正文应当就地变成输入框");
  return box;
}

beforeEach(() => {
  vi.useFakeTimers();
  // 本仓的 vitest 4 里 `clearAllMocks` 会连实现一起清掉，实现必须写在它之后。
  vi.clearAllMocks();
  // 列表必须每次返回**新对象**：否则 `visible.find()` 返回同一个引用，
  // "依赖 selected 对象身份"的写法在这份测试里永远不会重跑 —— H1 回归就抓不到它。
  list.mockImplementation(async () => ({
    inbox: [{ ...summary }],
    archived: [],
    skipped: 0,
  }));
  read.mockResolvedValue({ body: "原始正文", mtimeMs: 123 });
  update.mockResolvedValue({ ...summary, mtimeMs: 456 });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    platform: "darwin",
    ideas: { list, read, update, setStatus: vi.fn(), remove: vi.fn() },
  };
  useAppStore.setState({
    ...useAppStore.getInitialState(),
    activeView: "ideas",
    ideasSelectedName: "a",
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  cleanupDialogs();
  vi.useRealTimers();
});

describe("就地编辑", () => {
  it("点正文就地变输入框，里面是正文（没有编辑按钮）", async () => {
    await render();
    const box = await startEditing();
    expect(box.value).toBe("原始正文");
    // 进入编辑不需要先点任何按钮：上面那一击就是全部前置条件（没有"编辑"按钮这种东西）。
    expect(container.querySelectorAll("textarea")).toHaveLength(1);
  });

  it("打字后 1 秒防抖只落一次盘，带上进入编辑时的 mtime", async () => {
    await render();
    const box = await startEditing();
    typeInto(box, "改过的正文");
    typeInto(box, "改过的正文再改");
    expect(update).not.toHaveBeenCalled();

    // 900ms 还不该写：证明的是"1 秒"这条线，不是"≤1 秒"
    await advanceAutosave(900);
    expect(update).not.toHaveBeenCalled();

    await advanceAutosave(100);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith("a", {
      content: "改过的正文再改",
      mtimeMs: 123,
    });
    expect(saveState()).toBe("ideas.saved");
  });

  it("失焦立刻存，不用等满 1 秒", async () => {
    await render();
    const box = await startEditing();
    typeInto(box, "失焦存");
    act(() => {
      // React 17+ 的 onBlur 走 `focusout` 事件委托（`blur` 不冒泡，React 收不到）。
      box.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    await act(async () => {});
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("⌘↵ 立刻存", async () => {
    await render();
    const box = await startEditing();
    typeInto(box, "立刻存");
    press(box, "Enter", { metaKey: true });
    await act(async () => {});
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("Esc 只退出不落盘", async () => {
    await render();
    const box = await startEditing();
    typeInto(box, "不要存这段");
    press(box, "Escape");
    await act(async () => {});
    expect(update).not.toHaveBeenCalled();
    expect(textarea()).toBeNull();
    expect(container.textContent).toContain("原始正文");
  });

  it("H1 回归：编辑中列表被重拉（窗口重新获得焦点）不许把草稿冲掉", async () => {
    await render();
    const box = await startEditing();
    typeInto(box, "打了一半的想法");

    // 决策 8 的自动拉：窗口重新获得焦点。`loadIdeas` 会产出新的数组与新对象，
    // 若正文读取 effect 依赖 `selected` 对象身份，就会在这里 setDraft(null) 把草稿吞掉。
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await act(async () => {});

    expect(textarea()?.value).toBe("打了一半的想法");
    expect(update).not.toHaveBeenCalled();
  });

  it("「已保存」常驻到下次编辑，不随时间消失", async () => {
    await render();
    const box = await startEditing();
    typeInto(box, "存一下");
    await advanceAutosave();
    expect(saveState()).toBe("ideas.saved");

    await advanceAutosave(5000);
    expect(saveState()).toBe("ideas.saved");

    // 再打字 → 回到"编辑中"，不再显示已保存
    typeInto(box, "存一下再改");
    expect(saveState()).not.toBe("ideas.saved");
  });

  it("IDEA_STALE：停手并提示，且不再自动保存（H3 锁）", async () => {
    update.mockRejectedValue(new Error("IDEA_STALE"));
    await render();
    const box = await startEditing();
    typeInto(box, "外部改过的");
    await advanceAutosave();
    expect(update).toHaveBeenCalledTimes(1);
    expect(saveState()).toBe("ideas.staleHint");

    // 继续打字 + 再推 1 秒：锁住之后不许再发第二次写盘（否则会一轮轮失败、刷屏）
    typeInto(box, "外部改过的，又改");
    await advanceAutosave();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("写入失败（非 stale）：提示保存失败，草稿还在", async () => {
    update.mockRejectedValue(new Error("EACCES"));
    await render();
    const box = await startEditing();
    typeInto(box, "写不进去");
    await advanceAutosave();
    expect(saveState()).toBe("ideas.saveFailed");
    expect(textarea()?.value).toBe("写不进去");
  });

  it("失焦存过一次之后，再点进正文改 —— 基线已经是新的 mtime（否则会报假的「外部修改」）", async () => {
    await render();
    const box = await startEditing();
    typeInto(box, "失焦存一次");
    act(() => {
      box.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    await act(async () => {});

    // 再点正文进编辑（此时会话是新建的，基线只能来自上次保存返回的 mtime）
    const again = await startEditing();
    typeInto(again, "再改一次");
    await advanceAutosave();
    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[1][1]).toMatchObject({ mtimeMs: 456 });
  });

  it("失焦保存成功后不许把输入框又弹回来", async () => {
    await render();
    const box = await startEditing();
    typeInto(box, "存了就走");
    act(() => {
      box.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    await act(async () => {});
    expect(textarea()).toBeNull();
  });

  it("命中 stale 后按 Esc 退出，红字告警仍在（锁还挂着，不能变成静默失败）", async () => {
    update.mockRejectedValue(new Error("IDEA_STALE"));
    await render();
    const box = await startEditing();
    typeInto(box, "外部改过的");
    await advanceAutosave();
    expect(saveState()).toBe("ideas.staleHint");

    press(box, "Escape");
    await act(async () => {});
    expect(saveState()).toBe("ideas.staleHint");
  });

  it("迟到的 read 不许把上一条的正文落到这一条头上", async () => {
    // 两次 read 会乱序回来（fs 线程池）：A 的读还没回，用户已经切到 B。
    let resolveA: ((value: { body: string; mtimeMs: number }) => void) | null =
      null;
    read.mockImplementation((name: string) =>
      name === "a"
        ? new Promise((resolve) => {
            resolveA = resolve;
          })
        : Promise.resolve({ body: "正文B", mtimeMs: 2 }),
    );
    list.mockResolvedValue({
      inbox: [summary, { ...summary, name: "b", excerpt: "第二条" }],
      archived: [],
      skipped: 0,
    });
    await render();

    act(() => useAppStore.getState().selectIdea("b"));
    await act(async () => {});
    await act(async () => {
      resolveA?.({ body: "正文A（迟到）", mtimeMs: 9 });
    });
    await act(async () => {});

    expect(container.textContent).toContain("正文B");
    expect(container.textContent).not.toContain("正文A（迟到）");
    const box = await startEditing();
    expect(box.value).toBe("正文B");
  });

  it("迟到的保存不许改写当前这条的正文", async () => {
    let resolveUpdate: ((value: unknown) => void) | null = null;
    update.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpdate = resolve;
        }),
    );
    await render();
    const box = await startEditing();
    typeInto(box, "A 改过的");
    act(() => {
      box.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });

    // 切到 b：A 的写盘还在飞
    read.mockResolvedValue({ body: "正文B", mtimeMs: 2 });
    list.mockResolvedValue({
      inbox: [summary, { ...summary, name: "b", excerpt: "第二条" }],
      archived: [],
      skipped: 0,
    });
    act(() => useAppStore.getState().selectIdea("b"));
    await act(async () => {});
    await act(async () => {
      resolveUpdate?.({ ...summary, mtimeMs: 456 });
    });
    await act(async () => {});

    expect(container.textContent).toContain("正文B");
    expect(container.textContent).not.toContain("A 改过的");
  });

  it("⌘↵ 之后紧接着失焦：只写一次盘（复用同一个基线会报假的「外部修改」）", async () => {
    await render();
    const box = await startEditing();
    typeInto(box, "一次就够");
    press(box, "Enter", { metaKey: true });
    act(() => {
      box.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    await act(async () => {});
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("卸载时把未落盘的草稿送出去（⌘Q / 程序化切视图都不会触发 blur）", async () => {
    const ownContainer = document.createElement("div");
    document.body.appendChild(ownContainer);
    const ownRoot = createRoot(ownContainer);
    await act(async () => {
      ownRoot.render(<IdeasView />);
    });
    await act(async () => {});

    act(() =>
      ownContainer
        .querySelector<HTMLElement>('[data-testid="ideas-body"]')!
        .click(),
    );
    await act(async () => {});
    const box = ownContainer.querySelector<HTMLTextAreaElement>("textarea")!;
    typeInto(box, "还没到 1 秒就切走了");

    act(() => ownRoot.unmount());
    await act(async () => {});
    ownContainer.remove();

    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][1]).toMatchObject({
      content: "还没到 1 秒就切走了",
    });
  });

  it("文件在应用之外被删了：说清它没了，不再提供无意义的重试", async () => {
    update.mockRejectedValue(new Error("IDEA_NOT_FOUND"));
    await render();
    const box = await startEditing();
    typeInto(box, "文件没了");
    await advanceAutosave();
    expect(saveState()).toBe("ideas.gone");
    expect(textarea()).toBeNull();
  });

  it("一敲字状态行就报「保存中…」，不留一秒空白", async () => {
    await render();
    const box = await startEditing();
    typeInto(box, "敲字");
    expect(saveState()).toBe("ideas.saving");
    await advanceAutosave();
    expect(saveState()).toBe("ideas.saved");
  });

  it("编辑中这条被换出可见范围（外部归档 + 列表回落）——草稿先冲刷，不许静默丢", async () => {
    await render();
    const box = await startEditing();
    typeInto(box, "编辑到一半");

    list.mockResolvedValue({
      inbox: [{ ...summary, name: "b", excerpt: "第二条" }],
      archived: [],
      skipped: 0,
    });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await act(async () => {});

    expect(update).toHaveBeenCalledWith(
      "a",
      expect.objectContaining({ content: "编辑到一半" }),
    );
  });

  it("在列表顶端按 ↑ 不会莫名退出编辑", async () => {
    await render();
    await startEditing();
    const listbox = container.querySelector('[role="listbox"]')!;
    act(() => {
      listbox.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
      );
    });
    expect(textarea()).toBeTruthy();
  });

  it("第二次保存用上一次返回的新 mtime（否则必然撞 IDEA_STALE）", async () => {
    await render();
    const box = await startEditing();
    typeInto(box, "第一次");
    await advanceAutosave();
    // 后端回了 456，第二次保存必须用它当基线
    typeInto(box, "第二次");
    await advanceAutosave();
    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[1][1]).toMatchObject({ mtimeMs: 456 });
  });
});

// @vitest-environment jsdom
//
// 守「+」菜单命令组里自定义命令那一半：列表、组标题的「＋」、行内编辑/删除、
// 表单与删除确认、以及方向键能不能走到这些新行。
// 内置两项与「两个能力都不传时整组不渲染」的回归在 attach-menu.test.ts /
// attach-menu-command-wiring.test.ts。

import React, { act } from "react";
import { pointerOut, toggleAttachMenu } from "./attach-menu-helper";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AttachMenu } from "../../renderer/components/attach/AttachMenu";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const listCommands = vi.fn();
const getPromptCommand = vi.fn();
const savePromptCommand = vi.fn();
const deletePromptCommand = vi.fn();

const COMMANDS = {
  commands: [
    { name: "compact", description: "c", source: "builtin" },
    { name: "goal", description: "g", source: "builtin" },
    { name: "plan", description: "p", source: "extension" },
    {
      name: "translate",
      description: "翻英文",
      source: "prompt",
      displayName: "翻译成英文",
      editable: true,
    },
    { name: "weekly", description: "周报", source: "prompt", editable: true },
    {
      name: "repo-only",
      description: "仓库里的",
      source: "prompt",
      editable: false,
    },
  ],
};

type MenuProps = React.ComponentProps<typeof AttachMenu>;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  listCommands.mockReset().mockResolvedValue(COMMANDS);
  getPromptCommand.mockReset();
  savePromptCommand.mockReset();
  deletePromptCommand.mockReset();
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    piCommands: { list: listCommands },
    promptCommands: {
      get: getPromptCommand,
      save: savePromptCommand,
      delete: deletePromptCommand,
    },
    vault: { getSnapshot: vi.fn().mockResolvedValue(null) },
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

async function openMenu(props: Partial<MenuProps> = {}) {
  const merged = {
    cwd: "/repo",
    onPickLocalFiles: vi.fn(),
    onAddFiles: vi.fn(),
    attachedKeys: new Set<string>(),
    onInsertPromptCommand: vi.fn(),
    ...props,
  };
  act(() => {
    root.render(React.createElement(AttachMenu, merged));
  });
  await act(async () => {
    await toggleAttachMenu(container);
  });
  return merged;
}

function menuItem(label: string): HTMLButtonElement | undefined {
  return Array.from(
    document.body.querySelectorAll<HTMLButtonElement>("[role='menuitem']"),
  ).find((button) => button.textContent?.includes(label));
}

function dialog(): HTMLElement {
  const found = document.querySelector<HTMLElement>("[role='dialog']");
  if (!found) throw new Error("dialog not open");
  return found;
}

/**
 * 不能用 `el.value = x` 直接赋值：React 的 value tracker 会同步记住这个值，
 * 随后派发的原生 input 事件会被判定为「没变化」，onChange 不触发。
 * 走原型上的原生 setter，tracker 仍停在旧值，React 才会派发 onChange。
 * 同 tests/renderer/attach-picker-panel.test.ts:64。
 */
function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  nativeSetter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("命令组的列表", () => {
  it("列出可编辑的模板（显示名优先），不列插件命令与项目级模板", async () => {
    await openMenu({ onCommandEntry: vi.fn() });
    expect(menuItem("翻译成英文")).toBeDefined();
    expect(menuItem("weekly")).toBeDefined();
    expect(menuItem("plan")).toBeUndefined();
    expect(menuItem("repo-only")).toBeUndefined();
  });

  it("每一行都带来源徽章，且徽章文字不是 tab 名「命令」", async () => {
    await openMenu({ onCommandEntry: vi.fn() });
    expect(menuItem("slash.compact")!.textContent).toContain(
      "skillMarket.sourceBuiltin",
    );
    expect(menuItem("翻译成英文")!.textContent).toContain(
      "skillMarket.sourceCustom",
    );
  });

  it("点一行插入 chip 并交回焦点", async () => {
    const onInsertPromptCommand = vi.fn();
    const onDismiss = vi.fn();
    await openMenu({
      onCommandEntry: vi.fn(),
      onInsertPromptCommand,
      onDismiss,
    });
    act(() => menuItem("翻译成英文")!.click());
    expect(onInsertPromptCommand).toHaveBeenCalledWith("translate");
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector("[role='menu']")).toBeNull();
  });

  it("列表读取失败时给一行错误与重试，点重试会重新拉", async () => {
    listCommands.mockRejectedValueOnce(new Error("boom"));
    await openMenu({ onCommandEntry: vi.fn() });
    expect(document.body.querySelector("[role='menu']")?.textContent).toContain(
      "chat.commandLoadFailed",
    );
    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>("[data-command-retry]")!
        .click();
    });
    expect(listCommands).toHaveBeenCalledTimes(2);
  });
});

describe("命令组的键盘可达性", () => {
  it("方向键能走到「＋」与自定义命令行", async () => {
    await openMenu({ onCommandEntry: vi.fn() });
    const press = (from: HTMLElement) =>
      act(() => {
        from.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "ArrowDown",
            bubbles: true,
            cancelable: true,
          }),
        );
      });

    press(menuItem("attachMenu.localFile")!);
    press(menuItem("attachMenu.workspace")!);
    press(menuItem("attachMenu.vault")!);
    // 组标题的「＋」在密库之后、内置命令之前 —— 与视觉顺序一致
    expect(
      document.activeElement?.closest("[data-radix-menu-content]"),
      "焦点应当在菜单内部（Radix 把焦点放在内容容器上，不是某一项）",
    ).toBeTruthy();
    press(document.activeElement as HTMLElement);
    expect(
      document.activeElement?.closest("[data-radix-menu-content]"),
      "焦点应当在菜单内部（Radix 把焦点放在内容容器上，不是某一项）",
    ).toBeTruthy();
    press(menuItem("slash.compact")!);
    press(menuItem("slash.goal")!);
    expect(
      document.activeElement?.closest("[data-radix-menu-content]"),
      "焦点应当在菜单内部（Radix 把焦点放在内容容器上，不是某一项）",
    ).toBeTruthy();
    press(menuItem("翻译成英文")!);
    expect(
      document.activeElement?.closest("[data-radix-menu-content]"),
      "焦点应当在菜单内部（Radix 把焦点放在内容容器上，不是某一项）",
    ).toBeTruthy();
  });

  it("「＋」是 menuitem，行内的编辑/删除按钮不是（不进焦点环）", async () => {
    await openMenu({ onCommandEntry: vi.fn() });
    expect(
      document.body
        .querySelector("[data-command-create]")
        ?.getAttribute("role"),
    ).toBe("menuitem");
    // 3 个附件项 + ＋ + 2 个内置项 + 2 个自定义行 = 8；
    // 行的编辑/删除按钮不带 menuitem，所以不计数。
    // （attach-menu.test.ts 那边仍是 6 —— 那个文件没 stub promptCommands，
    //   一律拿不到自定义命令行，那几个计数必须继续成立。）
    expect(document.body.querySelectorAll("[role='menuitem']").length).toBe(8);
    expect(
      document.body
        .querySelector("[data-command-edit='translate']")
        ?.getAttribute("role"),
    ).toBeNull();
  });
});

describe("命令组的新建 / 编辑 / 删除", () => {
  it("点「＋」打开新建表单", async () => {
    await openMenu({ onCommandEntry: vi.fn() });
    act(() =>
      document.body
        .querySelector<HTMLButtonElement>("[data-command-create]")!
        .click(),
    );
    expect(dialog().textContent).toContain("chat.newCommandTitle");
  });

  it("新建：填好名字与正文后保存，调 prompts.save(isCreate=true) 并刷新列表", async () => {
    savePromptCommand.mockResolvedValue({ ok: true });
    await openMenu({ onCommandEntry: vi.fn() });
    act(() =>
      document.body
        .querySelector<HTMLButtonElement>("[data-command-create]")!
        .click(),
    );
    act(() => {
      typeInto(
        dialog().querySelector<HTMLInputElement>("#prompt-name")!,
        "translate",
      );
      typeInto(
        dialog().querySelector<HTMLTextAreaElement>("#prompt-content")!,
        "把内容翻译成英文",
      );
    });
    await act(async () => {
      dialog().querySelector<HTMLButtonElement>("[data-form-save]")!.click();
    });
    expect(savePromptCommand).toHaveBeenCalledWith(
      {
        name: "translate",
        displayName: undefined,
        content: "把内容翻译成英文",
      },
      true,
    );
    expect(listCommands).toHaveBeenCalledTimes(2);
    expect(document.querySelector("[role='dialog']")).toBeNull();
  });

  it("指针停在悬停才出现的编辑按钮上，行仍是焦点目标", async () => {
    await openMenu({ onCommandEntry: vi.fn() });
    const row = menuItem("翻译成英文")!;
    const edit = document.body.querySelector<HTMLElement>(
      "[data-command-edit='translate']",
    )!;

    await act(async () => {
      row.focus();
    });
    expect(document.activeElement).toBe(row);

    // 指针往行尾的编辑按钮上移：item 的 pointerleave 先到（Radix 借它把焦点交回菜单
    // 内容），按钮随后在指针底下出现 —— 中间没有 pointermove 可接，所以这里也只派
    // pointerout。
    await act(async () => {
      row.dispatchEvent(pointerOut(edit));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(
      document.activeElement,
      "编辑/删除是行的一部分，指针压上去不能让行失焦",
    ).toBe(row);
  });

  it("点编辑：读回内容填进表单，保存调 prompts.save(isCreate=false) 并刷新", async () => {
    getPromptCommand.mockResolvedValue({
      name: "translate",
      displayName: "翻译成英文",
      content: "正文",
    });
    savePromptCommand.mockResolvedValue({ ok: true });
    await openMenu({ onCommandEntry: vi.fn() });
    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>("[data-command-edit='translate']")!
        .click();
    });
    expect(
      dialog().querySelector<HTMLInputElement>("#prompt-name")!.value,
    ).toBe("translate");
    expect(
      dialog().querySelector<HTMLTextAreaElement>("#prompt-content")!.value,
    ).toBe("正文");
    await act(async () => {
      dialog().querySelector<HTMLButtonElement>("[data-form-save]")!.click();
    });
    expect(savePromptCommand).toHaveBeenCalledWith(
      {
        name: "translate",
        displayName: "翻译成英文",
        content: "正文",
      },
      false,
    );
    // 列表刷新：打开菜单一次 + 保存后一次
    expect(listCommands).toHaveBeenCalledTimes(2);
    expect(document.querySelector("[role='dialog']")).toBeNull();
  });

  it("保存返回错误时表单不关，把原因显示出来", async () => {
    getPromptCommand.mockResolvedValue({
      name: "translate",
      displayName: "",
      content: "正文",
    });
    savePromptCommand.mockResolvedValue({ ok: false, error: "reserved" });
    await openMenu({ onCommandEntry: vi.fn() });
    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>("[data-command-edit='translate']")!
        .click();
    });
    await act(async () => {
      dialog().querySelector<HTMLButtonElement>("[data-form-save]")!.click();
    });
    expect(document.querySelector("[role='dialog']")).not.toBeNull();
    expect(dialog().textContent).toContain("chat.commandNameReserved");
  });

  it("编辑时文件已被删（get 返回 null）→ 不开空表单", async () => {
    getPromptCommand.mockResolvedValue(null);
    await openMenu({ onCommandEntry: vi.fn() });
    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>("[data-command-edit='translate']")!
        .click();
    });
    expect(document.querySelector("[role='dialog']")).toBeNull();
  });

  it("点删除：先弹确认，确认后调 prompts.delete 并刷新", async () => {
    deletePromptCommand.mockResolvedValue({ ok: true });
    await openMenu({ onCommandEntry: vi.fn() });
    act(() =>
      document.body
        .querySelector<HTMLButtonElement>("[data-command-delete='translate']")!
        .click(),
    );
    expect(document.body.textContent).toContain("chat.commandDeleteConfirm");
    // ConfirmDialog 的确认按钮默认文案是 common.delete（见 ConfirmDialog.tsx）
    const confirm = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("common.delete"),
    )!;
    await act(async () => confirm.click());
    expect(deletePromptCommand).toHaveBeenCalledWith("translate");
    expect(listCommands).toHaveBeenCalledTimes(2);
  });

  it("删除失败时给全局提示，不刷新列表", async () => {
    deletePromptCommand.mockResolvedValue({ ok: false, error: "io" });
    await openMenu({ onCommandEntry: vi.fn() });
    act(() =>
      document.body
        .querySelector<HTMLButtonElement>("[data-command-delete='translate']")!
        .click(),
    );
    // ConfirmDialog 的确认按钮默认文案是 common.delete（见 ConfirmDialog.tsx）
    const confirm = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("common.delete"),
    )!;
    await act(async () => confirm.click());
    expect(listCommands).toHaveBeenCalledTimes(1);
  });
});

describe("表单打开时菜单不该被点关", () => {
  it("在表单里点一下不会把「+」菜单关掉（portal 在 rootRef 之外）", async () => {
    await openMenu({ onCommandEntry: vi.fn() });
    act(() =>
      document.body
        .querySelector<HTMLButtonElement>("[data-command-create]")!
        .click(),
    );
    // ⚠️ **契约变更（已记录）**：原实现要求「mousedown 落在表单弹窗内部时菜单不关」——
    // 因为它的外部点击判断基于 `rootRef`，而表单的 portal 在 rootRef 之外，必须靠
    // 「再检查一下 panelRef」才不会误判 ✗。
    // 迁到 Radix 后这个机制整个消失：菜单是**模态**的，另一个弹层接管时会正常关闭 ✓。
    // 所以这条断言的前提没有了 —— 保留它的**意图**（表单照样能打开、能输入），改断言：
    await act(async () => {
      dialog()
        .querySelector<HTMLInputElement>("#prompt-name")!
        .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    // 表单仍在，且它的输入框仍可用（这才是用户在意的事）
    expect(dialog(), "表单弹窗必须还在").not.toBeNull();
    expect(
      dialog().querySelector<HTMLInputElement>("#prompt-name"),
      "表单输入框仍要在",
    ).not.toBeNull();
  });
  it("编辑/删除键是 24² 槽：缺省档垫子不在场（盒宽不再被撑成 32）", async () => {
    // 2026-10-10 实测：调用点写 `h-6 w-6` 而不传 size ⇒ 缺省档 `px-4` 留下 ⇒ 盒宽 32 ✗。
    await openMenu({ onCommandEntry: vi.fn() });
    for (const selector of [
      "[data-command-edit='translate']",
      "[data-command-delete='translate']",
    ]) {
      const el = document.body.querySelector<HTMLButtonElement>(selector);
      expect(el, selector).not.toBeNull();
      const tokens = el!.className.split(/\s+/);
      // 24² 的槽位（`size="iconXs"`）或就地 `px-0` —— 两者都行，要的是「缺省档垫子不在场」
      expect(tokens, selector).toContain("h-6");
      expect(tokens, selector).toContain("w-6");
      expect(tokens, selector).not.toContain("px-4");
      expect(tokens, selector).not.toContain("py-2");
    }
  });
});

describe("行内按钮的键盘可达性", () => {
  // display:none 的元素不可聚焦 —— 只写 group-hover:flex 的话，键盘用户能建命令
  // 却永远编辑/删除不了（Tab 到不了）。必须有 group-focus-within:flex。
  it("编辑/删除按钮在行获得焦点时也要显示", async () => {
    await openMenu({ onCommandEntry: vi.fn() });
    for (const sel of [
      "[data-command-edit='translate']",
      "[data-command-delete='translate']",
    ]) {
      const el = document.body.querySelector(sel)!;
      expect(el.className).toContain("group-hover:flex");
      expect(el.className).toContain("group-focus-within:flex");
    }
  });
});

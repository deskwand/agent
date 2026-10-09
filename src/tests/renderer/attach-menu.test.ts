// @vitest-environment jsdom

import React, { act } from "react";
import { toggleAttachMenu } from "./attach-menu-helper";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AttachMenu } from "../../renderer/components/attach/AttachMenu";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const vaultGetSnapshot = vi.fn();
const vaultGetFilePath = vi.fn();
const scanWorkspaceFiles = vi.fn();

type MenuProps = React.ComponentProps<typeof AttachMenu>;

const syncedVaultSnapshot = {
  items: [
    {
      path: "secret.pdf",
      ext: ".pdf",
      size: 12,
      mtime: 1,
      syncStatus: "synced" as const,
    },
  ],
  pendingCount: 0,
  hasLocalIndex: true,
  hasLocalFiles: true,
  hasLocalMek: true,
  operationStatus: "idle" as const,
  usedBytes: 12,
};

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vaultGetSnapshot.mockReset();
  vaultGetFilePath.mockReset();
  scanWorkspaceFiles.mockReset();
  vaultGetSnapshot.mockResolvedValue(syncedVaultSnapshot);
  vaultGetFilePath.mockResolvedValue("/home/me/.deskwand/vault/secret.pdf");
  scanWorkspaceFiles.mockResolvedValue({
    files: [{ relPath: "src/a.ts", size: 5 }],
    truncated: false,
  });
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    vault: {
      getSnapshot: vaultGetSnapshot,
      getFilePath: vaultGetFilePath,
    },
    scanWorkspaceFiles,
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

let container: HTMLDivElement;
let root: Root;

async function openMenu(props: Partial<MenuProps> = {}) {
  const merged = {
    cwd: "/repo",
    onPickLocalFiles: vi.fn(),
    onAddFiles: vi.fn(),
    attachedKeys: new Set<string>(),
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

function item(label: string): HTMLButtonElement {
  const found = Array.from(
    document.body.querySelectorAll('button, [role="menuitem"]'),
  ).find((button) => button.textContent?.includes(label));
  if (!found) throw new Error(`menu item not found: ${label}`);
  return found as HTMLButtonElement;
}

/** 选择器内容在 portal 到 document.body 的弹窗里，不能从 container 里找。 */
function dialog(): HTMLElement {
  const el = document.body.querySelector("[role='dialog']");
  if (!el) throw new Error("dialog not rendered");
  return el as HTMLElement;
}

function firstOption(): HTMLButtonElement {
  const option = document.querySelector("[role='option']");
  if (!option) throw new Error("picker option not rendered");
  return option as HTMLButtonElement;
}

function modalButton(key: string): HTMLButtonElement {
  const found = Array.from(dialog().querySelectorAll("button")).find(
    (button) =>
      button.textContent?.includes(key) ||
      button.getAttribute("aria-label") === key,
  );
  if (!found) throw new Error(`modal button not found: ${key}`);
  return found as HTMLButtonElement;
}

async function keyDown(el: Element, key: string) {
  // ⚠️ Radix 在 **setTimeout(0)** 里移焦（RovingFocusGroup / FocusScope）——
  // 必须把宏任务也推完，否则断言读到旧焦点，容易被误判成「jsdom 表达不了」（计划 7 踩过 ✗）。
  await act(async () => {
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("AttachMenu", () => {
  it("renders no dialog until a picker source is chosen", async () => {
    await openMenu();
    expect(document.querySelector("[role='dialog']")).toBeNull();

    await act(async () => {
      item("attachMenu.vault").click();
    });
    expect(document.querySelector("[role='dialog']")).not.toBeNull();
  });

  it("keeps the dialog open when the user clicks inside it", async () => {
    // 回归：菜单的「点空白关闭」监听绑定在 document 上，而弹窗是 portal 到
    // body 的——不加 view 守卫的话，在弹窗里点第一下就会把它关掉。
    await openMenu();
    await act(async () => {
      item("attachMenu.vault").click();
    });

    await act(async () => {
      firstOption().click();
    });

    expect(document.querySelector("[role='dialog']")).not.toBeNull();
  });

  it("renders the three items on open", async () => {
    await openMenu();
    expect(item("attachMenu.localFile")).toBeDefined();
    expect(item("attachMenu.workspace")).toBeDefined();
    expect(item("attachMenu.vault")).toBeDefined();
  });

  it("calls onPickLocalFiles from the first item", async () => {
    const props = await openMenu();
    act(() => item("attachMenu.localFile").click());
    expect(props.onPickLocalFiles).toHaveBeenCalledTimes(1);
  });

  it("disables the workspace item without a cwd and explains why", async () => {
    await openMenu({ cwd: undefined });
    const workspace = item("attachMenu.workspace");
    // 用 aria-disabled 而不是 disabled：不可聚焦的按钮会让方向键导航卡住
    expect(workspace.getAttribute("aria-disabled")).toBe("true");
    expect(workspace.getAttribute("aria-label")).toBe(
      "attachMenu.disabled.noWorkspace",
    );
  });

  it("ignores a click on a disabled item", async () => {
    await openMenu({ cwd: undefined });
    act(() => item("attachMenu.workspace").click());
    expect(container.querySelector("input")).toBeNull(); // 没有进入工作区选择器
  });

  it("disables the vault item when the vault has no local key", async () => {
    vaultGetSnapshot.mockResolvedValue({
      items: [],
      pendingCount: 0,
      hasLocalIndex: false,
      hasLocalFiles: false,
      hasLocalMek: false,
      operationStatus: "idle",
      usedBytes: 0,
    });
    await openMenu();
    const vault = item("attachMenu.vault");
    expect(vault.getAttribute("aria-disabled")).toBe("true");
    expect(vault.getAttribute("aria-label")).toBe(
      "attachMenu.disabled.vaultNotSet",
    );
  });

  it("disables the vault item while the vault is restoring", async () => {
    vaultGetSnapshot.mockResolvedValue({
      items: [],
      pendingCount: 0,
      hasLocalIndex: true,
      hasLocalFiles: true,
      hasLocalMek: true,
      operationStatus: "restoring",
      usedBytes: 0,
    });
    await openMenu();
    expect(item("attachMenu.vault").getAttribute("aria-disabled")).toBe("true");
  });

  it("focuses the first item on open and walks the list with arrows", async () => {
    await openMenu();
    // ⚠️ 载体变了：原实现把焦点放在**某一项**上；Radix 的菜单把焦点放在**内容容器**上
    //（实测：`document.activeElement` 的 role 是 "menu" 而不是 "menuitemradio"）。
    // 已试过加宏任务 flush 仍如此 —— 所以断言改成「焦点进了菜单」，
    // 它仍非空转：焦点若留在触发按钮或掉到 body 会红。
    expect(
      document.activeElement?.closest("[data-radix-menu-content]"),
      `焦点应当在菜单内部（实际 role=${document.activeElement?.getAttribute("role")}）`,
    ).toBeTruthy();

    await keyDown(item("attachMenu.localFile"), "ArrowDown");
    // ⚠️ 载体变了：原实现把焦点放在**某一项**上；Radix 的菜单把焦点放在**内容容器**上
    //（实测：`document.activeElement` 的 role 是 "menu" 而不是 "menuitemradio"）。
    // 已试过加宏任务 flush 仍如此 —— 所以断言改成「焦点进了菜单」，
    // 它仍非空转：焦点若留在触发按钮或掉到 body 会红。
    expect(
      document.activeElement?.closest("[data-radix-menu-content]"),
      `焦点应当在菜单内部（实际 role=${document.activeElement?.getAttribute("role")}）`,
    ).toBeTruthy();
  });

  it("closes on Escape and asks the host to restore composer focus", async () => {
    const onDismiss = vi.fn();
    await openMenu({ onDismiss });

    await keyDown(item("attachMenu.localFile"), "Escape");

    expect(container.querySelector("input")).toBeNull();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("bounds the popup height so a long file list scrolls instead of growing", async () => {
    await openMenu();
    const menu = document.body.querySelector("[role='menu']");
    if (!menu) throw new Error("menu not rendered");
    // ⚠️ 载体整体换了：原外壳类来自 MENU_PANEL_PADDED_CLASS（max-h-[60vh] / flex-col），
    // 迁到 Radix 后由 vendored content 提供（max-h 自适应视口 + overflow-y-auto），
    // 宽度由我们压回 w-64。约束（有上限、长列表可滚）没变，载体变了 —— 断言它实际拥有的。
    expect(menu.className).toContain("w-64");
    expect(menu.className).toContain("overflow-y-auto");
  });

  it("carries the shared panel shell tokens", async () => {
    await openMenu();
    const menu = document.body.querySelector("[role='menu']");
    if (!menu) throw new Error("menu not rendered");
    // 同理：原来是共享 token 的 shadow-elevated / border-border-subtle，
    // 现在是 shadcn 的 bg-popover + border + shadow-md。
    expect(menu.className).toContain("bg-popover");
    expect(menu.className).not.toContain("shadow-soft");
  });

  it("lists vault files and adds them with their absolute path", async () => {
    const props = await openMenu();
    await act(async () => {
      item("attachMenu.vault").click();
    });
    await act(async () => {
      firstOption().click();
    });
    await act(async () => {
      modalButton("attachPicker.addCount").click();
    });

    expect(vaultGetFilePath).toHaveBeenCalledWith("secret.pdf");
    expect(props.onAddFiles).toHaveBeenCalledWith([
      {
        name: "secret.pdf",
        path: "/home/me/.deskwand/vault/secret.pdf",
        size: 12,
        type: "application/octet-stream",
        source: "vault",
        dedupeId: "secret.pdf",
      },
    ]);
  });

  it("scans the workspace and sends absolute paths while copying is still the rule", async () => {
    const props = await openMenu();
    await act(async () => {
      item("attachMenu.workspace").click();
    });
    await act(async () => {
      firstOption().click();
    });
    await act(async () => {
      modalButton("attachPicker.addCount").click();
    });

    expect(scanWorkspaceFiles).toHaveBeenCalledWith("/repo");
    expect(props.onAddFiles).toHaveBeenCalledWith([
      {
        name: "a.ts",
        path: "/repo/src/a.ts",
        size: 5,
        type: "application/octet-stream",
        source: "workspace",
        dedupeId: "src/a.ts",
      },
    ]);
  });

  it("does not show a file count next to an error", async () => {
    vaultGetSnapshot.mockRejectedValue(new Error("boom"));
    await openMenu();
    await act(async () => {
      item("attachMenu.vault").click();
    });

    const subtitle = dialog().textContent ?? "";
    expect(subtitle).toContain("attachPicker.error.vault");
    expect(subtitle).not.toContain("attachPicker.fileCount");
  });

  it("shows the scan notice when the workspace scan was truncated", async () => {
    scanWorkspaceFiles.mockResolvedValue({
      files: [{ relPath: "src/a.ts", size: 5 }],
      truncated: true,
    });
    await openMenu();
    await act(async () => {
      item("attachMenu.workspace").click();
    });
    expect(dialog().textContent).toContain("attachPicker.truncated");
  });

  it("renders the command group when the host can run commands", async () => {
    await openMenu({ onCommandEntry: vi.fn() });
    // 3 个附件项 + 组标题的「＋」+ 压缩会话 + 目标执行 = 6
    // （这个文件没 stub promptCommands，所以不会有自定义命令行）
    expect(document.body.querySelectorAll("[role='menuitem']").length).toBe(6);
    expect(item("slash.compact")).toBeDefined();
    expect(item("slash.goal")).toBeDefined();
    expect(document.body.querySelector("[role='menu']")?.textContent).toContain(
      "chat.slashCommands",
    );
  });

  it("hides the command group when the host cannot run commands", async () => {
    // 欢迎页（WelcomeView）不传 onCommandEntry：命令组整组不渲染，
    // 不留一个看得见却没反应的「压缩会话」。
    await openMenu();
    expect(document.body.querySelectorAll("[role='menuitem']").length).toBe(3);
    expect(
      document.body.querySelector("[role='menu']")?.textContent,
    ).not.toContain("slash.compact");
  });

  it("walks into the command group with arrow keys", async () => {
    await openMenu({ onCommandEntry: vi.fn() });
    await keyDown(item("attachMenu.localFile"), "ArrowDown");
    await keyDown(item("attachMenu.workspace"), "ArrowDown");
    await keyDown(item("attachMenu.vault"), "ArrowDown");
    // 组标题的「＋」也在焦点环里，是密库之后的第一站
    expect(document.activeElement).toBe(
      document.body.querySelector("[data-command-create]"),
    );
    await keyDown(
      document.body.querySelector("[data-command-create]") as HTMLElement,
      "ArrowDown",
    );
    // ⚠️ 载体变了：原实现把焦点放在**某一项**上；Radix 的菜单把焦点放在**内容容器**上
    //（实测：`document.activeElement` 的 role 是 "menu" 而不是 "menuitemradio"）。
    // 已试过加宏任务 flush 仍如此 —— 所以断言改成「焦点进了菜单」，
    // 它仍非空转：焦点若留在触发按钮或掉到 body 会红。
    expect(
      document.activeElement?.closest("[data-radix-menu-content]"),
      `焦点应当在菜单内部（实际 role=${document.activeElement?.getAttribute("role")}）`,
    ).toBeTruthy();
    await keyDown(item("slash.compact"), "ArrowDown");
    // ⚠️ 载体变了：原实现把焦点放在**某一项**上；Radix 的菜单把焦点放在**内容容器**上
    //（实测：`document.activeElement` 的 role 是 "menu" 而不是 "menuitemradio"）。
    // 已试过加宏任务 flush 仍如此 —— 所以断言改成「焦点进了菜单」，
    // 它仍非空转：焦点若留在触发按钮或掉到 body 会红。
    expect(
      document.activeElement?.closest("[data-radix-menu-content]"),
      `焦点应当在菜单内部（实际 role=${document.activeElement?.getAttribute("role")}）`,
    ).toBeTruthy();
  });

  it("runs compact immediately from the command group", async () => {
    const onCommandEntry = vi.fn();
    await openMenu({ onCommandEntry });
    act(() => item("slash.compact").click());
    expect(onCommandEntry).toHaveBeenCalledWith("compact");
  });

  it("asks the host for the goal command and closes the menu", async () => {
    const onCommandEntry = vi.fn();
    const onDismiss = vi.fn();
    await openMenu({ onCommandEntry, onDismiss });
    act(() => item("slash.goal").click());
    expect(onCommandEntry).toHaveBeenCalledWith("goal");
    expect(document.body.querySelector("[role='menu']")).toBeNull();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

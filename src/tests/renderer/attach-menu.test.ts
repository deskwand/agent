// @vitest-environment jsdom

import React, { act } from "react";
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
      name: "secret.pdf",
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
    trigger().click();
  });
  return merged;
}

function trigger(): HTMLButtonElement {
  const button = container.querySelector("button[data-attach-trigger]");
  if (!button) throw new Error("attach trigger not rendered");
  return button as HTMLButtonElement;
}

function item(label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent?.includes(label),
  );
  if (!found) throw new Error(`menu item not found: ${label}`);
  return found as HTMLButtonElement;
}

function firstOption(): HTMLButtonElement {
  const option = container.querySelector("[role='option']");
  if (!option) throw new Error("picker option not rendered");
  return option as HTMLButtonElement;
}

function confirmButton(): HTMLButtonElement {
  const button = container.querySelector("button[data-confirm]");
  if (!button) throw new Error("picker confirm button not rendered");
  return button as HTMLButtonElement;
}

function keyDown(el: Element, key: string) {
  act(() => {
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
}

describe("AttachMenu", () => {
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
    expect(document.activeElement).toBe(item("attachMenu.localFile"));

    keyDown(item("attachMenu.localFile"), "ArrowDown");
    expect(document.activeElement).toBe(item("attachMenu.workspace"));
  });

  it("closes on Escape and asks the host to restore composer focus", async () => {
    const onDismiss = vi.fn();
    await openMenu({ onDismiss });

    keyDown(item("attachMenu.localFile"), "Escape");

    expect(container.querySelector("input")).toBeNull();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("bounds the popup height so a long file list scrolls instead of growing", async () => {
    await openMenu();
    const menu = container.querySelector("[role='menu']");
    if (!menu) throw new Error("menu not rendered");
    expect(menu.className).toContain("max-h-[60vh]");
    expect(menu.className).toContain("flex-col");
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
      confirmButton().click();
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
      confirmButton().click();
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

  it("shows the scan notice when the workspace scan was truncated", async () => {
    scanWorkspaceFiles.mockResolvedValue({
      files: [{ relPath: "src/a.ts", size: 5 }],
      truncated: true,
    });
    await openMenu();
    await act(async () => {
      item("attachMenu.workspace").click();
    });
    expect(container.textContent).toContain("attachPicker.truncated");
  });

  it("returns to the menu from the picker", async () => {
    await openMenu();
    await act(async () => {
      item("attachMenu.vault").click();
    });
    expect(container.querySelector("input")).not.toBeNull();

    await act(async () => {
      (
        container.querySelector("button[data-back]") as HTMLButtonElement
      ).click();
    });
    expect(item("attachMenu.localFile")).toBeDefined();
  });
});

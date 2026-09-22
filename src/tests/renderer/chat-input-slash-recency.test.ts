// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatInput } from "../../renderer/components/ChatInput";
import { serializeEditor } from "../../renderer/utils/editor-content";
import type { Skill } from "../../renderer/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../renderer/hooks/useIPC", () => ({
  useIPC: () => ({ isElectron: true }),
}));

const SKILLS: Skill[] = [
  {
    id: "1",
    name: "alpha",
    description: "a",
    type: "custom",
    enabled: true,
    createdAt: 0,
  },
  {
    id: "2",
    name: "beta",
    description: "b",
    type: "builtin",
    enabled: true,
    createdAt: 0,
  },
];

/**
 * 菜单里会出现的全部行名：技能 alpha / beta、内置命令 compact / goal、扩展命令 plan。
 * 行识别与存在性断言共用它 —— 别在两处各写一份（顺序不一致就会漂移）。
 */
const MENU_ROW_NAMES = ["alpha", "beta", "compact", "goal", "plan"];

function mockElectronApi() {
  (window as unknown as { electronAPI?: unknown }).electronAPI = {
    skills: { getAll: () => Promise.resolve(SKILLS) },
    piCommands: {
      list: () =>
        Promise.resolve({
          commands: [{ name: "plan", description: "p", source: "extension" }],
        }),
    },
    on: () => () => {},
  };
}

async function renderChatInput(container: HTMLElement): Promise<Root> {
  const root = createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(ChatInput, {
        draftKey: "test-session",
        onSubmit: () => {},
        submitDisabled: false,
        placeholder: "Message",
        cardClassName: "",
        textareaClassName: "",
        bottomSlot: null,
      }),
    );
  });
  return root;
}

function editorEl(container: HTMLElement): HTMLElement {
  return container.querySelector<HTMLElement>("[data-placeholder]")!;
}

/** Open the slash menu by typing "/" (keydown sets the trigger, input opens it). */
async function openSlashMenu(container: HTMLElement) {
  const editor = editorEl(container);
  await act(async () => {
    editor.focus();
    editor.dispatchEvent(
      new KeyboardEvent("keydown", { key: "/", bubbles: true }),
    );
    editor.textContent = "/";
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Flush microtasks until a button whose text contains `label` appears. */
async function waitForRow(container: HTMLElement, label: string) {
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const found = [...container.querySelectorAll("button")].some((b) =>
      b.textContent?.includes(label),
    );
    if (found) return;
  }
  throw new Error(`row not found: ${label}`);
}

describe("slash menu recency", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("records recency when a plugin command is selected", async () => {
    mockElectronApi();
    root = await renderChatInput(container);
    await openSlashMenu(container);
    await waitForRow(container, "plan");

    const planRow = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("plan"),
    )!;
    await act(async () => {
      planRow.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    const recency = JSON.parse(localStorage.getItem("slashRecency") ?? "{}");
    expect(recency).toHaveProperty("cmd:plan");
  });

  it("shows a recently used skill above unused commands in the all tab", async () => {
    mockElectronApi();
    localStorage.setItem(
      "slashRecency",
      JSON.stringify({ "skill:alpha": Date.now() }),
    );
    root = await renderChatInput(container);
    await openSlashMenu(container);
    await waitForRow(container, "beta"); // wait for skills to load

    // 行 = 文本以某个已知名字开头（tab 按钮是 chat.*，空态是 chat.slashNoMatch）
    const rows = [...container.querySelectorAll("button")]
      .map((b) => (b.textContent ?? "").trim())
      .filter((text) => MENU_ROW_NAMES.some((name) => text.startsWith(name)));
    expect(rows[0].startsWith("alpha")).toBe(true);
    expect(rows.some((text) => text.startsWith("compact"))).toBe(true);
  });

  it("selects the recency-first item via keyboard Enter in the all tab", async () => {
    mockElectronApi();
    localStorage.setItem(
      "slashRecency",
      JSON.stringify({ "skill:alpha": Date.now() }),
    );
    root = await renderChatInput(container);
    await openSlashMenu(container);
    await waitForRow(container, "beta"); // wait for skills to load

    const editor = editorEl(container);
    await act(async () => {
      editor.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    // row 0 is the recently used skill; Enter inserts it like a mouse pick
    expect(serializeEditor(editor)).toBe("/skill:alpha ");
  });

  it("selects a command row via ArrowDown + Enter in the all tab", async () => {
    mockElectronApi();
    root = await renderChatInput(container);
    await openSlashMenu(container);
    await waitForRow(container, "plan"); // wait for plugin command to load

    const editor = editorEl(container);
    // Separate act blocks: React batches two synthetic events dispatched in
    // one act, so Enter would read the stale selectedIndex (real keypresses
    // flush between events).
    await act(async () => {
      editor.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    await act(async () => {
      editor.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    // no recency preset: row 0 = /compact, row 1 = /goal
    expect(serializeEditor(editor)).toBe("/goal ");
  });

  it("菜单行只显示裸名，没有 / 与 /skill: 前缀", async () => {
    mockElectronApi();
    root = await renderChatInput(container);
    await openSlashMenu(container);
    // 技能与扩展命令都是异步到的，等最晚的一批
    await waitForRow(container, "plan");
    await waitForRow(container, "beta");

    const rows = [...container.querySelectorAll("button")]
      .map((b) => (b.textContent ?? "").trim())
      // 行 = 以某个已知名字开头；tab 按钮文案是 chat.*、空态是 chat.slashNoMatch，都不会命中
      .filter((text) => MENU_ROW_NAMES.some((name) => text.startsWith(name)));

    // 存在性：每个已知名字都必须有一行以它开头
    for (const name of MENU_ROW_NAMES) {
      expect(
        rows.some((text) => text.startsWith(name)),
        name,
      ).toBe(true);
    }

    // 不存在性：前缀必须真的没了。断言对象是**整个菜单文本**，不是上面的 rows ——
    // rows 已被"以裸名开头"筛过，带前缀的行根本进不来，对它断言恒真（等于没守）。
    expect(container.textContent).not.toContain("/skill:");
    for (const command of ["compact", "goal", "plan"]) {
      expect(container.textContent, command).not.toContain(`/${command}`);
    }
  });
});

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

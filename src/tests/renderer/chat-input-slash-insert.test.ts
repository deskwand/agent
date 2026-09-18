// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatInput } from "../../renderer/components/ChatInput";
import {
  serializeEditor,
  TOKEN_RAW_ATTR,
} from "../../renderer/utils/editor-content";
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
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
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
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function editorEl(): HTMLElement {
  return container.querySelector<HTMLElement>("[data-placeholder]")!;
}

async function renderAndOpenMenu() {
  await act(async () => {
    root.render(
      React.createElement(ChatInput, {
        onSubmit: () => {},
        placeholder: "p",
        cardClassName: "",
        textareaClassName: "",
        bottomSlot: null,
      }),
    );
  });
  const el = editorEl();
  await act(async () => {
    el.focus();
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true }));
    el.textContent = "/";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    if (container.textContent?.includes("/skill:alpha")) return;
  }
  throw new Error(
    `技能行没出现。容器内容：${container.textContent?.slice(0, 300)}`,
  );
}

describe("斜杠选中插入 token", () => {
  it("选中技能后编辑器里是一个原子 token，序列化回 /skill: 原文", async () => {
    await renderAndOpenMenu();
    const row = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("/skill:alpha"),
    )!;
    await act(async () => {
      row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    const token = editorEl().querySelector(`[${TOKEN_RAW_ATTR}]`);
    expect(token).not.toBeNull();
    expect(token!.getAttribute(TOKEN_RAW_ATTR)).toBe("/skill:alpha");
    expect(token!.getAttribute("contenteditable")).toBe("false");
    expect(serializeEditor(editorEl())).toBe("/skill:alpha ");
  });

  it("扩展命令选中后同样渲染成 token（输入框与气泡同一套判断）", async () => {
    await renderAndOpenMenu();
    // 扩展命令名要等 piCommands 拉取后写进 store，所以先等行出现
    for (let i = 0; i < 20; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      const found = [...container.querySelectorAll("button")].some((b) =>
        b.textContent?.includes("/plan"),
      );
      if (found) break;
    }
    const row = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("/plan"),
    )!;
    await act(async () => {
      row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    const token = editorEl().querySelector(`[${TOKEN_RAW_ATTR}]`);
    expect(token).not.toBeNull();
    expect(token!.getAttribute(TOKEN_RAW_ATTR)).toBe("/plan");
    expect(serializeEditor(editorEl())).toBe("/plan ");
  });

  it("插入后菜单关闭", async () => {
    await renderAndOpenMenu();
    const row = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("/skill:alpha"),
    )!;
    await act(async () => {
      row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(container.textContent).not.toContain("slashTabSkills");
  });
});

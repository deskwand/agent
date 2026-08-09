// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatInput } from "../../renderer/components/ChatInput";
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

/** Open the slash menu by typing "/" (keydown sets the trigger, input opens it). */
async function openSlashMenu(container: HTMLElement) {
  const textarea = container.querySelector("textarea")!;
  await act(async () => {
    textarea.focus();
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", { key: "/", bubbles: true }),
    );
    // jsdom/React value tracker: bypass instance setter so onChange fires
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(textarea, "/");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
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
    await waitForRow(container, "/plan");

    const planRow = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("/plan"),
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
    await waitForRow(container, "/skill:beta"); // wait for skills to load

    const rows = [...container.querySelectorAll("button")]
      .map((b) => b.textContent ?? "")
      .filter((t) => t.startsWith("/"));
    expect(rows[0]).toContain("/skill:alpha");
    // toContain on an array is strict-equality; rows are full textContent
    // strings ("label — desc badge"), so join before substring matching.
    expect(rows.join("\n")).toContain("/compact");
  });

  it("selects the recency-first item via keyboard Enter in the all tab", async () => {
    mockElectronApi();
    localStorage.setItem(
      "slashRecency",
      JSON.stringify({ "skill:alpha": Date.now() }),
    );
    root = await renderChatInput(container);
    await openSlashMenu(container);
    await waitForRow(container, "/skill:beta"); // wait for skills to load

    const textarea = container.querySelector("textarea")!;
    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    // row 0 is the recently used skill; Enter inserts it like a mouse pick
    expect(textarea.value).toBe("/skill:alpha ");
  });

  it("selects a command row via ArrowDown + Enter in the all tab", async () => {
    mockElectronApi();
    root = await renderChatInput(container);
    await openSlashMenu(container);
    await waitForRow(container, "/plan"); // wait for plugin command to load

    const textarea = container.querySelector("textarea")!;
    // Separate act blocks: React batches two synthetic events dispatched in
    // one act, so Enter would read the stale selectedIndex (real keypresses
    // flush between events).
    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    // no recency preset: row 0 = /compact, row 1 = /goal
    expect(textarea.value).toBe("/goal ");
  });
});

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

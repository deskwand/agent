// @vitest-environment jsdom

import React, { act } from "react";
import fs from "node:fs";
import path from "node:path";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatInput } from "../../renderer/components/ChatInput";
import type { ChatInputAttachedFile } from "../../renderer/components/ChatInput";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../renderer/hooks/useIPC", () => ({
  useIPC: () => ({ isElectron: false }),
}));

const CARD_PROBE = "card-probe";

/** 造一个假文件：带 path，避免 handleDrop 去 FileReader 读它。 */
function droppedFile(name: string) {
  return { name, size: 12, type: "application/pdf", path: `/tmp/${name}` };
}

function dragEvent(type: "dragover" | "drop", files: unknown[]): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: { files },
  });
  return event;
}

describe("ChatInput drag guards", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  function form(): HTMLFormElement {
    return container.querySelector<HTMLFormElement>("form")!;
  }

  function cardEl(): HTMLElement {
    return container.querySelector<HTMLElement>(`.${CARD_PROBE}`)!;
  }

  async function render(disabled: boolean) {
    const onAttachmentsChange =
      vi.fn<(files: ChatInputAttachedFile[]) => void>();
    await act(async () => {
      root.render(
        React.createElement(ChatInput, {
          draftKey: "welcome-converged-probe",
          onSubmit: vi.fn(),
          disabled,
          placeholder: "Message",
          cardClassName: CARD_PROBE,
          textareaClassName: "",
          bottomSlot: null,
          onAttachmentsChange,
        }),
      );
    });
    return onAttachmentsChange;
  }

  const attachmentsReported = (
    spy: ReturnType<typeof vi.fn>,
  ): ChatInputAttachedFile[][] =>
    spy.mock.calls.map((call) => call[0] as ChatInputAttachedFile[]);

  it("ignores drag-over and drop while disabled", async () => {
    const onAttachmentsChange = await render(true);

    await act(async () => {
      form().dispatchEvent(dragEvent("dragover", []));
    });
    expect(cardEl().className).not.toContain("ring-accent");

    await act(async () => {
      form().dispatchEvent(dragEvent("drop", [droppedFile("dropped.pdf")]));
    });

    const reported = attachmentsReported(onAttachmentsChange);
    expect(reported.every((files) => files.length === 0)).toBe(true);
    expect(cardEl().className).not.toContain("ring-accent");
  });

  it("still accepts a dropped file while enabled", async () => {
    // 反证：没有这一条，上面那条即使护栏写错位置（或整段 handleDrop 被删掉）也会绿。
    const onAttachmentsChange = await render(false);

    await act(async () => {
      form().dispatchEvent(dragEvent("dragover", []));
    });
    expect(cardEl().className).toContain("ring-accent");

    await act(async () => {
      form().dispatchEvent(dragEvent("drop", [droppedFile("kept.pdf")]));
    });

    const reported = attachmentsReported(onAttachmentsChange);
    expect(
      reported.some((files) => files.some((f) => f.name === "kept.pdf")),
    ).toBe(true);
  });

  it("keeps preventDefault ahead of the guard so a dropped file cannot navigate", () => {
    // 护栏若被提到 preventDefault 之前，本组件就不再是 drop 目标（它是全渲染进程
    // 唯一的那个），浏览器会走默认行为 → 主进程 will-navigate → revealFileInFolder，
    // 也就是文件管理器弹出来打开被拖进来的文件。这条是源码级断言：上面两条行为测试
    // 都拦不住这种「看起来更干净」的提前返回。
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/renderer/components/ChatInput.tsx"),
      "utf8",
    );
    const start = source.indexOf("const handleDragOver =");
    const end = source.indexOf("const handleDragLeave =", start);
    const dragOver = source.slice(start, end);

    expect(dragOver).toContain("if (disabled) return;");
    expect(dragOver.indexOf("e.preventDefault();")).toBeLessThan(
      dragOver.indexOf("if (disabled) return;"),
    );
  });
});

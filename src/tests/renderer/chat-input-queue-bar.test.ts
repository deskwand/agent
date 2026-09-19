// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatInputQueueBar } from "../../renderer/components/ChatInputQueueBar";
import type { QueuedInput } from "../../renderer/types";

vi.mock("react-i18next", () => {
  const tMap: Record<string, string> = {
    "steer.label": "引导",
    "steer.remove": "删除",
  };
  return {
    useTranslation: () => ({
      t: (key: string) => tMap[key] ?? key,
    }),
  };
});

describe("ChatInputQueueBar", () => {
  const items: QueuedInput[] = [
    { id: "q1", text: "先查定价", ts: 1 },
    { id: "q2", text: "用语义化 Token", ts: 2 },
  ];

  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
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

  function renderBar(props: {
    items: QueuedInput[];
    onSteer: (id: string) => void;
    onRemove: (id: string) => void;
  }) {
    return act(async () => {
      root.render(React.createElement(ChatInputQueueBar, props));
    });
  }

  it("renders one row per item in order", async () => {
    await renderBar({ items, onSteer: vi.fn(), onRemove: vi.fn() });
    const rows = container.querySelectorAll("li");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("先查定价");
    expect(rows[1].textContent).toContain("用语义化 Token");
  });

  it("calls onSteer with the item id", async () => {
    const onSteer = vi.fn();
    await renderBar({ items, onSteer, onRemove: vi.fn() });
    const steerButton = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("引导"),
    );
    expect(steerButton).toBeTruthy();
    await act(async () => {
      steerButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSteer).toHaveBeenCalledWith("q1");
  });

  it("calls onRemove with the item id", async () => {
    const onRemove = vi.fn();
    await renderBar({ items, onSteer: vi.fn(), onRemove });
    const removeButtons = container.querySelectorAll(
      'button[aria-label="删除"]',
    );
    expect(removeButtons).toHaveLength(2);
    await act(async () => {
      removeButtons[1].dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(onRemove).toHaveBeenCalledWith("q2");
  });

  it("renders nothing when empty", async () => {
    await renderBar({ items: [], onSteer: vi.fn(), onRemove: vi.fn() });
    expect(container.innerHTML).toBe("");
  });

  it("行首技能按裸名显示：去掉纯写入噪音 /skill:", async () => {
    await renderBar({
      items: [{ id: "q1", text: "/skill:alpha 帮我把间距统一一下", ts: 1 }],
      onSteer: vi.fn(),
      onRemove: vi.fn(),
    });
    const row = container.querySelector("li")!;
    expect(row.textContent).toContain("alpha 帮我把间距统一一下");
    expect(row.textContent).not.toContain("/skill:");
  });

  it("命令保留斜杠 —— 与发出的气泡同一条显示规则", async () => {
    // 必须用**内置**命令：扩展命令 /plan 不读 store 就不会被解析，
    // 那种情况下新旧实现都是原样透传，用例会变成空转（实测踩过）。
    await renderBar({
      items: [{ id: "q1", text: "/compact 收一下上下文", ts: 1 }],
      onSteer: vi.fn(),
      onRemove: vi.fn(),
    });
    // 气泡对命令渲染 token.raw（保留 /），排队行必须一致，否则同一条消息前后两个样
    expect(container.querySelector("li")!.textContent).toContain(
      "/compact 收一下上下文",
    );
  });

  it("未解析的行首 /word 原样透传（不读 store，故扩展命令不动）", async () => {
    await renderBar({
      items: [{ id: "q1", text: "/plan 做一遍", ts: 1 }],
      onSteer: vi.fn(),
      onRemove: vi.fn(),
    });
    expect(container.querySelector("li")!.textContent).toContain(
      "/plan 做一遍",
    );
  });

  it("句中的 /skill: 原样保留（只处理行首那一处）", async () => {
    await renderBar({
      items: [{ id: "q1", text: "帮我看看 /skill:alpha 这段", ts: 1 }],
      onSteer: vi.fn(),
      onRemove: vi.fn(),
    });
    expect(container.querySelector("li")!.textContent).toContain(
      "帮我看看 /skill:alpha 这段",
    );
  });

  it("行首引用后面没有正文时也能正确显示", async () => {
    await renderBar({
      items: [{ id: "q1", text: "/skill:alpha", ts: 1 }],
      onSteer: vi.fn(),
      onRemove: vi.fn(),
    });
    const row = container.querySelector("li")!;
    expect(row.textContent).toContain("alpha");
    expect(row.textContent).not.toContain("/skill:");
  });

  it("title 仍是完整原文，悬停能看到写入格式", async () => {
    const raw = "/skill:alpha 帮我把间距统一一下";
    await renderBar({
      items: [{ id: "q1", text: raw, ts: 1 }],
      onSteer: vi.fn(),
      onRemove: vi.fn(),
    });
    expect(container.querySelector("[title]")?.getAttribute("title")).toBe(raw);
  });

  it("renders attachment chips with filenames", async () => {
    const withAttachments: QueuedInput[] = [
      {
        id: "q3",
        text: "带附件",
        ts: 3,
        images: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: "QUJD",
            },
          },
        ],
        files: [
          {
            type: "file_attachment",
            filename: "report.pdf",
            relativePath: "/tmp/report.pdf",
            size: 1024,
            mimeType: "application/pdf",
            inlineDataBase64: "QUJD",
          },
        ],
      },
    ];
    await renderBar({
      items: withAttachments,
      onSteer: vi.fn(),
      onRemove: vi.fn(),
    });
    const row = container.querySelector("li")!;
    expect(row.textContent).toContain("report.pdf");
  });
});

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

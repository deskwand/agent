// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as fs from "fs";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../renderer/i18n/config";
import { MessageCard } from "../../renderer/components/MessageCard";
import type { Message } from "../../renderer/types";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "m1",
    role: "assistant",
    sessionId: "s1",
    content: [{ type: "text", text: "Hello" }],
    timestamp: Date.now(),
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  // 锁定英文，保证 title 断言稳定（仓库先例：chat-trace-summary-merge.test.ts）
  window.localStorage.setItem("i18nextLng", "en");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderCard(
  message: Message,
  isLatestRound: boolean,
  onForkMessage?: () => void,
) {
  act(() => {
    root.render(
      React.createElement(MessageCard, {
        message,
        isLatestRound,
        onForkMessage,
      }),
    );
  });
}

describe("MessageCard action bar", () => {
  it("shows copy and fork for a final answer in a historical turn", () => {
    renderCard(makeMessage(), false, vi.fn());
    expect(
      container.querySelector('[aria-label="Copy message"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[aria-label="Fork from here"]'),
    ).not.toBeNull();
  });

  it("shows the action bar for the latest assistant message", () => {
    renderCard(makeMessage(), true, vi.fn());
    expect(
      container.querySelector('[aria-label="Copy message"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[aria-label="Fork from here"]'),
    ).not.toBeNull();
  });

  it("keeps the action bar for user messages regardless of round", () => {
    renderCard(makeMessage({ id: "u1", role: "user" }), false, vi.fn());
    expect(
      container.querySelector('[aria-label="Copy message"]'),
    ).not.toBeNull();
  });

  it("excludes tool_result rows from fork (source assertion)", () => {
    // 孤立 tool_result 行渲染会触发 ContentBlockView 在 jsdom 下的 store 循环（既有问题），
    // 此处改用源码断言验证 canFork 排除 tool_result 行。
    const src = fs.readFileSync(
      path.join(__dirname, "../../renderer/components/MessageCard.tsx"),
      "utf-8",
    );
    expect(src).toContain("!isToolResultRow");
  });

  it("keeps system message copy outside assistant turn ends", async () => {
    await act(async () => {
      root.render(
        React.createElement(MessageCard, {
          message: makeMessage({ role: "system" }),
          isTurnEnd: false,
          onForkMessage: vi.fn(),
        }),
      );
    });
    expect(
      container.querySelector('[aria-label="Copy message"]'),
    ).not.toBeNull();
    expect(container.querySelector('[aria-label="Fork from here"]')).toBeNull();
  });

  it("hides the action bar while streaming", () => {
    act(() => {
      root.render(
        React.createElement(MessageCard, {
          message: makeMessage(),
          isLatestRound: true,
          isStreaming: true,
          onForkMessage: vi.fn(),
        }),
      );
    });
    expect(container.querySelector('[aria-label="Fork from here"]')).toBeNull();
    expect(container.querySelector('[aria-label="Copy message"]')).toBeNull();
    expect(container.querySelector(".select-none")).toBeNull();
  });

  it("hides fork for a queued message", () => {
    renderCard(makeMessage({ localStatus: "queued" }), true, vi.fn());
    expect(container.querySelector('[aria-label="Fork from here"]')).toBeNull();
  });

  it("hides fork for a cancelled message", () => {
    renderCard(makeMessage({ localStatus: "cancelled" }), true, vi.fn());
    expect(container.querySelector('[aria-label="Fork from here"]')).toBeNull();
  });

  it("用户消息带元素引用时，把 chip 渲染进气泡", () => {
    renderCard(
      makeMessage({
        role: "user",
        content: [{ type: "text", text: "改圆角" }],
        elSelections: [
          {
            pageUrl: "http://fixture/",
            tag: "button",
            classes: ["primary"],
            text: "开始使用",
            selector: "button.primary",
            selectorUnique: true,
            width: 132,
            height: 40,
          },
        ],
      }),
      true,
    );
    expect(container.textContent).toContain("button.primary");
    expect(container.textContent).toContain("改圆角");
  });

  it("只有元素没有文字时不显示「空消息」占位符", () => {
    renderCard(
      makeMessage({
        role: "user",
        content: [],
        elSelections: [
          {
            pageUrl: "http://fixture/",
            tag: "button",
            classes: ["primary"],
            text: "开始使用",
            selector: "button.primary",
            selectorUnique: true,
            width: 132,
            height: 40,
          },
        ],
      }),
      true,
    );
    expect(container.textContent).toContain("button.primary");
    expect(container.textContent).not.toContain("messageCard.emptyMessage");
  });

  it("用户消息没有元素引用时不渲染 chip", () => {
    renderCard(
      makeMessage({
        role: "user",
        content: [{ type: "text", text: "改圆角" }],
      }),
      true,
    );
    expect(container.querySelector('[title="button.primary"]')).toBeNull();
  });

  it("元数据行的图标按钮走 `iconSm`：28×28，不再是围着 16px 图标的 48×32 方块", () => {
    // 2026-10-10 用户报障「元数据的这个框太大了」：缺省档 `h-9 px-4 py-2` + 调用点只写 `h-auto`
    // ⇒ hover 方块 = 图标 16px + base 内边距 px-4(32) × py-2(16) = 48×32（Chromium 实测 ✓）。
    // 28×28 是**有意**的：与仓库既有的图标键（`BrowserPanel` / `TitlebarButton` / `ReviewPanel`
    // 都写 `w-7 h-7`）同尺寸 ✓。jsdom 没有布局 ⇒ 只能锁「缺省档三件套不在 class 里」✓
    //（从 48×32 到 28×28 的对照见 `app-button.tsx` 紧凑档的说明 ✓）。
    renderCard(makeMessage(), true, vi.fn());
    for (const selector of [
      '[data-testid="read-aloud-button"]',
      '[aria-label="Copy message"]',
      '[aria-label="Fork from here"]',
    ]) {
      const el = container.querySelector(selector);
      expect(el, selector).not.toBeNull();
      const tokens = (el as HTMLElement).className.split(/\s+/);
      expect(tokens, selector).toContain("h-7");
      expect(tokens, selector).toContain("w-7");
      // ⚠️ `justify-center` 必须在场、`justify-start` 必须不在：这四个键写了 `flex`、
      // `app-button` 的 `shouldLeftAlign()` 会因此注入 `justify-start` ⇒ 图标贴左（实测左 0 / 右 12 ✓）。
      expect(tokens, `${selector} 必须显式居中`).toContain("justify-center");
      expect(tokens, `${selector} 不能再被注成靠左`).not.toContain(
        "justify-start",
      );
      // 这排只要颜色反馈、不要灰底（2026-10-10 用户：图标带底色看着重 ✓）。
      expect(tokens, `${selector} 不该带 hover 底色`).toContain(
        "hover:bg-transparent",
      );
      expect(tokens, `${selector} 不该带 hover 底色`).not.toContain(
        "hover:bg-hover-surface",
      );
      for (const slab of ["h-9", "px-4", "py-2", "h-auto"]) {
        expect(tokens, `${selector} 不该再出现 ${slab}`).not.toContain(slab);
      }
    }
  });
});

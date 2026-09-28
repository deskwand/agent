// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AskUserCard } from "../../renderer/components/message/AskUserCard";
import { useAppStore } from "../../renderer/store";

const { submitAskUserMock } = vi.hoisted(() => ({
  submitAskUserMock: vi.fn(),
}));

vi.mock("../../renderer/hooks/useIPC", () => ({
  useIPC: () => ({ submitAskUser: submitAskUserMock }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import type { AskUserQuestion } from "../../shared/ask-user";

const question: AskUserQuestion = {
  question: "数据库用哪个？",
  header: "技术栈",
  type: "choice",
  options: [
    { label: "PostgreSQL", description: "功能全面" },
    { label: "SQLite", description: "轻量" },
  ],
};

const block = {
  type: "tool_use",
  id: "t-1",
  name: "ask_user",
  input: { questions: [question] },
} as const;

function renderCard(ui: React.ReactElement): {
  root: Root;
  container: HTMLElement;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  return { root, container };
}

const CARD = (props?: { allBlocks?: unknown[]; allMessages?: unknown[] }) => (
  <AskUserCard
    block={block as never}
    allBlocks={(props?.allBlocks ?? []) as never}
    allMessages={(props?.allMessages ?? []) as never}
  />
);

/** 受控 input：必须走原生 setter + input 事件，React 才认这次变更。 */
function typeInto(input: Element, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  return Array.from(container.querySelectorAll("button")).find(
    (el) => el.textContent === text,
  ) as HTMLButtonElement;
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  submitAskUserMock.mockClear();
  useAppStore.setState({ pendingAskUsers: {} });
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("AskUserCard", () => {
  it("pending 态渲染问题与选项，选中后可提交", () => {
    useAppStore.setState({
      pendingAskUsers: {
        "t-1": { sessionId: "s-1", toolCallId: "t-1", questions: [question] },
      },
    });
    const { container } = renderCard(CARD());
    expect(container.textContent).toContain("数据库用哪个？");
    act(() => {
      (
        Array.from(
          container.querySelectorAll("button, [role=radio], label"),
        ).find((el) => el.textContent?.includes("PostgreSQL")) as HTMLElement
      )?.click();
    });
    act(() => {
      buttonByText(container, "tool.askUser.submit")?.click();
    });
    expect(submitAskUserMock).toHaveBeenCalledWith("s-1", "t-1", {
      "0": "PostgreSQL",
    });
  });

  it("choice 未选且未开其他时提交不可用", () => {
    useAppStore.setState({
      pendingAskUsers: {
        "t-1": { sessionId: "s-1", toolCallId: "t-1", questions: [question] },
      },
    });
    const { container } = renderCard(CARD());
    const submit = buttonByText(container, "tool.askUser.submit");
    expect(submit.disabled).toBe(true);
  });

  it("yesno 回传规范值 Yes/No", () => {
    const yesno = {
      type: "tool_use",
      id: "t-1",
      name: "ask_user",
      input: {
        questions: [{ question: "部署吗？", header: "部署", type: "yesno" }],
      },
    } as never;
    useAppStore.setState({
      pendingAskUsers: {
        "t-1": {
          sessionId: "s-1",
          toolCallId: "t-1",
          questions: [{ question: "部署吗？", header: "部署", type: "yesno" }],
        },
      },
    });
    const { container } = renderCard(
      <AskUserCard
        block={yesno}
        allBlocks={[] as never}
        allMessages={[] as never}
      />,
    );
    act(() => {
      buttonByText(container, "tool.askUser.no")?.click();
    });
    act(() => {
      buttonByText(container, "tool.askUser.submit")?.click();
    });
    expect(submitAskUserMock).toHaveBeenCalledWith("s-1", "t-1", { "0": "No" });
  });

  it("text 题输入后回传输入文本", () => {
    const text = {
      type: "tool_use",
      id: "t-1",
      name: "ask_user",
      input: {
        questions: [{ question: "叫什么？", header: "命名", type: "text" }],
      },
    } as never;
    useAppStore.setState({
      pendingAskUsers: {
        "t-1": {
          sessionId: "s-1",
          toolCallId: "t-1",
          questions: [{ question: "叫什么？", header: "命名", type: "text" }],
        },
      },
    });
    const { container } = renderCard(
      <AskUserCard
        block={text}
        allBlocks={[] as never}
        allMessages={[] as never}
      />,
    );
    const input = container.querySelector("input");
    expect(input).toBeTruthy();
    act(() => {
      if (input) typeInto(input, "deskwand");
    });
    act(() => {
      buttonByText(container, "tool.askUser.submit")?.click();
    });
    expect(submitAskUserMock).toHaveBeenCalledWith("s-1", "t-1", {
      "0": "deskwand",
    });
  });

  it("multiSelect「其他…」输入并入回传数组", () => {
    const multi = {
      type: "tool_use",
      id: "t-1",
      name: "ask_user",
      input: {
        questions: [
          {
            question: "用哪些库？",
            header: "依赖",
            type: "multiSelect",
            options: [{ label: "zod" }, { label: "zundo" }],
          },
        ],
      },
    } as never;
    useAppStore.setState({
      pendingAskUsers: {
        "t-1": {
          sessionId: "s-1",
          toolCallId: "t-1",
          questions: [
            {
              question: "用哪些库？",
              header: "依赖",
              type: "multiSelect",
              options: [{ label: "zod" }, { label: "zundo" }],
            },
          ],
        },
      },
    });
    const { container } = renderCard(
      <AskUserCard
        block={multi}
        allBlocks={[] as never}
        allMessages={[] as never}
      />,
    );
    act(() => {
      (
        Array.from(container.querySelectorAll("button")).find((el) =>
          el.textContent?.includes("zod"),
        ) as HTMLButtonElement
      )?.click();
    });
    act(() => {
      buttonByText(container, "tool.askUser.other")?.click();
    });
    const input = container.querySelector("input");
    expect(input).toBeTruthy();
    act(() => {
      if (input) typeInto(input, "zustand");
    });
    act(() => {
      buttonByText(container, "tool.askUser.submit")?.click();
    });
    expect(submitAskUserMock).toHaveBeenCalledWith("s-1", "t-1", {
      "0": ["zod", "zustand"],
    });
  });

  it("跳过 = 全部题 __SKIPPED__", () => {
    useAppStore.setState({
      pendingAskUsers: {
        "t-1": { sessionId: "s-1", toolCallId: "t-1", questions: [question] },
      },
    });
    const { container } = renderCard(CARD());
    act(() => {
      buttonByText(container, "tool.askUser.skip")?.click();
    });
    expect(submitAskUserMock).toHaveBeenCalledWith("s-1", "t-1", {
      "0": "__SKIPPED__",
    });
  });

  it("有 tool_result 时只读回显答案（用 findToolResult 查找）", () => {
    const { container } = renderCard(
      CARD({
        allBlocks: [
          {
            type: "tool_result",
            toolUseId: "t-1",
            content: '{"answers":{"0":"SQLite"}}',
          },
        ],
      }),
    );
    expect(container.textContent).toContain("tool.askUser.answered");
    expect(container.textContent).toContain("SQLite");
    expect(container.textContent).not.toContain("tool.askUser.submit");
  });

  it("askUserStatus=cancelled 显示已取消", () => {
    const { container } = renderCard(
      CARD({
        allBlocks: [
          {
            type: "tool_result",
            toolUseId: "t-1",
            content: "cancelled",
            askUserStatus: "cancelled",
          },
        ],
      }),
    );
    expect(container.textContent).toContain("tool.askUser.cancelled");
  });

  it("无结果且非 pending 显示会话已中断", () => {
    const { container } = renderCard(CARD());
    expect(container.textContent).toContain("tool.askUser.interrupted");
  });

  it("全题 __SKIPPED__ 时头部显示已跳过而非已提交", () => {
    const { container } = renderCard(
      CARD({
        allBlocks: [
          {
            type: "tool_result",
            toolUseId: "t-1",
            content: '{"answers":{"0":"__SKIPPED__"}}',
          },
        ],
      }),
    );
    expect(container.textContent).toContain("tool.askUser.skippedItem");
    expect(container.textContent).not.toContain("tool.askUser.answered");
  });

  it("提交后锁定：再次点击不再发送第二次响应", () => {
    useAppStore.setState({
      pendingAskUsers: {
        "t-1": { sessionId: "s-1", toolCallId: "t-1", questions: [question] },
      },
    });
    const { container } = renderCard(CARD());
    const clickSubmit = () => {
      act(() => {
        (
          Array.from(container.querySelectorAll("button")).find(
            (el) => el.textContent === "tool.askUser.submit",
          ) as HTMLButtonElement
        )?.click();
      });
    };
    act(() => {
      (
        Array.from(
          container.querySelectorAll("button, [role=radio], label"),
        ).find((el) => el.textContent?.includes("PostgreSQL")) as HTMLElement
      )?.click();
    });
    clickSubmit();
    expect(submitAskUserMock).toHaveBeenCalledTimes(1);
    clickSubmit();
    expect(submitAskUserMock).toHaveBeenCalledTimes(1);
  });
});

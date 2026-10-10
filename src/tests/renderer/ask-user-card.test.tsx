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

const { micMock } = vi.hoisted(() => ({ micMock: { start: vi.fn() } }));
vi.mock("../../renderer/utils/voice/mic-capture", () => ({
  MicError: class MicError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
  startMicCapture: micMock.start,
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

let voice: Record<string, ReturnType<typeof vi.fn>>;
let listeners: Array<(event: unknown) => void>;

/** 派发给所有订阅者（见字段组件测试的同名注释）。 */
const emit = (event: unknown) => {
  for (const cb of [...listeners]) cb(event);
};

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  submitAskUserMock.mockClear();
  listeners = [];
  voice = {
    start: vi.fn(async () => ({ ok: true, sessionId: "s1" })),
    pushAudio: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    polish: vi.fn(async () => ({ ok: true, text: "整理稿" })),
    install: vi.fn(),
    removeInstall: vi.fn(),
    getInstallState: vi.fn(async () => ({
      phase: "ready",
      percent: 100,
      installed: true,
    })),
    onEvent: vi.fn((cb: (event: unknown) => void) => {
      listeners.push(cb);
      return () => {
        listeners = listeners.filter((fn) => fn !== cb);
      };
    }),
  };
  (window as unknown as { electronAPI: unknown }).electronAPI = { voice };
  micMock.start.mockImplementation(async () => ({ stop: vi.fn() }) as never);
  // appConfig 必须是「已启用」，理由见字段组件测试的同名注释（否则就绪门过不去）。
  useAppStore.setState({
    pendingAskUsers: {},
    appConfig: {
      voiceEngine: { enabled: true, shortcut: "disabled", autoPolish: true },
    } as never,
    voiceInputOwner: null,
    voiceModeOpen: false,
  });
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

  const twoText = {
    type: "tool_use",
    id: "t-1",
    name: "ask_user",
    input: {
      questions: [
        { question: "项目叫什么？", header: "命名", type: "text" },
        { question: "跑在哪个目录？", header: "目录", type: "text" },
      ],
    },
  } as const;

  const TWO_TEXT_QUESTIONS = [
    { question: "项目叫什么？", header: "命名", type: "text" },
    { question: "跑在哪个目录？", header: "目录", type: "text" },
  ] as never;

  const pending = () =>
    useAppStore.setState({
      pendingAskUsers: {
        "t-1": {
          sessionId: "s-1",
          toolCallId: "t-1",
          questions: TWO_TEXT_QUESTIONS,
        },
      },
    });

  const micButtons = (el: HTMLElement) =>
    [...el.querySelectorAll("button")].filter((b) =>
      b.getAttribute("aria-label")?.startsWith("chat.voice"),
    ) as HTMLButtonElement[];

  const startRecording = (el: HTMLElement) =>
    act(async () => {
      el.click();
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });

  const renderTwoText = () =>
    renderCard(
      <AskUserCard
        block={twoText as never}
        allBlocks={[] as never}
        allMessages={[] as never}
      />,
    );

  it("选择题卡：展开「其他…」前没有麦克风，展开后有一个", () => {
    useAppStore.setState({
      pendingAskUsers: {
        "t-1": { sessionId: "s-1", toolCallId: "t-1", questions: [question] },
      },
    });
    const { container } = renderCard(CARD());
    expect(micButtons(container)).toHaveLength(0);

    act(() => {
      buttonByText(container, "tool.askUser.other")?.click();
    });

    expect(micButtons(container)).toHaveLength(1);
  });

  it("两题都是 text：两个框各有一个麦克风", () => {
    pending();
    const { container } = renderTwoText();

    expect(micButtons(container)).toHaveLength(2);
  });

  it("点第二个框的麦克风：转写只写第二个框", async () => {
    pending();
    const { container } = renderTwoText();
    const [, secondMic] = micButtons(container);

    await startRecording(secondMic);
    await act(async () =>
      emit({ type: "partial", sessionId: "s1", text: "在 D 盘" }),
    );

    const inputs = [
      ...container.querySelectorAll("input"),
    ] as HTMLInputElement[];
    expect(inputs[1].value).toBe("在 D 盘");
    expect(inputs[0].value).toBe("");
  });

  it("本卡录音中「提交」不可用", async () => {
    pending();
    const { container } = renderTwoText();
    act(() => {
      const inputs = [
        ...container.querySelectorAll("input"),
      ] as HTMLInputElement[];
      typeInto(inputs[0], "deskwand");
      typeInto(inputs[1], "D:/code");
    });
    expect(buttonByText(container, "tool.askUser.submit").disabled).toBe(false);

    await startRecording(micButtons(container)[0]);

    expect(buttonByText(container, "tool.askUser.submit").disabled).toBe(true);
  });

  it("字段 A 在录时，同卡字段 B 的麦克风禁用", async () => {
    pending();
    const { container } = renderTwoText();

    await startRecording(micButtons(container)[0]);

    const [a, b] = micButtons(container);
    // 在录的那一个仍可点：点它就是停
    expect(a.disabled).toBe(false);
    expect(a.getAttribute("aria-label")).toBe("chat.voiceStop");
    expect(b.disabled).toBe(true);
    expect(b.getAttribute("aria-label")).toBe("chat.voiceBusyElsewhere");
  });

  it("终态没有麦克风", () => {
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
    expect(micButtons(container)).toHaveLength(0);
  });
});

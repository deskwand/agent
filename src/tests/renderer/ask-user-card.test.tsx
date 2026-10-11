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
        Array.from(container.querySelectorAll("button, label")).find((el) =>
          el.textContent?.includes("zod"),
        ) as HTMLElement
      )?.click();
    });
    act(() => {
      buttonByText(container, "tool.askUser.other")?.click();
    });
    const input = container.querySelector('input[type="text"]');
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

  // —— Task 6b：选择控件走可访问原语 ——
  // choice = ui/radio-group 的 RadioGroup（radiogroup 的可访问名是题面，方向键移动并选中）；
  // multiSelect = 原生 input[type=checkbox]（ui/checkbox.tsx 由另一任务提供，本轮不越界新建）。
  // 契约不变：choice 回传 string、multiSelect 回传 string[]（按选项顺序）。

  const seedPending = (questions: unknown[]) =>
    useAppStore.setState({
      pendingAskUsers: {
        "t-1": { sessionId: "s-1", toolCallId: "t-1", questions },
      } as never,
    });

  const rowByText = (container: HTMLElement, text: string): HTMLElement =>
    Array.from(container.querySelectorAll("label")).find((el) =>
      el.textContent?.includes(text),
    ) as HTMLElement;

  const pressArrow = async (el: HTMLElement, key: string) => {
    // Radix 的 roving focus 把移动放在 setTimeout(0) 里（不是同步 focus），不冲掉这个
    // 宏任务焦点不会动；反过来，"方向键=选中"依赖的 document keydown 标记在分派期间就已置位。
    await act(async () => {
      el.focus();
      el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  const releaseArrow = (key: string) =>
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keyup", { key, bubbles: true }),
      );
    });

  it("choice 题用 radiogroup：可访问名是题面，ArrowRight 移动焦点并选中，提交值仍是字符串", async () => {
    seedPending([question]);
    const { container } = renderCard(CARD());

    const group = container.querySelector('[role="radiogroup"]');
    expect(group).not.toBeNull();
    expect(group?.getAttribute("aria-label")).toBe("数据库用哪个？");

    const radios = [
      ...container.querySelectorAll<HTMLElement>('[role="radio"]'),
    ];
    expect(radios).toHaveLength(2);
    expect(
      radios.every((el) => el.getAttribute("aria-checked") === "false"),
    ).toBe(true);
    // 选项的 value 就是原选项 label（onValueChange 收到的也是它）
    expect(radios.map((el) => el.getAttribute("value"))).toEqual([
      "PostgreSQL",
      "SQLite",
    ]);
    // 控件与文案同一行：label[for] → radio.id
    expect(radios[0].id).not.toBe("");
    expect(
      container.querySelector(`label[for="${radios[0].id}"]`),
    ).not.toBeNull();
    // 「其他…」是普通按钮且在组外：radiogroup 只应拥有 radio
    const other = buttonByText(container, "tool.askUser.other");
    expect(other).toBeTruthy();
    expect(group?.contains(other)).toBe(false);

    await pressArrow(radios[0], "ArrowRight");

    expect(document.activeElement).toBe(radios[1]);
    expect(radios[1].getAttribute("aria-checked")).toBe("true");
    // 单选：前一个必须被取消（radiogroup 里不可能有两个 checked）
    expect(radios[0].getAttribute("aria-checked")).toBe("false");
    releaseArrow("ArrowRight");

    act(() => {
      buttonByText(container, "tool.askUser.submit")?.click();
    });
    expect(submitAskUserMock).toHaveBeenCalledWith("s-1", "t-1", {
      "0": "SQLite",
    });
    // 形状不变：choice 回传 string，不是数组
    const payload = submitAskUserMock.mock.calls[0]?.[2] as Record<
      string,
      unknown
    >;
    expect(typeof payload["0"]).toBe("string");
  });

  it("choice 题 ArrowDown 同样移动并选中", async () => {
    seedPending([question]);
    const { container } = renderCard(CARD());
    const radios = [
      ...container.querySelectorAll<HTMLElement>('[role="radio"]'),
    ];

    await pressArrow(radios[0], "ArrowDown");

    expect(document.activeElement).toBe(radios[1]);
    expect(radios[1].getAttribute("aria-checked")).toBe("true");
    releaseArrow("ArrowDown");
  });

  it("choice 题点选项行也选中（label 与控件同属一行）", () => {
    seedPending([question]);
    const { container } = renderCard(CARD());

    act(() => {
      rowByText(container, "SQLite").click();
    });

    expect(
      container
        .querySelectorAll('[role="radio"]')[1]
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(container.textContent).toContain("轻量");
  });

  it("multiSelect 勾两个选项：提交值是字符串数组（顺序按选项顺序）", () => {
    const multiQuestions = [
      {
        question: "用哪些库？",
        header: "依赖",
        type: "multiSelect",
        options: [{ label: "zod" }, { label: "zundo" }],
      },
    ];
    const multiBlock = {
      type: "tool_use",
      id: "t-1",
      name: "ask_user",
      input: { questions: multiQuestions },
    } as never;
    seedPending(multiQuestions);
    const { container } = renderCard(
      <AskUserCard
        block={multiBlock}
        allBlocks={[] as never}
        allMessages={[] as never}
      />,
    );

    const boxes = [
      ...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ];
    expect(boxes).toHaveLength(2);
    // 仍是原生 checkbox，不是另造一套 role=checkbox 的按钮
    expect(container.querySelector('[role="checkbox"]')).toBeNull();

    // 倒着勾（先 zundo 再 zod）：回传顺序按选项顺序，不是点击顺序
    act(() => {
      rowByText(container, "zundo").click();
    });
    act(() => {
      rowByText(container, "zod").click();
    });
    expect(boxes.map((box) => box.checked)).toEqual([true, true]);
    act(() => {
      buttonByText(container, "tool.askUser.submit")?.click();
    });

    expect(submitAskUserMock).toHaveBeenCalledWith("s-1", "t-1", {
      "0": ["zod", "zundo"],
    });
    // 形状不变：multiSelect 回传 string[]
    const payload = submitAskUserMock.mock.calls[0]?.[2] as Record<
      string,
      unknown
    >;
    expect(Array.isArray(payload["0"])).toBe(true);
  });

  it("answered 只读卡没有任何可交互选择控件", () => {
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
    expect(container.querySelector('[role="radiogroup"]')).toBeNull();
    expect(container.querySelector('[role="radio"]')).toBeNull();
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(buttonByText(container, "tool.askUser.submit")).toBeUndefined();
  });

  it("interrupted 卡也没有可交互选择控件", () => {
    const { container } = renderCard(CARD());

    expect(container.textContent).toContain("tool.askUser.interrupted");
    expect(container.querySelector('[role="radiogroup"]')).toBeNull();
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
  });
});

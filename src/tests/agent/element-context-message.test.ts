import { describe, expect, it, vi } from "vitest";
import {
  appendElementContext,
  collectSyntheticContextText,
} from "../../main/agent/element-context-message";

describe("collectSyntheticContextText", () => {
  it("取出合成块并按顺序拼接", () => {
    const out = collectSyntheticContextText([
      {
        type: "text",
        text: "<selected-element>A</selected-element>",
        synthetic: true,
      },
      { type: "text", text: "圆角太大" },
      {
        type: "text",
        text: "<selected-element>B</selected-element>",
        synthetic: true,
      },
    ]);
    expect(out).toBe(
      "<selected-element>A</selected-element>\n\n<selected-element>B</selected-element>",
    );
  });

  it("用户自己的文本块不算合成块", () => {
    expect(collectSyntheticContextText([{ type: "text", text: "你好" }])).toBe(
      "",
    );
  });

  it("没有合成块时返回空串", () => {
    expect(collectSyntheticContextText([])).toBe("");
  });

  it("非数组输入返回空串（不抛异常）", () => {
    expect(collectSyntheticContextText(undefined)).toBe("");
    expect(collectSyntheticContextText("oops")).toBe("");
  });

  it("忽略空文本的合成块", () => {
    expect(
      collectSyntheticContextText([
        { type: "text", text: "   ", synthetic: true },
      ]),
    ).toBe("");
  });
});

describe("appendElementContext", () => {
  it("独立隐藏消息，不触发回合，不排入 nextTurn", async () => {
    const sendCustomMessage = vi.fn(async () => {});
    await appendElementContext(
      { isStreaming: false, sendCustomMessage },
      "<selected-element/>",
    );
    expect(sendCustomMessage).toHaveBeenCalledExactlyOnceWith(
      {
        customType: "browser_element_selection",
        content: "<selected-element/>",
        display: false,
      },
      { triggerTurn: false },
    );
  });

  it("把引用写进 details（供气泡回显，不进模型）", async () => {
    const sendCustomMessage = vi.fn(async () => {});
    const selections = [
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
    ];
    await appendElementContext(
      { isStreaming: false, sendCustomMessage },
      "<selected-element/>",
      selections,
    );
    expect(sendCustomMessage).toHaveBeenCalledExactlyOnceWith(
      {
        customType: "browser_element_selection",
        content: "<selected-element/>",
        display: false,
        details: { selections },
      },
      { triggerTurn: false },
    );
  });

  it("没有引用时不写 details 键", async () => {
    // 带上参数类型：否则 mock.calls 会被推成零元组，取不出去参
    const sendCustomMessage = vi.fn(
      async (_message: unknown, _options?: unknown) => {},
    );
    await appendElementContext(
      { isStreaming: false, sendCustomMessage },
      "<selected-element/>",
    );
    const message = sendCustomMessage.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect("details" in message).toBe(false);
  });

  it("没有上下文时不写消息", async () => {
    const sendCustomMessage = vi.fn(async () => {});
    await appendElementContext(
      { isStreaming: false, sendCustomMessage },
      "   ",
    );
    expect(sendCustomMessage).not.toHaveBeenCalled();
  });

  it("运行中的 SDK 不得把附件延迟到错误回合", async () => {
    const sendCustomMessage = vi.fn(async () => {});
    await expect(
      appendElementContext(
        { isStreaming: true, sendCustomMessage },
        "<selected-element/>",
      ),
    ).rejects.toThrow("idle SDK session");
    expect(sendCustomMessage).not.toHaveBeenCalled();
  });
});

import { describe, expect, it } from "vitest";
import {
  findLatestUserMessage,
  resolveReadState,
  type ReadReceiptState,
} from "../../renderer/utils/message-read";
import type { Message } from "../../renderer/types";

function msg(overrides: Partial<Message> = {}): Message {
  return {
    id: "m1",
    sessionId: "s1",
    role: "user",
    content: [{ type: "text", text: "hi" }],
    timestamp: 1,
    ...overrides,
  };
}

describe("findLatestUserMessage", () => {
  it("takes the last user message, ignoring assistant entries after it", () => {
    const messages = [
      msg({ id: "u1", turnId: "turn-1" }),
      msg({ id: "a1", role: "assistant", turnId: "turn-1" }),
      msg({ id: "u2", turnId: "turn-2" }),
      msg({ id: "a2", role: "assistant", turnId: "turn-2" }),
    ];
    expect(findLatestUserMessage(messages)?.id).toBe("u2");
  });

  it("returns null when there is no user message", () => {
    expect(
      findLatestUserMessage([msg({ role: "assistant", turnId: "t" })]),
    ).toBe(null);
    expect(findLatestUserMessage([])).toBe(null);
  });

  it("never falls back to an older turn when the newest message has no turnId", () => {
    // 回退会把收据盖到历史气泡上：没有 turnId 就是不出环。
    const messages = [
      msg({ id: "u1", turnId: "turn-1" }),
      msg({ id: "u2", turnId: undefined }),
    ];
    const latest = findLatestUserMessage(messages);
    expect(latest?.id).toBe("u2");
    expect(
      resolveReadState({
        turnId: latest?.turnId,
        localStatus: latest?.localStatus,
        blocks: [{ type: "text", text: "上一轮的回复" }],
        isAwaiting: true,
      }),
    ).toBe(null);
  });
});

describe("resolveReadState", () => {
  // 最新一轮、还没回复、会话在跑
  const waiting = {
    turnId: "turn-1",
    partialTurnId: "turn-1",
    isAwaiting: true,
  };

  it("is unread while the model has not spoken", () => {
    expect(resolveReadState(waiting)).toBe("unread");
  });

  it("is read on the first streamed text token", () => {
    expect(resolveReadState({ ...waiting, partialMessage: "是" })).toBe("read");
  });

  it("is read on the first streamed thinking token", () => {
    // Review Focus #2：思考先行也必须算已读
    expect(resolveReadState({ ...waiting, partialThinking: "先看" })).toBe(
      "read",
    );
  });

  it("ignores a stale partial from another turn", () => {
    // `partialByTurn` 会留着别的轮次的残段；不比对 turnId 就会把新气泡点成绿的
    expect(
      resolveReadState({
        ...waiting,
        partialTurnId: "turn-0",
        partialMessage: "上一轮的正文",
        partialThinking: "上一轮的思考",
      }),
    ).toBe("unread");
  });

  it("counts a tool-only turn as read", () => {
    // Review Focus #5：整轮没有正文，只有工具调用
    expect(
      resolveReadState({
        ...waiting,
        blocks: [{ type: "tool_use", id: "t1", name: "read", input: {} }],
      }),
    ).toBe("read");
  });

  it("stays read when only persisted blocks are left", () => {
    // Review Focus #3：切走再切回，partial 已被清空，会话也不再 running
    expect(
      resolveReadState({
        turnId: "turn-1",
        isAwaiting: false,
        blocks: [{ type: "text", text: "hello" }],
      }),
    ).toBe("read");
  });

  it("never marks queued or cancelled messages", () => {
    expect(resolveReadState({ ...waiting, localStatus: "queued" })).toBe(null);
    expect(resolveReadState({ ...waiting, localStatus: "cancelled" })).toBe(
      null,
    );
  });

  it("shows nothing for a failed latest turn", () => {
    // Review Focus #4：出错 / 被中断 —— 没回复也不在等，不留假未读
    expect(resolveReadState({ ...waiting, isAwaiting: false })).toBe(null);
  });

  it("shows nothing without a turnId", () => {
    expect(resolveReadState({ ...waiting, turnId: undefined })).toBe(null);
  });

  it("narrows to the declared union", () => {
    const state: ReadReceiptState | null = resolveReadState(waiting);
    expect(["read", "unread", null]).toContain(state);
  });
});

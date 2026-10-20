import { describe, expect, it } from "vitest";
import { emotionFromDone } from "../../renderer/utils/voice/voice-emotion";

describe("从 done 事件取情感", () => {
  it("合法信号原样返回", () => {
    expect(
      emotionFromDone({
        type: "done",
        sessionId: "s",
        text: "x",
        discarded: false,
        emotion: { label: "sad", confidence: 0.9 },
      }),
    ).toEqual({ label: "sad", confidence: 0.9 });
  });

  it("缺字段或脏数据返回 undefined", () => {
    expect(
      emotionFromDone({
        type: "done",
        sessionId: "s",
        text: "x",
        discarded: false,
      }),
    ).toBeUndefined();
    expect(
      emotionFromDone({ type: "partial", sessionId: "s", text: "x" }),
    ).toBeUndefined();
  });
});

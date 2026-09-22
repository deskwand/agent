import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveRetryLifecyclePayload } from "../../main/agent/agent-runner";

describe("retry lifecycle event normalization", () => {
  it("marks the row active on start and inactive on end", () => {
    expect(
      resolveRetryLifecyclePayload("s1", {
        type: "auto_retry_start",
        attempt: 3,
      }),
    ).toEqual({ sessionId: "s1", active: true, attempt: 3 });

    expect(
      resolveRetryLifecyclePayload("s1", {
        type: "auto_retry_end",
        attempt: 3,
      }),
    ).toEqual({ sessionId: "s1", active: false, attempt: 3 });
  });
});

// 弱守卫（源码级）：订阅回调是 start() 内的闭包，无法用单测驱动。
// 这两条只防"改坏了"而不证明行为，真正的端到端验证是人工断网演练。
describe("terminal error state machine (source guard)", () => {
  const source = readFileSync(
    join(process.cwd(), "src/main/agent/agent-runner.ts"),
    "utf8",
  );

  it("resets the terminal error once the turn recovers", () => {
    // 不回位的话，一次自愈的回合会在 agent_end 补落红色 Error 气泡并把 trace 标成 Request failed
    expect(source).toContain("terminalErrorText = undefined;");
  });

  it("only surfaces the error bubble when the SDK will not retry", () => {
    expect(source).toContain("if (event.willRetry) {");
    expect(source).toContain("if (!hasEmittedError && terminalErrorText) {");
  });
});

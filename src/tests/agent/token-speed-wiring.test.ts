import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// 弱守卫（源码级）：订阅回调是 run() 内的闭包，单测驱不动。
// 这条只防「接线被改掉」——行为由 token-speed.test.ts（计算）与人工演练覆盖。
// 仓库先例见 agent-runner-retry-events.test.ts 的 "source guard" 段。
describe("token speed event wiring (source guard)", () => {
  const source = readFileSync(
    join(process.cwd(), "src/main/agent/agent-runner.ts"),
    "utf8",
  );

  it("starts a new measurement on every assistant message", () => {
    expect(source).toContain("speed.startMessage();");
  });

  it("feeds streamed deltas into the reporter", () => {
    expect(source).toContain("speed.observeDelta(");
  });

  it("finishes with the real output token count", () => {
    expect(source).toContain("speed.finish(");
    expect(source).toContain('type: "stream.speed"');
  });
});

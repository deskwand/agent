/**
 * 历史结果查询的纯函数契约。
 *
 * 只覆盖「从已保存的会话条目里按精确 ID 取回结果」这一件事：
 *  - 不碰 live 记录、不碰执行资源、不发通知；
 *  - 最新匹配项即权威 —— 最新的不是合法终态（启动屏障/损坏）时返回 undefined，
 *    绝不回退到更早的成功快照（否则续跑后的旧答案会被当成这一次的结果）；
 *  - 只校验真正参与返回的字段。旧版本快照里我们不展示的时间戳即使形状怪异，
 *    也不能让一份正确的输出被丢弃。
 *
 * 运行期接入（GET_RESULT 的 live-miss 分支）由
 * pi-subagents-result-history-runtime.test.ts 用真实扩展工厂验证。
 */
import { expect, it } from "vitest";
import {
  findHistoricalResult,
  formatHistoricalResult,
} from "../../../node_modules/@tintinweb/pi-subagents/dist/result-history.js";

const row = (data: unknown, customType = "subagents:record") => ({
  type: "custom",
  customType,
  data,
});
const saved = { id: "agent-id", status: "completed", result: "ANSWER-A" };

it("reads old snapshots by exact ID only", () => {
  expect(findHistoricalResult([row(saved)], saved.id)?.result).toBe("ANSWER-A");
  expect(
    findHistoricalResult([row({ ...saved, alias: "turing" })], "turing"),
  ).toBeUndefined();
  expect(findHistoricalResult([row(saved)], "agent")).toBeUndefined();
});

it("does not backtrack after a newer start or damaged final result", () => {
  for (const latest of [
    row({ id: saved.id, status: "running" }, "subagents:result-state"),
    row({ ...saved, result: 42 }),
    row({ ...saved, status: "queued" }),
  ]) {
    expect(
      findHistoricalResult([row(saved), latest], saved.id),
    ).toBeUndefined();
  }
});

it("returns the latest final snapshot", () => {
  expect(
    findHistoricalResult(
      [row(saved), row({ ...saved, result: "ANSWER-B" })],
      saved.id,
    )?.result,
  ).toBe("ANSWER-B");
});

it.each(["stopped", "aborted", "steered", "error"])(
  "preserves %s",
  (status) => {
    const record = findHistoricalResult([row({ ...saved, status })], saved.id);
    expect(record?.status).toBe(status);
    expect(formatHistoricalResult(record!)).toMatch(/partial|incomplete/);
  },
);

it("does not reject valid output due to unused timestamps", () => {
  expect(
    findHistoricalResult(
      [row({ ...saved, completedAt: "old-format" })],
      saved.id,
    )?.result,
  ).toBe("ANSWER-A");
});

it("reports missing output and unavailable conversation honestly", () => {
  const record = findHistoricalResult(
    [row({ id: saved.id, status: "error" })],
    saved.id,
  );
  const text = formatHistoricalResult(record!, true);
  expect(text).toContain("No final output was saved.");
  expect(text).toContain("Error: unknown");
  expect(text).toContain(
    "Full conversation is unavailable in this historical snapshot.",
  );
});

it("does not claim a history source for a completed run with no saved output", () => {
  const record = findHistoricalResult(
    [row({ id: saved.id, status: "completed" })],
    saved.id,
  );
  expect(formatHistoricalResult(record!)).toContain(
    "No final output was saved.",
  );
});

it.each([null, [], 42, { type: "message", data: saved }])(
  "ignores unrelated %j",
  (entry) => {
    expect(findHistoricalResult([entry], saved.id)).toBeUndefined();
  },
);

it("does not mutate or depend on consumption flags", () => {
  for (const resultConsumed of [false, true]) {
    const data = Object.freeze({ ...saved, resultConsumed });
    const entries = Object.freeze([Object.freeze(row(data))]);
    expect(findHistoricalResult(entries, saved.id)?.result).toBe("ANSWER-A");
    expect(data.resultConsumed).toBe(resultConsumed);
  }
});

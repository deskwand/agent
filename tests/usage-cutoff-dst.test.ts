/**
 * 跨 DST 的区间边界。默认（系统时区）整个文件跳过，用两个专用命令跑：
 *
 *   TZ=America/New_York npx vitest run tests/usage-cutoff-dst.test.ts   # 秋季/春季双向
 *   TZ=America/Santiago npx vitest run tests/usage-cutoff-dst.test.ts   # 午夜跳变
 *
 * 或用 `npm run test:dst` 一次跑完两遍。
 *
 * 覆盖三类边界：
 *  - 秋季回拨（America/New_York，2026-11-01）：毫秒减法会把 7 天起点算成 10-29 13:00
 *  - 春季前拨（America/New_York，2026-03-08）
 *  - 午夜跳变（America/Santiago，2026-09-06 的 00:00 直接跳到 01:00）：若先
 *    setHours 再 setDate，起点会变成 8-31 01:00，丢掉那天的第一个小时
 */
import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  createUsageSchema,
  queryUsage,
  recordUsage,
} from "../src/main/usage/usage-store";
import type { UsageRecordInput } from "../src/shared/usage";

const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

const base = (over: Partial<UsageRecordInput> = {}): UsageRecordInput => ({
  ts: 0,
  sessionId: "s",
  model: "m",
  provider: "p",
  source: "chat",
  purpose: null,
  dedupKey: null,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  ...over,
});

/** 插两行：窗口起点整点（应纳入）与它前一分钟（应排除），断言只纳入前者。 */
function expectWindowStartAt(
  now: Date,
  start: Date,
  inOutput: number,
  outOutput: number,
): void {
  const db = new DatabaseSync(":memory:");
  try {
    createUsageSchema(db);
    recordUsage(
      db,
      base({ ts: start.getTime(), output: inOutput, dedupKey: "in" }),
    );
    recordUsage(
      db,
      base({
        ts: new Date(start.getTime() - 60_000).getTime(),
        output: outOutput,
        dedupKey: "out",
      }),
    );
    expect(queryUsage(db, "7d", now.getTime()).totals.output).toBe(inOutput);
  } finally {
    db.close();
  }
}

// 未在正确时区运行时跳过，并在测试名里写明原因 —— 避免"静默通过"变成假证据。
describe.skipIf(tz !== "America/New_York")("DST transitions", () => {
  it("starts a 7-day window at local midnight after the autumn fall-back", () => {
    expectWindowStartAt(
      new Date(2026, 10, 5, 12, 0, 0), // 本地 11-05 12:00
      new Date(2026, 9, 30, 0, 0, 0), // 期望起点 10-30 00:00
      5,
      500,
    );
  });

  it("starts a 7-day window at local midnight after the spring forward", () => {
    expectWindowStartAt(
      new Date(2026, 2, 12, 12, 0, 0), // 本地 03-12 12:00（03-08 已前拨）
      new Date(2026, 2, 6, 0, 0, 0), // 期望起点 03-06 00:00
      7,
      700,
    );
  });
});

describe.skipIf(tz !== "America/Santiago")(
  "zone whose DST transition is at midnight",
  () => {
    it("keeps the window start at a midnight that exists", () => {
      expectWindowStartAt(
        new Date(2026, 8, 6, 12, 0, 0), // 本地 09-06 12:00（当天 00:00 不存在）
        new Date(2026, 7, 31, 0, 0, 0), // 期望起点 08-31 00:00，不是 01:00
        11,
        1100,
      );
    });
  },
);

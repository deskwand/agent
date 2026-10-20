import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  ROLLUP_VERSION,
  createUsageSchema,
  isRollupFresh,
  queryUsage,
  queryUsageFromRecords,
  readRollupState,
  recordUsage,
} from "../../main/usage/usage-store";
import { bucketOf, loadPriceIndex } from "../../main/usage/usage-cost";
import { backfillUsageFromSessions } from "../../main/usage/usage-backfill";
import type {
  UsageModelRow,
  UsageRange,
  UsageRecordInput,
} from "../../shared/usage";

/**
 * Credibility check: after a backfill, the chat totals must equal a direct scan
 * of the same JSONL — exact equality, not "close enough". This is the one
 * executable piece of evidence that the numbers can be trusted.
 */
describe("usage reconciliation", () => {
  it("backfilled chat totals equal a direct scan of the JSONL", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "deskwand-reconcile-"));
    const db = new DatabaseSync(":memory:");
    createUsageSchema(db);

    const expected = { input: 0, output: 0, cacheRead: 0 };
    for (let s = 0; s < 3; s += 1) {
      const dir = path.join(root, `session-${s}`);
      fs.mkdirSync(dir, { recursive: true });
      const lines: string[] = [];
      for (let m = 0; m < 5; m += 1) {
        const input = s * 100 + m;
        const output = m * 3;
        const cacheRead = s * 7 + m * 11;
        expected.input += input;
        expected.output += output;
        expected.cacheRead += cacheRead;
        lines.push(
          JSON.stringify({
            type: "message",
            timestamp: "2026-09-12T00:00:00.000Z",
            message: {
              role: "assistant",
              provider: "deepseek",
              model: "deepseek-v4-flash",
              timestamp: 1_760_000_000_000 + s * 1000 + m,
              usage: { input, output, cacheRead, cacheWrite: 0 },
            },
          }),
        );
      }
      fs.writeFileSync(path.join(dir, "run.jsonl"), lines.join("\n"), "utf-8");
    }

    await backfillUsageFromSessions(db, root);
    const snap = queryUsage(db, "all", 1_800_000_000_000);

    expect(snap.totals.input).toBe(expected.input);
    expect(snap.totals.output).toBe(expected.output);
    expect(snap.totals.cacheRead).toBe(expected.cacheRead);
    expect(snap.totals.calls).toBe(15);

    // Idempotent: a second pass changes nothing.
    await backfillUsageFromSessions(db, root);
    const again = queryUsage(db, "all", 1_800_000_000_000);
    expect(again.totals).toEqual(snap.totals);

    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
});

/**
 * 读取路径等价性：聚合路径与原始路径必须逐字段相等。
 *
 * 三条硬要求（design §9.1）：
 *   1. 夹具要建立**有效的 state 行**，否则查询静默退回原始路径；
 *   2. 要证明查询真的走了聚合路径（下面用"改聚合表 → 结果跟着变"来证）；
 *   3. 对照那一半要显式走原始路径。
 * 少了任意一条，这条测试就比较"原始 vs 原始"、必然相等 —— 一条不可能失败的测试
 * 比没有测试更坏。
 */
describe("queryUsage rollup path", () => {
  const NOW_TS = Date.parse("2026-10-12T12:00:00Z");
  /** 2026-10-12 是周一。峰谷时段按 UTC 定义，所以这两个时刻必须用 Date.parse 钉死。 */
  const PEAK_TS = Date.parse("2026-10-12T02:00:00Z"); // 周一 · 高峰窗口内
  const OFF_TS = Date.parse("2026-10-12T05:00:00Z"); // 周一 · 窗口外

  /**
   * **两侧必须用同一个索引**：`recordUsage` 内部写死了 `loadPriceIndex()`，所以读侧
   * 也必须用全局索引。若注入一个只认识别的模型的索引，写入侧会把真实模型的档位记成
   * -1、读侧却按注入了档位的表定价 —— 等价性必然失败；而反方向更险：`isRollupFresh`
   * 也会用注入索引判桶不可解析 → 查询**静默退回兜底** → 测试变成"兜底 vs 兜底"、
   * 永远绿（这正是下面"要求 2"存在的理由）。
   */
  const index = loadPriceIndex();

  const baseRecord: UsageRecordInput = {
    ts: OFF_TS,
    sessionId: "s1",
    model: "deepseek-flash",
    provider: "deepseek",
    source: "chat",
    purpose: null,
    dedupKey: null,
    input: 10,
    output: 20,
    cacheRead: 30,
    cacheWrite: 4,
  };

  const fixture = (): DatabaseSync => {
    const db = new DatabaseSync(":memory:");
    createUsageSchema(db);
    markFresh(db);
    // 覆盖四类：峰谷计划（高峰 / 非高峰两个桶）· 跨档 · 无价目 · 子代理桶
    const write = (over: Partial<UsageRecordInput>) =>
      recordUsage(db, { ...baseRecord, ...over });
    write({ dedupKey: "k1", ts: PEAK_TS });
    write({ dedupKey: "k2", ts: OFF_TS, input: 2000 });
    write({
      dedupKey: "k3",
      model: "gpt-5.6-sol",
      provider: "openai-codex",
      input: 300_000, // 跨 272,000 档
      cacheRead: 5,
    });
    write({ dedupKey: "k4", model: "no-such-model", provider: "p9", input: 7 });
    write({ dedupKey: "k5", model: null, provider: null, output: 3 });
    return db;
  };

  /** 夹具：手工把 state 行置为有效，让查询走聚合路径（不依赖 Task 4 的重建）。 */
  const markFresh = (db: DatabaseSync) =>
    db
      .prepare(
        "INSERT OR REPLACE INTO usage_rollup_state (id, rollup_version, built_at) VALUES (1, ?, 0)",
      )
      .run(ROLLUP_VERSION);

  const modelKey = (r: UsageModelRow) => `${r.provider ?? ""}|${r.model ?? ""}`;
  /** 原始路径的平手顺序由 SQL 决定（未指定），所以按模型键做规范化再比。 */
  const canonical = (rows: UsageModelRow[]) =>
    [...rows].sort((a, b) => modelKey(a).localeCompare(modelKey(b)));

  const RANGES: UsageRange[] = ["1d", "7d", "30d", "90d", "all"];

  it("夹具确实覆盖了计划与跨档（注册表一变这里就响，而不是静默失去覆盖）", () => {
    expect(
      bucketOf(index, {
        ts: PEAK_TS,
        provider: "deepseek",
        model: "deepseek-flash",
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
      }).peak,
    ).toBe(1);
    expect(
      bucketOf(index, {
        ts: OFF_TS,
        provider: "openai-codex",
        model: "gpt-5.6-sol",
        input: 300_000,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
      }).tier,
    ).toBeGreaterThan(-1);
  });

  it("五个区间下与原始路径逐字段相等", () => {
    const db = fixture();
    // 要求 1：state 行有效 + 聚合非空
    expect(readRollupState(db)?.rollupVersion).toBe(ROLLUP_VERSION);
    expect(isRollupFresh(db, index)).toBe(true);

    for (const range of RANGES) {
      const viaRollup = queryUsage(db, range, NOW_TS, index);
      const viaRecords = queryUsageFromRecords(db, range, NOW_TS, index);
      expect(viaRollup.totals).toEqual(viaRecords.totals);
      expect(viaRollup.byDay).toEqual(viaRecords.byDay);
      expect(viaRollup.byHour).toEqual(viaRecords.byHour);
      // 要求 3：byModel 用规范化后的集合比（原始侧平手顺序未指定）
      expect(canonical(viaRollup.byModel)).toEqual(
        canonical(viaRecords.byModel),
      );
    }
    db.close();
  });

  it("空库：聚合路径与原始路径都给全零", () => {
    const db = new DatabaseSync(":memory:");
    createUsageSchema(db);
    markFresh(db);
    const snap = queryUsage(db, "all", NOW_TS, index);
    expect(snap.totals.calls).toBe(0);
    expect(snap.byDay).toEqual([]);
    expect(snap.byModel).toEqual([]);
    db.close();
  });

  it("要求 2：查询确实读的是聚合表（清空聚合表，结果必须跟着变）", () => {
    const db = fixture();
    const before = queryUsage(db, "all", NOW_TS, index).totals.calls;
    expect(before).toBe(5);
    // 直接改聚合表（不动 state 行，版本仍匹配 → 仍走聚合路径）
    db.exec("DELETE FROM usage_daily");
    expect(queryUsage(db, "all", NOW_TS, index).totals.calls).toBe(0);
    // 对照：原始路径看到的是真值 —— 两条路径确实不是同一个东西
    expect(queryUsageFromRecords(db, "all", NOW_TS, index).totals.calls).toBe(
      5,
    );
    db.close();
  });

  it("陈旧（版本不匹配）时退回原始路径，结果仍正确", () => {
    const db = fixture();
    db.prepare(
      "INSERT OR REPLACE INTO usage_rollup_state (id, rollup_version, built_at) VALUES (1, ?, 0)",
    ).run(ROLLUP_VERSION + 1);
    let stale = 0;
    const snap = queryUsage(db, "all", NOW_TS, index, () => {
      stale += 1;
    });
    expect(stale).toBe(1); // 触发了重建回调
    expect(snap).toEqual(queryUsageFromRecords(db, "all", NOW_TS, index));
    db.close();
  });

  it("档位解析不到（价目表改了但没 bump）也算陈旧", () => {
    const db = fixture();
    db.exec("UPDATE usage_daily SET tier = 123 WHERE tier > 0");
    let stale = 0;
    const snap = queryUsage(db, "all", NOW_TS, index, () => {
      stale += 1;
    });
    expect(stale).toBe(1);
    expect(snap).toEqual(queryUsageFromRecords(db, "all", NOW_TS, index));
    db.close();
  });
});

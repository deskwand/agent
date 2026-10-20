import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  ROLLUP_VERSION,
  createUsageSchema,
  isRollupFresh,
  readRollupState,
  rebuildUsageRollup,
  recordUsage,
  rollupIntegrityOk,
} from "../../main/usage/usage-store";
import { buildPriceIndex } from "../../main/usage/usage-cost";
import type { UsageRecordInput } from "../../shared/usage";

const index = buildPriceIndex(
  [
    {
      provider: "p1",
      id: "plain",
      cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 },
    },
  ],
  {},
);

const rec = (over: Partial<UsageRecordInput> = {}): UsageRecordInput => ({
  ts: Date.parse("2026-10-12T05:00:00Z"),
  sessionId: "s1",
  model: "plain",
  provider: "p1",
  source: "chat",
  purpose: null,
  dedupKey: null,
  input: 10,
  output: 20,
  cacheRead: 0,
  cacheWrite: 0,
  ...over,
});

const rollupCalls = (db: DatabaseSync) =>
  (
    db
      .prepare("SELECT COALESCE(SUM(calls), 0) AS n FROM usage_daily")
      .get() as {
      n: number;
    }
  ).n;

const rawRows = (db: DatabaseSync) =>
  (
    db.prepare("SELECT COUNT(*) AS n FROM usage_records").get() as {
      n: number;
    }
  ).n;

describe("usage rollup rebuild", () => {
  it("从零建出聚合表并写上 state 行", async () => {
    const db = new DatabaseSync(":memory:");
    createUsageSchema(db);
    for (let i = 0; i < 5; i += 1) recordUsage(db, rec({ dedupKey: `k${i}` }));
    db.exec("DELETE FROM usage_daily"); // 模拟空聚合 + 无 state
    expect(readRollupState(db)).toBeNull();

    await rebuildUsageRollup(db, index);

    expect(rollupCalls(db)).toBe(5);
    expect(rollupIntegrityOk(db)).toBe(true);
    expect(readRollupState(db)?.rollupVersion).toBe(ROLLUP_VERSION);
    expect(isRollupFresh(db, index)).toBe(true);
    db.close();
  });

  it("全空库不触发无限重建：0 == 0 视为一致", async () => {
    const db = new DatabaseSync(":memory:");
    createUsageSchema(db);
    await rebuildUsageRollup(db, index);
    expect(rollupIntegrityOk(db)).toBe(true);
    expect(isRollupFresh(db, index)).toBe(true);
    db.close();
  });

  it("完整性校验能发现少计，重建后恢复", async () => {
    const db = new DatabaseSync(":memory:");
    createUsageSchema(db);
    recordUsage(db, rec({ dedupKey: "k1" }));
    recordUsage(db, rec({ dedupKey: "k2" }));
    await rebuildUsageRollup(db, index);
    expect(rollupIntegrityOk(db)).toBe(true);

    db.exec("DELETE FROM usage_daily"); // 手工制造偏差
    expect(rollupIntegrityOk(db)).toBe(false);

    await rebuildUsageRollup(db, index);
    expect(rollupCalls(db)).toBe(2);
    db.close();
  });

  it("重建期间的实时写入不被计两次（state 行缺席 = 重建进行中，靠尾巴补齐）", async () => {
    const db = new DatabaseSync(":memory:");
    createUsageSchema(db);
    await rebuildUsageRollup(db, index); // 先建好，state 行有效
    recordUsage(db, rec({ dedupKey: "k1" }));
    expect(rollupCalls(db)).toBe(1);

    // 重建的第一步就是删 state 行 —— 删掉它即等价于"重建进行中"
    db.exec("DELETE FROM usage_rollup_state");
    recordUsage(db, rec({ dedupKey: "k2" }));
    // 这条写入只进了原始表：否则它会既被自己 upsert 进表、又被尾巴重放计一次
    expect(rollupCalls(db)).toBe(1);
    expect(rawRows(db)).toBe(2);

    await rebuildUsageRollup(db, index);
    expect(rollupCalls(db)).toBe(2); // k1 + k2，各一次
    expect(rollupIntegrityOk(db)).toBe(true);
    db.close();
  });

  it("尾巴补齐：扫描开始后新到的行，重建完成后恰好计一次", async () => {
    const db = new DatabaseSync(":memory:");
    createUsageSchema(db);
    recordUsage(db, rec({ dedupKey: "k1" }));
    await rebuildUsageRollup(db, index); // 先建好
    db.exec("DELETE FROM usage_rollup_state");

    // 不 await：重建同步跑完第一页后停在第一个让出点。此刻 maxId 已经取过，
    // 所以下面这一条的 id 必然 > maxId —— 它只能靠尾巴补齐进来。
    const pending = rebuildUsageRollup(db, index);
    recordUsage(db, rec({ dedupKey: "tail" }));
    await pending;

    expect(rawRows(db)).toBe(2);
    expect(rollupCalls(db)).toBe(2); // 各一次：既没丢，也没双计
    expect(rollupIntegrityOk(db)).toBe(true);
    db.close();
  });

  it("完整性校验覆盖 usage_hour：热力图那半张表坏了也要能发现", async () => {
    const db = new DatabaseSync(":memory:");
    createUsageSchema(db);
    recordUsage(db, rec({ dedupKey: "k1" }));
    await rebuildUsageRollup(db, index);
    expect(rollupIntegrityOk(db)).toBe(true);

    // 只坏热力图那一张表：只查 usage_daily 的版本看不见它
    db.exec("DELETE FROM usage_hour");
    expect(rollupIntegrityOk(db)).toBe(false);

    await rebuildUsageRollup(db, index);
    expect(rollupIntegrityOk(db)).toBe(true);
    expect(
      (
        db.prepare("SELECT COUNT(*) AS n FROM usage_hour").get() as {
          n: number;
        }
      ).n,
    ).toBe(1);
    db.close();
  });

  it("中途失败：state 行保持无效，下次重建可重来", async () => {
    const db = new DatabaseSync(":memory:");
    createUsageSchema(db);
    recordUsage(db, rec({ dedupKey: "k1" }));
    await rebuildUsageRollup(db, index);

    // 模拟"重建到一半被杀"：聚合表半成品 + state 行已失效
    db.exec("DELETE FROM usage_rollup_state");
    db.exec("DELETE FROM usage_daily");
    expect(isRollupFresh(db, index)).toBe(false);

    await rebuildUsageRollup(db, index);
    expect(isRollupFresh(db, index)).toBe(true);
    expect(rollupCalls(db)).toBe(1);
    db.close();
  });
});

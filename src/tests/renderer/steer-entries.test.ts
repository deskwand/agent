import { describe, expect, it } from "vitest";
import { mergeSteerEntries } from "../../renderer/steer-entries";
import type { SteerRecord } from "../../renderer/types";

const record = (id: string, ts: number, status: SteerRecord["status"]): SteerRecord => ({
  id,
  text: `text-${id}`,
  status,
  ts,
});

describe("mergeSteerEntries", () => {
  it("interleaves records into the message timeline by timestamp", () => {
    const entries = [
      { id: "m1", message: { timestamp: 100 } },
      { id: "m2", message: { timestamp: 300 } },
    ];
    const records = [record("s1", 200, "delivered")];
    const merged = mergeSteerEntries(entries, records);
    expect(merged.map((e) => e.id)).toEqual(["m1", "s1", "m2"]);
  });

  it("keeps record after message on equal timestamps", () => {
    const entries = [{ id: "m1", message: { timestamp: 100 } }];
    const records = [record("s1", 100, "delivered")];
    expect(mergeSteerEntries(entries, records).map((e) => e.id)).toEqual([
      "m1",
      "s1",
    ]);
  });

  it("renders records even when the message list is empty", () => {
    const records = [record("s1", 100, "failed")];
    expect(mergeSteerEntries([], records)).toHaveLength(1);
  });

  it("preserves relative order of multiple records", () => {
    const entries = [{ id: "m1", message: { timestamp: 100 } }];
    const records = [
      record("s1", 150, "delivered"),
      record("s2", 250, "failed"),
    ];
    expect(mergeSteerEntries(entries, records).map((e) => e.id)).toEqual([
      "m1",
      "s1",
      "s2",
    ]);
  });
});

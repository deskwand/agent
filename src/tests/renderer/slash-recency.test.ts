// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadSlashRecency,
  saveSlashRecency,
  sortByRecency,
} from "../../renderer/slash-recency";

describe("loadSlashRecency", () => {
  beforeEach(() => localStorage.clear());

  it("returns {} when nothing stored", () => {
    expect(loadSlashRecency()).toEqual({});
  });

  it("returns {} on invalid JSON", () => {
    localStorage.setItem("slashRecency", "not-json");
    expect(loadSlashRecency()).toEqual({});
  });

  it("returns {} on non-object JSON", () => {
    localStorage.setItem("slashRecency", "[1,2,3]");
    expect(loadSlashRecency()).toEqual({});
  });

  it("returns stored entries", () => {
    localStorage.setItem("slashRecency", JSON.stringify({ "cmd:goal": 123 }));
    expect(loadSlashRecency()).toEqual({ "cmd:goal": 123 });
  });
});

describe("saveSlashRecency", () => {
  beforeEach(() => localStorage.clear());

  it("writes a new entry with a recent timestamp", () => {
    saveSlashRecency("cmd:plan");
    const stored = loadSlashRecency();
    expect(Object.keys(stored)).toEqual(["cmd:plan"]);
    expect(stored["cmd:plan"]).toBeGreaterThan(0);
  });

  it("updates timestamp of an existing entry", () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(1000).mockReturnValueOnce(2000);
    saveSlashRecency("cmd:plan");
    saveSlashRecency("cmd:plan");
    expect(loadSlashRecency()["cmd:plan"]).toBe(2000);
    vi.restoreAllMocks();
  });

  it("trims to the newest 20 entries", () => {
    let t = 0;
    vi.spyOn(Date, "now").mockImplementation(() => ++t);
    for (let i = 1; i <= 25; i++) saveSlashRecency(`cmd:c${i}`);
    const keys = Object.keys(loadSlashRecency());
    expect(keys).toHaveLength(20);
    expect(keys[0]).toBe("cmd:c25");
    expect(keys[19]).toBe("cmd:c6");
    vi.restoreAllMocks();
  });

  it("silently ignores localStorage failures", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => saveSlashRecency("cmd:plan")).not.toThrow();
    vi.restoreAllMocks();
  });
});

describe("sortByRecency", () => {
  const recency = {
    "cmd:goal": 3000,
    "cmd:compact": 1000,
    "skill:foo": 2000,
  };

  it("puts recency items first, ordered by desc timestamp", () => {
    const items = ["cmd:compact", "cmd:goal", "skill:foo"];
    expect(sortByRecency(items, (k) => k, recency)).toEqual([
      "cmd:goal",
      "skill:foo",
      "cmd:compact",
    ]);
  });

  it("keeps non-recency items in original order after recency items", () => {
    const items = ["cmd:compact", "cmd:goal", "skill:zzz"];
    expect(sortByRecency(items, (k) => k, recency)).toEqual([
      "cmd:goal",
      "cmd:compact",
      "skill:zzz",
    ]);
  });

  it("returns original order when no recency data", () => {
    const items = ["a", "b", "c"];
    expect(sortByRecency(items, (k) => k, {})).toEqual(["a", "b", "c"]);
  });
});

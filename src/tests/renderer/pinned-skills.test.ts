// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  composeSkillShortcuts,
  loadPinnedSkills,
  togglePinnedSkill,
} from "../../renderer/pinned-skills";

const KEY = "deskwand.pinnedSkills";

const enabled = (...names: string[]) => new Set(names);

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadPinnedSkills", () => {
  it("空存储返回空数组", () => {
    expect(loadPinnedSkills()).toEqual([]);
  });

  it("内容损坏或类型不对时返回空数组", () => {
    localStorage.setItem(KEY, "{oops");
    expect(loadPinnedSkills()).toEqual([]);
    localStorage.setItem(KEY, JSON.stringify({ pdf: 1 }));
    expect(loadPinnedSkills()).toEqual([]);
  });

  it("localStorage 本身不可用时返回空数组（不是只有 JSON 损坏这一条路）", () => {
    const spy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("storage denied");
      });
    expect(loadPinnedSkills()).toEqual([]);
    spy.mockRestore();
  });

  it("保序、去重、剔除非字符串项", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify(["pdf", "pdf", 7, "officecli", ""]),
    );
    expect(loadPinnedSkills()).toEqual(["pdf", "officecli"]);
  });
});

describe("togglePinnedSkill", () => {
  it("新固定追加到末尾（末尾 = 最后一名）", () => {
    localStorage.setItem(KEY, JSON.stringify(["pdf"]));
    expect(togglePinnedSkill("officecli")).toEqual(["pdf", "officecli"]);
    expect(loadPinnedSkills()).toEqual(["pdf", "officecli"]);
  });

  it("已固定的再点一次就移除", () => {
    localStorage.setItem(KEY, JSON.stringify(["pdf", "officecli"]));
    expect(togglePinnedSkill("pdf")).toEqual(["officecli"]);
  });
});

describe("composeSkillShortcuts", () => {
  it("星标在前且保持加入顺序，最近调用只能排在后面", () => {
    const { names } = composeSkillShortcuts({
      pinned: ["b", "a"],
      enabledNames: enabled("a", "b", "c", "d"),
      recency: { "skill:c": 900, "skill:d": 800 },
    });
    expect(names).toEqual(["b", "a", "c", "d"]);
  });

  it("最近调用按时间倒序，且只填到 5 行", () => {
    const { names } = composeSkillShortcuts({
      pinned: ["a"],
      enabledNames: enabled("a", "c1", "c2", "c3", "c4", "c5"),
      recency: {
        "skill:c1": 100,
        "skill:c2": 500,
        "skill:c3": 300,
        "skill:c4": 400,
        "skill:c5": 200,
      },
    });
    expect(names).toEqual(["a", "c2", "c4", "c3", "c5"]);
    expect(names).toHaveLength(5);
  });

  it("星标已经占满 5 行时，最近调用一个都不出现", () => {
    const pinned = ["s1", "s2", "s3", "s4", "s5"];
    const { names } = composeSkillShortcuts({
      pinned,
      enabledNames: enabled(...pinned, "recent"),
      recency: { "skill:recent": 999 },
    });
    expect(names).toEqual(pinned);
  });

  it("同时在星标与最近调用里的技能只出现一次，位置由星标决定", () => {
    const { names } = composeSkillShortcuts({
      pinned: ["pdf"],
      enabledNames: enabled("pdf", "officecli"),
      recency: { "skill:pdf": 999, "skill:officecli": 1 },
    });
    expect(names).toEqual(["pdf", "officecli"]);
  });

  it("禁用/已删除的技能既不占星标名额也不进补齐，pinnedAvailable 只算可用的", () => {
    const { names, pinnedAvailable } = composeSkillShortcuts({
      pinned: ["gone", "a"],
      enabledNames: enabled("a", "c"),
      recency: { "skill:gone": 999, "skill:c": 1 },
    });
    expect(names).toEqual(["a", "c"]);
    expect(pinnedAvailable).toBe(1);
  });

  it("星标超过 5 个时只取前 5，pinnedAvailable 报可用总数（5/7 的分母）", () => {
    const pinned = ["s1", "s2", "s3", "s4", "s5", "s6", "s7"];
    const { names, pinnedAvailable } = composeSkillShortcuts({
      pinned,
      enabledNames: enabled(...pinned),
      recency: {},
    });
    expect(names).toEqual(["s1", "s2", "s3", "s4", "s5"]);
    expect(pinnedAvailable).toBe(7);
  });

  it("星标本身重复时只占一个名额、只出一行", () => {
    const { names, pinnedAvailable } = composeSkillShortcuts({
      pinned: ["pdf", "pdf", "a"],
      enabledNames: enabled("pdf", "a"),
      recency: {},
    });
    expect(names).toEqual(["pdf", "a"]);
    expect(pinnedAvailable).toBe(2);
  });

  it("slashRecency 里的命令记录不参与技能补齐", () => {
    const { names } = composeSkillShortcuts({
      pinned: [],
      enabledNames: enabled("a"),
      recency: { "cmd:plan": 999, "skill:a": 1 },
    });
    expect(names).toEqual(["a"]);
  });
});

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadRailPins, toggleRailPin } from "../../renderer/utils/rail-pins";

const KEY = "deskwand.railPins";
beforeEach(() => {
  localStorage.clear();
});

describe("loadRailPins", () => {
  it("空存储返回空数组", () => {
    expect(loadRailPins()).toEqual([]);
  });

  it("内容损坏或类型不对时返回空数组", () => {
    localStorage.setItem(KEY, "{oops");
    expect(loadRailPins()).toEqual([]);
    localStorage.setItem(KEY, JSON.stringify({ vault: true }));
    expect(loadRailPins()).toEqual([]);
    localStorage.setItem(KEY, JSON.stringify("vault"));
    expect(loadRailPins()).toEqual([]);
  });

  it("丢掉非字符串、空串与重复项，保留顺序", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify(["vault", 7, "", "apps", "vault"]),
    );
    expect(loadRailPins()).toEqual(["vault", "apps"]);
  });

  it("getItem 抛异常时返回空数组", () => {
    const spy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("storage disabled");
      });
    expect(loadRailPins()).toEqual([]);
    spy.mockRestore();
  });
});

describe("toggleRailPin", () => {
  it("固定：追加到末尾（末尾 = 最新固定 = 排在下面）", () => {
    expect(toggleRailPin("vault", [])).toEqual(["vault"]);
    expect(toggleRailPin("apps", ["vault"])).toEqual(["vault", "apps"]);
    expect(loadRailPins()).toEqual(["vault", "apps"]);
  });

  it("取消固定：从数组里移除，其余保序", () => {
    toggleRailPin("vault", []);
    toggleRailPin("apps", ["vault"]);
    expect(toggleRailPin("vault", ["vault", "apps"])).toEqual(["apps"]);
    expect(loadRailPins()).toEqual(["apps"]);
  });

  it("固定失败（存储被禁用）时仍返回新数组，本次切换在内存里生效", () => {
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota exceeded");
      });
    expect(toggleRailPin("vault", [])).toEqual(["vault"]);
    spy.mockRestore();
  });

  it("存储连续写失败时，两次固定都留在结果里（不以存储为基准）", () => {
    // 回归：若以存储为基准，第一次写失败后第二次重读会得到 []，第一次的固定被静默吞掉
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota exceeded");
      });
    const first = toggleRailPin("vault", []);
    const second = toggleRailPin("apps", first);
    expect(second).toEqual(["vault", "apps"]);
    spy.mockRestore();
  });
});

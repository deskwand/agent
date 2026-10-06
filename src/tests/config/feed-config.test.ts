import { describe, expect, it } from "vitest";
import {
  normalizeFeedConfig,
  type FeedConfig,
} from "../../main/config/config-store";

describe("normalizeFeedConfig", () => {
  it("配置里没有这个字段时是关闭的（升级用户不能被当成开着）", () => {
    expect(normalizeFeedConfig(undefined)).toEqual({
      enabled: false,
      blockedTopics: [],
    });
  });

  it("只有显式 true 才算打开", () => {
    expect(normalizeFeedConfig({ enabled: true }).enabled).toBe(true);
    expect(normalizeFeedConfig({ enabled: "true" }).enabled).toBe(false);
    expect(normalizeFeedConfig({ enabled: 1 }).enabled).toBe(false);
    expect(normalizeFeedConfig({ enabled: false }).enabled).toBe(false);
  });

  it("屏蔽主题只留非空字符串，去掉重复与首尾空白", () => {
    expect(
      normalizeFeedConfig({
        blockedTopics: ["  Rust  ", "Rust", "", null, 7],
      }),
    ).toEqual({ enabled: false, blockedTopics: ["Rust"] });
  });

  it("坏形状不抛，退回默认", () => {
    expect(normalizeFeedConfig("nope")).toEqual({
      enabled: false,
      blockedTopics: [],
    });
  });

  it("返回的对象形状始终完整（调用方不用写 ?. 兜底）", () => {
    const config: FeedConfig = normalizeFeedConfig({ enabled: true });
    expect(config.blockedTopics).toEqual([]);
  });
});

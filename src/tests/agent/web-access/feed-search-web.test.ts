import { describe, expect, it } from "vitest";
import { searchWeb } from "../../../main/agent/tools/web-access/web-tools";
import type { WebAccessConfig } from "../../../shared/web-access";

// 空配置 + 抛错的鉴权解析 = 搜索一定失败，而且**不会联网**（provider 在发请求前就挂了）。
// 真实 provider 的连通性由手工验收与 VERIFY_CATALOG 那类 live 测试覆盖，不放在单测里。
function failingOptions(): {
  getConfig: () => WebAccessConfig;
  resolveProviderAuth: () => Promise<undefined>;
  numResults: number;
} {
  return {
    getConfig: () => ({}) as unknown as WebAccessConfig,
    resolveProviderAuth: async () => undefined,
    numResults: 6,
  };
}

describe("searchWeb", () => {
  it("每个 query 恰好返回一条结果，形状固定，且永不抛", async () => {
    const results = await searchWeb(["a", "b", "c"], failingOptions());
    expect(results.map((result) => result.query)).toEqual(["a", "b", "c"]);
    for (const result of results) {
      expect(Array.isArray(result.results)).toBe(true);
      expect(result.answer).toBeTypeOf("string");
    }
  });

  it("鉴权解析抛错时不往外抛，逐 query 带回错误", async () => {
    const results = await searchWeb(["x"], {
      getConfig: () => ({}) as unknown as WebAccessConfig,
      resolveProviderAuth: async () => {
        throw new Error("auth exploded");
      },
      numResults: 6,
    });
    expect(results).toHaveLength(1);
    expect(results[0].results).toEqual([]);
    expect(results[0].error).toBeTruthy();
  });

  it("空查询列表返回空数组（不抛）", async () => {
    expect(await searchWeb([], failingOptions())).toEqual([]);
  });
});

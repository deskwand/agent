import { describe, expect, it } from "vitest";
import {
  API_VIEW_LIST,
  backFrom,
  openCatalog,
  openDetail,
  pickCatalogEntry,
} from "../../renderer/components/settings/api/api-view";
import type { ProviderCatalogEntry } from "../../renderer/components/settings/provider-catalog";

const deepseek: ProviderCatalogEntry = { kind: "provider", id: "deepseek" };

describe("ApiView 状态机", () => {
  it("打开目录记住返回目标", () => {
    expect(openCatalog("vision")).toEqual({
      kind: "catalog",
      returnTo: "vision",
    });
  });

  it("选中瓦片进入添加页，返回目标沿袭目录", () => {
    const add = pickCatalogEntry(openCatalog("main"), deepseek);
    expect(add).toEqual({ kind: "add", entry: deepseek, returnTo: "main" });
  });

  it("添加页返回只退到目录，不直接掉回列表", () => {
    const add = pickCatalogEntry(openCatalog("main"), deepseek);
    expect(backFrom(add)).toEqual({ kind: "catalog", returnTo: "main" });
  });

  it("目录与详情的返回都是列表", () => {
    expect(backFrom(openCatalog("main"))).toBe(API_VIEW_LIST);
    expect(backFrom(openDetail("deepseek", "main"))).toBe(API_VIEW_LIST);
  });

  it("非目录态调用 pickCatalogEntry 原样返回", () => {
    expect(pickCatalogEntry(API_VIEW_LIST, deepseek)).toBe(API_VIEW_LIST);
  });
});

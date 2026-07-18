import { describe, expect, it } from "vitest";
import { normalizeFetchContentParams } from "../../../main/agent/tools/web-access/fetch-params";

describe("normalizeFetchContentParams", () => {
  it("falls back to url when urls is empty", () => {
    expect(
      normalizeFetchContentParams({
        url: "https://example.com/docs",
        urls: [],
      }),
    ).toEqual({
      urlList: ["https://example.com/docs"],
      options: {},
    });
  });

  it("prefers, trims, and deduplicates non-empty urls", () => {
    expect(
      normalizeFetchContentParams({
        url: "https://example.com/fallback",
        urls: [
          " https://example.com/one ",
          "",
          "https://example.com/one",
          "https://example.com/two",
        ],
      }).urlList,
    ).toEqual(["https://example.com/one", "https://example.com/two"]);
  });

  it("caps URL batches to the safe per-call limit", () => {
    const urls = Array.from(
      { length: 15 },
      (_, index) => `https://example.com/${index}`,
    );
    expect(normalizeFetchContentParams({ urls }).urlList).toEqual(
      urls.slice(0, 10),
    );
  });

  it("preserves forceClone only for booleans", () => {
    expect(normalizeFetchContentParams({ forceClone: true }).options).toEqual({
      forceClone: true,
    });
    expect(normalizeFetchContentParams({ forceClone: "true" }).options).toEqual(
      {},
    );
  });
});

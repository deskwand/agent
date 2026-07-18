import { describe, expect, it } from "vitest";
import { WebAccessCache } from "../../../main/agent/tools/web-access/cache";
import type { StoredWebAccessResult } from "../../../main/agent/tools/web-access/types";

function fetchResult(id: string, timestamp: number): StoredWebAccessResult {
  return {
    id,
    type: "fetch",
    timestamp,
    urls: [
      {
        url: "https://example.com",
        title: "Example",
        content: id,
        error: null,
      },
    ],
  };
}

describe("WebAccessCache", () => {
  it("isolates results by session", () => {
    const cache = new WebAccessCache(() => 1000);
    cache.set("a", fetchResult("same", 1000));
    expect(cache.get("a", "same")?.id).toBe("same");
    expect(cache.get("b", "same")).toBeNull();
  });

  it("expires results after one hour", () => {
    let now = 1000;
    const cache = new WebAccessCache(() => now);
    cache.set("a", fetchResult("old", now));
    now += 60 * 60 * 1000 + 1;
    expect(cache.lookup("a", "old")).toEqual({ status: "expired" });
    expect(cache.get("a", "old")).toBeNull();
  });

  it("evicts the oldest response after 20 entries", () => {
    let now = 1000;
    const cache = new WebAccessCache(() => now);
    for (let index = 0; index < 21; index += 1) {
      cache.set("a", fetchResult(`id-${index}`, now++));
    }
    expect(cache.get("a", "id-0")).toBeNull();
    expect(cache.get("a", "id-20")?.id).toBe("id-20");
  });

  it("clears a deleted session only", () => {
    const cache = new WebAccessCache(() => 1000);
    cache.set("a", fetchResult("a-id", 1000));
    cache.set("b", fetchResult("b-id", 1000));
    cache.clearSession("a");
    expect(cache.get("a", "a-id")).toBeNull();
    expect(cache.get("b", "b-id")?.id).toBe("b-id");
  });
});

import { describe, expect, it } from "vitest";
import { MCP_CATALOG } from "../../shared/mcp-catalog";

describe("MCP_CATALOG", () => {
  it("has exactly 5 entries", () => {
    expect(MCP_CATALOG).toHaveLength(5);
  });

  it("has no duplicate keys", () => {
    const keys = MCP_CATALOG.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("contains the five confirmed keys", () => {
    const keys = new Set(MCP_CATALOG.map((e) => e.key));
    for (const k of ["notion", "linear", "sentry", "stripe", "atlassian"]) {
      expect(keys.has(k)).toBe(true);
    }
  });

  it("all endpoints are https", () => {
    for (const entry of MCP_CATALOG) {
      expect(entry.url).toMatch(/^https:\/\//);
    }
  });

  it("atlassian uses the v2 endpoint", () => {
    const a = MCP_CATALOG.find((e) => e.key === "atlassian");
    expect(a?.url).toContain("/v2/mcp");
  });

  it("every entry has i18n keys", () => {
    for (const entry of MCP_CATALOG) {
      expect(entry.nameKey).toMatch(/^connectors\.catalog\./);
      expect(entry.descriptionKey).toMatch(/^connectors\.catalog\./);
    }
  });
});

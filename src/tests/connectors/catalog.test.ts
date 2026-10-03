import { describe, expect, it } from "vitest";
import {
  authOf,
  CATEGORY_ORDER,
  MCP_CATALOG,
  type CatalogCategory,
  type CatalogVerified,
} from "../../shared/mcp-catalog";

const CATEGORIES = new Set<CatalogCategory>(CATEGORY_ORDER);
const VERIFIED = new Set<CatalogVerified>([
  "registered",
  "authorized",
  "key-required",
]);

describe("MCP_CATALOG", () => {
  it("is not empty and has no duplicate keys", () => {
    expect(MCP_CATALOG.length).toBeGreaterThan(0);
    const keys = MCP_CATALOG.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps the five originally confirmed keys", () => {
    const keys = new Set(MCP_CATALOG.map((e) => e.key));
    for (const k of ["notion", "linear", "sentry", "stripe", "atlassian"]) {
      expect(keys.has(k)).toBe(true);
    }
  });

  it("uses only server-name-safe keys", () => {
    // key 会写进 mcp.json 当 server 名，必须合 mcp-config-file.ts 的合法字符集
    for (const entry of MCP_CATALOG) {
      expect(entry.key).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("has unique https endpoints", () => {
    const urls = MCP_CATALOG.map((e) => e.url);
    for (const url of urls) expect(url).toMatch(/^https:\/\//);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("every entry has i18n keys", () => {
    for (const entry of MCP_CATALOG) {
      expect(entry.nameKey).toMatch(/^connectors\.catalog\./);
      expect(entry.descriptionKey).toMatch(/^connectors\.catalog\./);
    }
  });

  it("every entry has a known category and verification tier", () => {
    for (const entry of MCP_CATALOG) {
      expect(CATEGORIES.has(entry.category)).toBe(true);
      expect(VERIFIED.has(entry.verified)).toBe(true);
    }
  });

  it("fills in every field a key-based entry needs to be usable", () => {
    const keyEntries = MCP_CATALOG.filter((e) => authOf(e).kind === "key");
    // 空集合会让下面的循环空转通过，把「什么都没验」伪装成全绿
    expect(keyEntries.length).toBeGreaterThan(0);
    for (const entry of keyEntries) {
      const auth = authOf(entry);
      if (auth.kind !== "key") continue;
      expect(entry.verified).toBe("key-required");
      expect(auth.name.length).toBeGreaterThan(0);
      expect(auth.consoleUrl).toMatch(/^https:\/\//);
      expect(auth.credentialLabelKey).toMatch(/^connectors\.catalog\./);
      if (auth.placement === "query") {
        // 模板里已经带着凭据值 ⇒ 用户的凭据变成了代码里的常量
        expect(new URL(entry.url).searchParams.has(auth.name)).toBe(false);
        // 前缀只对 header 有意义，写在 query 条目上会被静默忽略
        expect(auth.valuePrefix).toBeUndefined();
      }
    }
  });

  it("contains the eleven key-based services verified on 2026-10-03", () => {
    const expected = [
      "amap",
      "baidumap",
      "tencentmap",
      "gitee",
      "zhipu-websearch",
      "zhipu-webreader",
      "zhipu-zread",
      "baidu-ocr",
      "bailian-websearch",
      "tencent-docs",
      "youdaonote",
    ];
    const keys = new Set(MCP_CATALOG.map((e) => e.key));
    expect(expected.filter((k) => !keys.has(k))).toEqual([]);
  });

  it("CATEGORY_ORDER covers every category used, without duplicates", () => {
    expect(new Set(CATEGORY_ORDER).size).toBe(CATEGORY_ORDER.length);
    for (const entry of MCP_CATALOG) {
      expect(CATEGORY_ORDER).toContain(entry.category);
    }
  });

  it("contains every service that reached the registered tier on 2026-10-03", () => {
    const expected = [
      "supabase",
      "neon",
      "vercel",
      "cloudflare",
      "netlify",
      "railway",
      "grafana",
      "datadog",
      "honeycomb",
      "postman",
      "clickhouse",
      "framer",
      "clerk",
      "monday",
      "clickup",
      "trello",
      "miro",
      "airtable",
      "todoist",
      "dropbox",
      "canva",
      "lucid",
      "granola",
      "intercom",
      "greenhouse",
      "paypal",
      "zapier",
      "klaviyo",
      "buffer",
      "amplitude",
      "attio",
      "resend",
      "webflow",
      "wix",
      "vanta",
      "plaid",
      "huggingface",
      "context7",
      "deepwiki",
    ];
    const keys = new Set(MCP_CATALOG.map((e) => e.key));
    const missing = expected.filter((k) => !keys.has(k));
    expect(missing).toEqual([]);
  });

  it("excludes the endpoints that failed live verification", () => {
    // figma(403) / gong(400, 回调被拒) / instantly(400, 仅受信客户端) / strava(400)
    // 这条绑的是「今天为止它们没通过」这个**证据**，不是永久结论：
    // 它们哪天真的通了，删掉本用例与对应条目即可（原始报错见 spec 附录 C）。
    const keys = new Set(MCP_CATALOG.map((e) => e.key));
    for (const k of ["figma", "gong", "instantly", "strava"]) {
      expect(keys.has(k)).toBe(false);
    }
  });

  it("atlassian uses the v2 endpoint", () => {
    const a = MCP_CATALOG.find((e) => e.key === "atlassian");
    expect(a?.url).toContain("/v2/mcp");
  });
});

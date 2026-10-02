import { describe, expect, it } from "vitest";
import { buildRemoteEntries } from "../../main/connectors/sources/mcp-remote-source";
import type { CatalogEntry } from "../../shared/mcp-catalog";
import type { ConnectorStatus } from "../../shared/connectors";
import type { McpServerEntry } from "@earendil-works/pi-coding-agent";

const CATALOG: CatalogEntry[] = [
  {
    key: "notion",
    nameKey: "n",
    descriptionKey: "nd",
    url: "https://mcp.notion.com/mcp",
  },
  {
    key: "linear",
    nameKey: "l",
    descriptionKey: "ld",
    url: "https://mcp.linear.app/mcp",
  },
];

const NOTION_SERVER: McpServerEntry = {
  name: "notion",
  config: { type: "http", url: "https://mcp.notion.com/mcp" },
  source: "test",
  scope: "global",
};

function ctx(
  servers: McpServerEntry[],
  statusFor: (n: string) => ConnectorStatus | undefined = () => undefined,
  credentialed: string[] = [],
) {
  return {
    loaded: { servers, errors: [] },
    statusFor,
    hasCredentials: (url: string) => credentialed.includes(url),
  };
}

describe("buildRemoteEntries", () => {
  it("returns one entry per catalog row", () => {
    const entries = buildRemoteEntries(ctx([]), CATALOG);
    expect(entries.map((e) => e.key).sort()).toEqual([
      "mcp:catalog:linear",
      "mcp:catalog:notion",
    ]);
  });

  it("a catalog entry with no matching server has empty instances", () => {
    const entries = buildRemoteEntries(ctx([]), CATALOG);
    const linear = entries.find((e) => e.key === "mcp:catalog:linear")!;
    expect(linear.instances).toEqual([]);
  });

  it("a catalog entry with a matching server gets one instance with its status", () => {
    const entries = buildRemoteEntries(
      ctx([NOTION_SERVER], (n) =>
        n === "notion" ? { kind: "ready" } : undefined,
      ),
      CATALOG,
    );
    const notion = entries.find((e) => e.key === "mcp:catalog:notion")!;
    expect(notion.instances).toHaveLength(1);
    expect(notion.instances[0].id).toBe("notion");
    expect(notion.instances[0].status).toEqual({ kind: "ready" });
  });

  it("does not claim progress when the runtime has no state yet", () => {
    // 回归：这里原本回退成 { kind:"connecting" }，于是「SDK 从没连过」的 server
    // 会永远显示「授权中…」且只给一个禁用按钮 —— 用户无法取消、无法重试、无法断开。
    // 没有运行状态就是没有，别编造进度。
    const entries = buildRemoteEntries(ctx([NOTION_SERVER]), CATALOG);
    const notion = entries.find((e) => e.key === "mcp:catalog:notion")!;
    expect(notion.instances[0].status).toEqual({ kind: "idle" });
  });

  it("surfaces non-catalog remote servers so they do not vanish from the page", () => {
    const custom: McpServerEntry = {
      name: "my-tools",
      config: { type: "http", url: "https://example.com/mcp" },
      source: "test",
      scope: "global",
    };
    const entries = buildRemoteEntries(ctx([custom]), CATALOG);
    const mine = entries.find((e) => e.key === "mcp:server:my-tools");
    expect(mine).toBeDefined();
    expect(mine!.instances).toHaveLength(1);
    expect(mine!.nameKey).toBe("my-tools");
  });

  it("does not duplicate a catalog server as a custom entry", () => {
    const entries = buildRemoteEntries(ctx([NOTION_SERVER]), CATALOG);
    expect(entries.filter((e) => e.instances.length > 0)).toHaveLength(1);
  });

  it("ignores stdio servers (they belong to the builtin source)", () => {
    const stdio: McpServerEntry = {
      name: "Chrome",
      config: { type: "stdio", command: "npx" },
      source: "test",
      scope: "global",
    };
    const entries = buildRemoteEntries(ctx([stdio]), CATALOG);
    expect(entries.some((e) => e.key.includes("Chrome"))).toBe(false);
  });

  it("every entry uses tab=connect and source=mcp-remote", () => {
    const entries = buildRemoteEntries(ctx([NOTION_SERVER]), CATALOG);
    for (const e of entries) {
      expect(e.transport).toBe("http");
      expect(e.source).toBe("mcp-remote");
    }
  });
});

describe("已授权但运行时还没连上", () => {
  it("报 authorized，而不是笼统的「未连接」", () => {
    // 回归：用户刚在浏览器里授权成功（凭据已落盘），但运行时还没有任何状态，
    // 卡片却显示「未连接」—— 看起来像授权失败了。
    // 凭据存在是我们确知的事实，状态必须反映它。
    const entries = buildRemoteEntries(
      ctx([NOTION_SERVER], () => undefined, [CATALOG[0].url]),
      CATALOG,
    );
    const notion = entries.find((e) => e.key === "mcp:catalog:notion")!;
    expect(notion.instances[0].status).toEqual({ kind: "authorized" });
  });

  it("没有凭据时仍是 idle", () => {
    const entries = buildRemoteEntries(ctx([NOTION_SERVER]), CATALOG);
    const notion = entries.find((e) => e.key === "mcp:catalog:notion")!;
    expect(notion.instances[0].status).toEqual({ kind: "idle" });
  });

  it("运行时状态优先于凭据判断", () => {
    // 已连上就不能再显示「已授权」
    const entries = buildRemoteEntries(
      ctx([NOTION_SERVER], () => ({ kind: "ready" }), [CATALOG[0].url]),
      CATALOG,
    );
    const notion = entries.find((e) => e.key === "mcp:catalog:notion")!;
    expect(notion.instances[0].status).toEqual({ kind: "ready" });
  });
});

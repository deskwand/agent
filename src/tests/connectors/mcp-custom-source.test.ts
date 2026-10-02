import { describe, expect, it } from "vitest";
import type { CatalogEntry } from "../../shared/mcp-catalog";
import type { ConnectorStatus } from "../../shared/connectors";
import type { McpServerEntry } from "@earendil-works/pi-coding-agent";
import { buildCustomEntries } from "../../main/connectors/sources/mcp-custom-source";
import type { SourceBuildContext } from "../../main/connectors/sources/mcp-remote-source";

const NOTION: CatalogEntry = {
  key: "notion",
  nameKey: "n",
  descriptionKey: "nd",
  url: "https://mcp.notion.com/mcp",
};

function ctx(
  servers: McpServerEntry[],
  statusFor: (name: string) => ConnectorStatus | undefined = () => undefined,
): SourceBuildContext {
  return {
    loaded: { servers, errors: [] },
    statusFor,
    hasCredentials: () => false,
  };
}

function stdio(name: string, enabled?: boolean): McpServerEntry {
  return {
    name,
    config: {
      type: "stdio",
      command: "node",
      ...(enabled === undefined ? {} : { enabled }),
    },
    source: "test",
    scope: "global",
  };
}

describe("buildCustomEntries", () => {
  it("lists a server that is neither in the catalog nor a builtin preset", () => {
    const entries = buildCustomEntries(ctx([stdio("testn")]), [NOTION]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      key: "mcp:server:testn",
      serverName: "testn",
      source: "mcp-custom",
      transport: "stdio",
    });
    // 用户自己起的名字没有 i18n key，直接用名字显示
    expect(entries[0].nameKey).toBe("testn");
    expect(entries[0].instances[0].status).toEqual({ kind: "idle" });
    expect(entries[0].transport).toBe("stdio");
  });

  it("ignores http servers — the remote source already owns them", () => {
    // 否则同一台 http server 会渲染两张卡（React 重复 key），
    // 且两边都给那个「断开」= 删配置的动作。
    const entries = buildCustomEntries(
      ctx([
        {
          name: "my-endpoint",
          config: { type: "http", url: "https://internal/mcp" },
          source: "test",
          scope: "global",
        },
      ]),
      [],
    );
    expect(entries).toEqual([]);
  });

  it("does not duplicate a catalog server", () => {
    const entries = buildCustomEntries(
      ctx([
        {
          name: "notion",
          config: { type: "http", url: NOTION.url },
          source: "test",
          scope: "global",
        },
      ]),
      [NOTION],
    );
    expect(entries).toEqual([]);
  });

  it("excludes builtin preset names", () => {
    const entries = buildCustomEntries(ctx([stdio("Chrome")]), []);
    expect(entries).toEqual([]);
  });

  it("reports off for a disabled server", () => {
    const entries = buildCustomEntries(ctx([stdio("testn", false)]), []);
    expect(entries[0].instances[0].status).toEqual({ kind: "off" });
  });

  it("uses the runtime status when there is one", () => {
    const entries = buildCustomEntries(
      ctx([stdio("testn")], () => ({ kind: "ready" })),
      [],
    );
    expect(entries[0].instances[0].status).toEqual({ kind: "ready" });
  });
});

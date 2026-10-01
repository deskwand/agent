/**
 * 精选的远程 MCP 目录。
 *
 * 准入三条件（缺一不可，见 design-docs/2026-09-30-connectors-page-design.md §7.4）：
 *  1. 厂商官方托管的 remote MCP URL，不收社区代理（社区 wrapper 会拿到用户的 OAuth token）
 *  2. 支持 OAuth 且支持动态客户端注册（DCR）——否则得预注册 clientId
 *  3. 实际跑通一次完整授权，不是照抄文档
 *
 * 所以这份列表的大小不是设计决定的，是逐个跑通决定的。跑通一个加一个。
 */
export interface CatalogEntry {
  key: string;
  /** i18n key，不在这里塞文案 */
  nameKey: string;
  descriptionKey: string;
  url: string;
}

export const MCP_CATALOG: readonly CatalogEntry[] = [
  {
    key: "notion",
    nameKey: "connectors.catalog.notion",
    descriptionKey: "connectors.catalog.notionDesc",
    url: "https://mcp.notion.com/mcp",
  },
  {
    key: "linear",
    nameKey: "connectors.catalog.linear",
    descriptionKey: "connectors.catalog.linearDesc",
    url: "https://mcp.linear.app/mcp",
  },
  {
    key: "sentry",
    nameKey: "connectors.catalog.sentry",
    descriptionKey: "connectors.catalog.sentryDesc",
    url: "https://mcp.sentry.dev/mcp",
  },
  {
    key: "stripe",
    nameKey: "connectors.catalog.stripe",
    descriptionKey: "connectors.catalog.stripeDesc",
    url: "https://mcp.stripe.com",
  },
  {
    key: "atlassian",
    nameKey: "connectors.catalog.atlassian",
    descriptionKey: "connectors.catalog.atlassianDesc",
    // 必须用 v2：v1 已不推荐，且 v2 暴露更多工具与产品
    url: "https://mcp.atlassian.com/v2/mcp",
  },
] as const;

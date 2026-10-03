/**
 * 精选的远程 MCP 目录。
 *
 * 准入条件（见 design-docs/2026-10-03-mcp-catalog-expansion-design.md §3.2）：
 *  1. 厂商官方托管的 remote MCP URL，不收社区代理（社区 wrapper 会拿到用户的 OAuth token）
 *  2. 有 OAuth 的必须支持动态客户端注册（DCR）——否则得预注册 clientId；
 *     完全免认证的（initialize + tools/list + 一次真实只读调用都通过）也可以收
 *  3. 至少到 `registered` 档：按该条目的授权形态验证过（见 CatalogVerified）
 *
 * 所以这份列表的大小不是设计决定的，是逐个验证决定的。
 */
export type CatalogCategory = "dev" | "collab" | "business" | "ai" | "life";

/**
 * 验证档位。只落两档 —— `probed`（只探到元数据）不落地：
 * 没有任何条目停在纯探针档，落一个空档位是投机。
 *
 * 取值只能由**跑过的证据**决定：OAuth 条目要跑到「DCR 注册成功 + 授权 URL 被接受」，
 * 免认证条目要跑到「tools/list + 一次真实只读调用成功」。`authorized` 需要真人跑完授权。
 */
export type CatalogVerified = "registered" | "authorized";

export interface CatalogEntry {
  key: string;
  /** i18n key，不在这里塞文案 */
  nameKey: string;
  descriptionKey: string;
  url: string;
  category: CatalogCategory;
  verified: CatalogVerified;
}

/**
 * 连接页分段的展示顺序。
 *
 * **不靠数组顺序** —— 数组按分类分组排列只为可读，
 * 谁把一条插错位置不会静默改变页面顺序。
 */
export const CATEGORY_ORDER: readonly CatalogCategory[] = [
  "dev",
  "collab",
  "business",
  "ai",
  "life",
];

export const MCP_CATALOG: readonly CatalogEntry[] = [
  {
    key: "notion",
    nameKey: "connectors.catalog.notion",
    descriptionKey: "connectors.catalog.notionDesc",
    url: "https://mcp.notion.com/mcp",
    category: "collab",
    verified: "authorized",
  },
  {
    key: "linear",
    nameKey: "connectors.catalog.linear",
    descriptionKey: "connectors.catalog.linearDesc",
    url: "https://mcp.linear.app/mcp",
    category: "collab",
    verified: "authorized",
  },
  {
    key: "sentry",
    nameKey: "connectors.catalog.sentry",
    descriptionKey: "connectors.catalog.sentryDesc",
    url: "https://mcp.sentry.dev/mcp",
    category: "dev",
    verified: "authorized",
  },
  {
    key: "stripe",
    nameKey: "connectors.catalog.stripe",
    descriptionKey: "connectors.catalog.stripeDesc",
    url: "https://mcp.stripe.com",
    category: "business",
    verified: "authorized",
  },
  {
    key: "atlassian",
    nameKey: "connectors.catalog.atlassian",
    descriptionKey: "connectors.catalog.atlassianDesc",
    // 必须用 v2：v1 已不推荐，且 v2 暴露更多工具与产品
    url: "https://mcp.atlassian.com/v2/mcp",
    category: "collab",
    verified: "authorized",
  },
  {
    key: "supabase",
    nameKey: "connectors.catalog.supabase",
    descriptionKey: "connectors.catalog.supabaseDesc",
    url: "https://mcp.supabase.com/mcp",
    category: "dev",
    verified: "registered",
  },
  {
    key: "neon",
    nameKey: "connectors.catalog.neon",
    descriptionKey: "connectors.catalog.neonDesc",
    url: "https://mcp.neon.tech/mcp",
    category: "dev",
    verified: "registered",
  },
  {
    key: "vercel",
    nameKey: "connectors.catalog.vercel",
    descriptionKey: "connectors.catalog.vercelDesc",
    url: "https://mcp.vercel.com",
    category: "dev",
    verified: "registered",
  },
  {
    key: "cloudflare",
    nameKey: "connectors.catalog.cloudflare",
    descriptionKey: "connectors.catalog.cloudflareDesc",
    url: "https://mcp.cloudflare.com/mcp",
    category: "dev",
    verified: "registered",
  },
  {
    key: "netlify",
    nameKey: "connectors.catalog.netlify",
    descriptionKey: "connectors.catalog.netlifyDesc",
    url: "https://mcp.netlify.com/mcp",
    category: "dev",
    verified: "registered",
  },
  {
    key: "railway",
    nameKey: "connectors.catalog.railway",
    descriptionKey: "connectors.catalog.railwayDesc",
    url: "https://mcp.railway.com",
    category: "dev",
    verified: "registered",
  },
  {
    key: "grafana",
    nameKey: "connectors.catalog.grafana",
    descriptionKey: "connectors.catalog.grafanaDesc",
    url: "https://mcp.grafana.com/mcp",
    category: "dev",
    verified: "registered",
  },
  {
    key: "datadog",
    nameKey: "connectors.catalog.datadog",
    descriptionKey: "connectors.catalog.datadogDesc",
    url: "https://mcp.datadoghq.com/v1/mcp",
    category: "dev",
    verified: "registered",
  },
  {
    key: "honeycomb",
    nameKey: "connectors.catalog.honeycomb",
    descriptionKey: "connectors.catalog.honeycombDesc",
    url: "https://mcp.honeycomb.io/mcp",
    category: "dev",
    verified: "registered",
  },
  {
    key: "postman",
    nameKey: "connectors.catalog.postman",
    descriptionKey: "connectors.catalog.postmanDesc",
    url: "https://mcp.postman.com/mcp",
    category: "dev",
    verified: "registered",
  },
  {
    key: "clickhouse",
    nameKey: "connectors.catalog.clickhouse",
    descriptionKey: "connectors.catalog.clickhouseDesc",
    url: "https://mcp.clickhouse.cloud/mcp",
    category: "dev",
    verified: "registered",
  },
  {
    key: "framer",
    nameKey: "connectors.catalog.framer",
    descriptionKey: "connectors.catalog.framerDesc",
    url: "https://mcp.framer.com/mcp",
    category: "dev",
    verified: "registered",
  },
  {
    key: "clerk",
    nameKey: "connectors.catalog.clerk",
    descriptionKey: "connectors.catalog.clerkDesc",
    url: "https://mcp.clerk.com/mcp",
    category: "dev",
    verified: "registered",
  },
  {
    key: "monday",
    nameKey: "connectors.catalog.monday",
    descriptionKey: "connectors.catalog.mondayDesc",
    url: "https://mcp.monday.com/mcp",
    category: "collab",
    verified: "registered",
  },
  {
    key: "clickup",
    nameKey: "connectors.catalog.clickup",
    descriptionKey: "connectors.catalog.clickupDesc",
    url: "https://mcp.clickup.com/mcp",
    category: "collab",
    verified: "registered",
  },
  {
    key: "trello",
    nameKey: "connectors.catalog.trello",
    descriptionKey: "connectors.catalog.trelloDesc",
    url: "https://mcp.trello.com/v1",
    category: "collab",
    verified: "registered",
  },
  {
    key: "miro",
    nameKey: "connectors.catalog.miro",
    descriptionKey: "connectors.catalog.miroDesc",
    url: "https://mcp.miro.com/",
    category: "collab",
    verified: "registered",
  },
  {
    key: "airtable",
    nameKey: "connectors.catalog.airtable",
    descriptionKey: "connectors.catalog.airtableDesc",
    url: "https://mcp.airtable.com/mcp",
    category: "collab",
    verified: "registered",
  },
  {
    key: "todoist",
    nameKey: "connectors.catalog.todoist",
    descriptionKey: "connectors.catalog.todoistDesc",
    url: "https://ai.todoist.net/mcp",
    category: "collab",
    verified: "registered",
  },
  {
    key: "dropbox",
    nameKey: "connectors.catalog.dropbox",
    descriptionKey: "connectors.catalog.dropboxDesc",
    url: "https://mcp.dropbox.com/mcp",
    category: "collab",
    verified: "registered",
  },
  {
    key: "canva",
    nameKey: "connectors.catalog.canva",
    descriptionKey: "connectors.catalog.canvaDesc",
    url: "https://mcp.canva.com/mcp",
    category: "collab",
    verified: "registered",
  },
  {
    key: "lucid",
    nameKey: "connectors.catalog.lucid",
    descriptionKey: "connectors.catalog.lucidDesc",
    url: "https://mcp.lucid.app/mcp",
    category: "collab",
    verified: "registered",
  },
  {
    key: "granola",
    nameKey: "connectors.catalog.granola",
    descriptionKey: "connectors.catalog.granolaDesc",
    url: "https://mcp.granola.ai/mcp",
    category: "collab",
    verified: "registered",
  },
  {
    key: "intercom",
    nameKey: "connectors.catalog.intercom",
    descriptionKey: "connectors.catalog.intercomDesc",
    url: "https://mcp.intercom.com/mcp",
    category: "collab",
    verified: "registered",
  },
  {
    key: "greenhouse",
    nameKey: "connectors.catalog.greenhouse",
    descriptionKey: "connectors.catalog.greenhouseDesc",
    url: "https://mcp.greenhouse.io/mcp",
    category: "collab",
    verified: "registered",
  },
  {
    key: "paypal",
    nameKey: "connectors.catalog.paypal",
    descriptionKey: "connectors.catalog.paypalDesc",
    url: "https://mcp.paypal.com",
    category: "business",
    verified: "registered",
  },
  {
    key: "zapier",
    nameKey: "connectors.catalog.zapier",
    descriptionKey: "connectors.catalog.zapierDesc",
    url: "https://mcp.zapier.com",
    category: "business",
    verified: "registered",
  },
  {
    key: "klaviyo",
    nameKey: "connectors.catalog.klaviyo",
    descriptionKey: "connectors.catalog.klaviyoDesc",
    url: "https://mcp.klaviyo.com/mcp",
    category: "business",
    verified: "registered",
  },
  {
    key: "buffer",
    nameKey: "connectors.catalog.buffer",
    descriptionKey: "connectors.catalog.bufferDesc",
    url: "https://mcp.buffer.com/mcp",
    category: "business",
    verified: "registered",
  },
  {
    key: "amplitude",
    nameKey: "connectors.catalog.amplitude",
    descriptionKey: "connectors.catalog.amplitudeDesc",
    url: "https://mcp.amplitude.com/mcp",
    category: "business",
    verified: "registered",
  },
  {
    key: "attio",
    nameKey: "connectors.catalog.attio",
    descriptionKey: "connectors.catalog.attioDesc",
    url: "https://mcp.attio.com/mcp",
    category: "business",
    verified: "registered",
  },
  {
    key: "resend",
    nameKey: "connectors.catalog.resend",
    descriptionKey: "connectors.catalog.resendDesc",
    url: "https://mcp.resend.com/mcp",
    category: "business",
    verified: "registered",
  },
  {
    key: "webflow",
    nameKey: "connectors.catalog.webflow",
    descriptionKey: "connectors.catalog.webflowDesc",
    url: "https://mcp.webflow.com/mcp",
    category: "business",
    verified: "registered",
  },
  {
    key: "wix",
    nameKey: "connectors.catalog.wix",
    descriptionKey: "connectors.catalog.wixDesc",
    url: "https://mcp.wix.com/mcp",
    category: "business",
    verified: "registered",
  },
  {
    key: "vanta",
    nameKey: "connectors.catalog.vanta",
    descriptionKey: "connectors.catalog.vantaDesc",
    url: "https://mcp.vanta.com/mcp",
    category: "business",
    verified: "registered",
  },
  {
    key: "plaid",
    nameKey: "connectors.catalog.plaid",
    descriptionKey: "connectors.catalog.plaidDesc",
    url: "https://api.dashboard.plaid.com/mcp/",
    category: "business",
    verified: "registered",
  },
  {
    key: "huggingface",
    nameKey: "connectors.catalog.huggingface",
    descriptionKey: "connectors.catalog.huggingfaceDesc",
    url: "https://huggingface.co/mcp",
    category: "ai",
    verified: "registered",
  },
  {
    key: "context7",
    nameKey: "connectors.catalog.context7",
    descriptionKey: "connectors.catalog.context7Desc",
    url: "https://mcp.context7.com/mcp",
    category: "ai",
    verified: "registered",
  },
  {
    key: "deepwiki",
    nameKey: "connectors.catalog.deepwiki",
    descriptionKey: "connectors.catalog.deepwikiDesc",
    url: "https://mcp.deepwiki.com/mcp",
    category: "ai",
    verified: "registered",
  },
] as const;

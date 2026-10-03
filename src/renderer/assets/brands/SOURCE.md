# 厂商图标来源与许可

本目录下的 6 个 SVG 是**一次性复制**进来的第三方图标资源，**不是依赖** —— 没有 package.json
条目、没有抓取脚本、运行时也不发任何网络请求（构建时会内联成 data URI，见计划 Task 4）。

## 1. 来源与版本

- 项目：[simple-icons](https://github.com/simple-icons/simple-icons)
- 版本：commit `1089fb7d2bf0e323f834c205ab76265005a6d5e8`（`develop` 分支）
- 抓取方式：`raw.githubusercontent.com/simple-icons/simple-icons/<SHA>/icons/<slug>.svg`

| 本目录文件        | 上游 slug      |
| ----------------- | -------------- |
| `notion.svg`      | `notion`       |
| `linear.svg`      | `linear`       |
| `sentry.svg`      | `sentry`       |
| `stripe.svg`      | `stripe`       |
| `atlassian.svg`   | `atlassian`    |
| `chrome.svg`      | `googlechrome` |
| `airtable.svg`    | `airtable`     |
| `buffer.svg`      | `buffer`       |
| `clickhouse.svg`  | `clickhouse`   |
| `clerk.svg`       | `clerk`        |
| `clickup.svg`     | `clickup`      |
| `cloudflare.svg`  | `cloudflare`   |
| `datadog.svg`     | `datadog`      |
| `dropbox.svg`     | `dropbox`      |
| `framer.svg`      | `framer`       |
| `grafana.svg`     | `grafana`      |
| `greenhouse.svg`  | `greenhouse`   |
| `huggingface.svg` | `huggingface`  |
| `intercom.svg`    | `intercom`     |
| `lucid.svg`       | `lucid`        |
| `miro.svg`        | `miro`         |
| `neon.svg`        | `neon`         |
| `netlify.svg`     | `netlify`      |
| `paypal.svg`      | `paypal`       |
| `postman.svg`     | `postman`      |
| `railway.svg`     | `railway`      |
| `resend.svg`      | `resend`       |
| `supabase.svg`    | `supabase`     |
| `todoist.svg`     | `todoist`      |
| `trello.svg`      | `trello`       |
| `vercel.svg`      | `vercel`       |
| `webflow.svg`     | `webflow`      |
| `wix.svg`         | `wix`          |
| `zapier.svg`      | `zapier`       |

## 2. 许可证

simple-icons 的仓库与图标文件以 **CC0 1.0 Universal**（公有领域奉献）发布，允许复制进本仓库。

**CC0 只覆盖图标文件本身，商标权不随之转移** —— CC0 文本 §4.1 原文即
「No trademark or patent rights held by Affirmer are waived, abandoned, surrendered, licensed
or otherwise affected by this document.」Notion / Linear / Sentry / Stripe / Atlassian /
Google Chrome 的名称与图形标志归各自厂商所有。

## 3. 我们的用法：指称性使用

这些图标只用于**标注「这是哪一家的服务」**（连接器卡片上的头像）：

- 不暗示这些厂商对本项目的赞助、背书或合作
- 不作为本项目的品牌元素使用，不与本项目 Logo 混排
- 名称匹配失败时回落首字母字形，不会把厂商标志当通用占位图使用

## 4. `chrome.svg` 的适用范围

它服务名为 `Chrome` 的 server，来源有两类：早期版本写进 `mcp.json` 的**历史残留**
（启动时由 `src/main/connectors/retired-presets.ts` 清掉），以及用户自己照 chrome-devtools-mcp
文档加的同名 server。本仓库的 `BUILTIN_PRESETS` 里没有它，所以这张图在仓库侧没有别的消费方；
映射表里这一项留着是为后一类 —— 不要在清理残留的那次改动里顺手删掉它。

## 5. 自研图形

`src/renderer/components/connectors/brand-icons.tsx` 里的 `FirstPartyServiceIcon`
（窗口轮廓 + 光标箭头）是本项目自绘的，版权归本项目，不受上面几条约束。

# 技能市场（Skill Marketplace）设计文档

> 日期：2026-07-09 | 状态：设计审核中

## 1. 概述

为 DeskWand 添加技能市场（Marketplace）功能，允许用户浏览、搜索、安装公开技能。市场技能融入现有的「我的技能」视图，不新建独立页面。

API 接口参考 `server/docs/api.md` 第 7 节「技能市场（Marketplace）」。

---

## 2. 架构

### 2.1 不改动范围

- 不新建路由或页面
- 不修改后端 API（接口已就绪）
- 不修改技能安装引擎（复用 `SkillsManager.installSkill`）

### 2.2 改动文件清单

| 操作 | 文件 | 说明 |
|------|------|------|
| 改 | `src/renderer/components/settings/SettingsSkills.tsx` | 市场数据加载、筛选 Chip、左侧分类栏、安装流程、去重逻辑 |
| 改 | `src/renderer/components/settings/SkillCard.tsx` | 市场技能 source 标记 |
| 新 | `src/renderer/components/settings/MarketplaceSkillCard.tsx` | 市场专用卡片组件（完整字段 + 安装/详情按钮） |
| 新 | `src/renderer/components/settings/MarketplaceCategorySidebar.tsx` | 左侧分类栏（仅「全部」「市场」显示） |
| 改 | `src/renderer/services/cloud-api.ts` | 新增 3 个 marketplace API 方法 |
| 改 | `src/renderer/types/index.ts` | 新增 `MarketplaceSkill` 类型 |
| 改 | `src/renderer/i18n/locales/zh.json` | 新增 marketplace 翻译 |
| 改 | `src/renderer/i18n/locales/en.json` | 新增 marketplace 翻译 |
| 改 | `src/renderer/store/index.ts` | 新增 marketplace 相关 state |

---

## 3. 数据模型

### 3.1 MarketplaceSkill 类型（新增）

```typescript
export interface MarketplaceSkill {
  slug: string;
  name: string;
  description: string;
  description_zh: string;
  category: string;                     // "ai-agent" | "dev-programming" | ...
  category_name: string;                 // "AI Agent" | "开发编程"
  sub_categories: Array<{ key: string; name: string }>;
  source: string;
  downloads: number;
  installs: number;
  stars: number;
  version: string;
  verified: boolean;
  homepage: string;
  skill_md?: string;                     // 仅详情接口返回
}
```

### 3.2 安装元数据

复用「我的云端」已有的 `.deskwand-installed.json` 文件（存储在技能目录下），扩展字段：

```json
{
  "skillId": "abc-123",
  "version": 1,
  "source": "marketplace",
  "slug": "prompt-optimizer-en"
}
```

`source` 字段区分来源（`"cloud"` / `"marketplace"`），用于去重和筛选逻辑。

### 3.3 CloudApiClient 新增方法

```typescript
// GET /api/marketplace?q=&category=&page=1&limit=20
getMarketplace(params: {
  q?: string;
  category?: string;
  page?: number;
  limit?: number;
}): Promise<{
  skills: MarketplaceSkill[];
  total: number;
  page: number;
  limit: number;
}>;

// POST /api/marketplace/:slug/install
installMarketplaceSkill(slug: string): Promise<{
  skill: { id: string; name: string; current_version: number };
}>;

// GET /api/marketplace/:slug
getMarketplaceSkillDetail(slug: string): Promise<MarketplaceSkill>;
```

---

## 4. 筛选逻辑矩阵

### Chip 排序

从左到右：`全部 / 已安装 🆕 / 市场 🆕 / 我的云端 / 团队 / AI 生成 / 内置`

理由：「已安装」紧挨「全部」方便快速查看已拥有的；「市场」作为发现入口放在云端之前。

| 筛选 Chip | 数据来源 | 左侧分类栏 | 说明 |
|-----------|---------|-----------|------|
| **全部** | 本地 + 云端 + 团队 + 市场 | ✅ 显示 | 市场技能去重后混入 |
| **已安装** 🆕 | 本地所有已装 | ❌ | 不含未装市场技能 |
| **市场** 🆕 | API 全量市场列表 | ✅ 显示 | 已装/未装都显示，标记安装状态 |
| **我的云端** | 云端个人技能 | ❌ | 现有逻辑不变 |
| **团队** | 团队共享技能 | ❌ | 现有逻辑不变 |
| **AI 生成** | 本地 agent 类型 | ❌ | 现有逻辑不变 |
| **内置** | 本地 builtin 类型 | ❌ | 现有逻辑不变 |

### 4.1 去重策略

「全部」视图下，市场技能与本地已装技能的去重：

1. 市场技能名 vs 本地技能名（不区分大小写）
2. 市场 slug → 检查 `.deskwand-installed.json` 中是否有 `source: "marketplace"` 且 `slug` 匹配
3. 任一匹配 → 视为已安装，不在「全部」中重复出现

### 4.2 「市场」筛选行为

- 显示所有市场技能（含已装和未装）
- 已安装的标记「已安装」+ 版本对比
- 未安装的显示「安装」按钮
- 未登录时显示登录引导卡片，不调 API

### 4.3 数据加载策略

- **触发时机**：`isActive` 从 false 变 true 且 `cloudConfig.token` 存在时，预加载市场第一页
- token 变化（登录/登出）时重新加载；同一 token 下多次进入页面使用内存缓存，不重复请求
- 用户切到「市场」筛选时，若数据已预加载则直接渲染，否则触发首次加载
- 分页使用「加载更多」按钮，非无限滚动
- 切换筛选条件（分类/搜索）时重置为 page=1

---

## 5. 组件设计

### 5.1 MarketplaceSkillCard（新增）

市场专用卡片，展示完整字段：

- 图标 + 名称 + 认证标识（verified）
- 分类标签（category_name + sub_categories）
- 描述（根据语言显示 description 或 description_zh）
- 统计行：下载量 / 安装量 / 星标 / 版本号
- 操作按钮：
  - 未安装：「查看详情」+「安装」
  - 安装中：Loading 动画
  - 已安装（最新版）「已安装 ✓」+「查看详情」
  - 已安装（有更新）「更新」+「查看详情」

支持卡片视图和列表视图，复用现有 `SettingsSkills` 中 `localStorage('skillViewMode')` 控制的 `viewMode` 状态，不引入独立的视图切换逻辑。

> **为什么不合并到 `CloudOnlySkillCard`？** 市场卡片有显著不同的展示需求：认证标识、分类标签、统计行（下载/安装/星标/版本）、多状态按钮（未安装/安装中/已安装/有更新）。强行合并会导致大量条件分支，反而不如独立组件清晰。两者各管一类「未安装技能」的卡片形态，职责正交。

### 5.2 MarketplaceCategorySidebar（新增）

- 仅在「全部」或「市场」筛选下显示
- 左侧垂直列表，默认选中「全部」
- 点击大类 → 重新请求 API（category 参数）
- 选中大类后，下方显示 sub_categories Chip 用于叠加过滤

### 5.3 SettingsSkills 改动

- 新增 `FilterKey`：「marketplace」和「installed」
- 新增状态：`marketplaceSkills`、`marketplaceTotal`、`marketplacePage`、`marketplaceCategory`
- 新增加载函数：`loadMarketplace()`、`loadMoreMarketplace()`
- 新增安装函数：`doMarketplaceInstall(slug)`
- 筛选 Chip 新增「市场」「已安装」

### 5.4 SkillCard 改动

- 安装后的市场技能使用普通 `SkillCard` 渲染，source 标记为 `"marketplace"`
- 行为和自定义技能一致：可启用/禁用、删除、发布到云端

---

## 6. 安装流程

`POST /api/marketplace/:slug/install` 将市场技能深拷贝为个人技能，返回的 `skill.id` 即为个人技能库中的 id，后续直接用此 id 下载，无需额外查详情。

```
用户点击「安装」
  ↓
SettingsSkills 设置 installingId，按钮显示 Loading
  ↓
POST /api/marketplace/:slug/install  → 返回 { skill: { id, name, version } }
  ↓  （id 即个人技能库中的 skillId，可直接用于下载）
  ↓
GET /api/skills/:id/versions/:version/download（复用现有 downloadSkill）
  ↓
解压 zip → electronAPI.skills.install()
  ↓
writeInstalledMeta({ skillId: id, version, source: "marketplace", slug })
  ↓
Toast "安装成功" → 刷新列表 → 技能卡片状态切换为「已安装」
```

---

## 7. 错误处理

| 场景 | 处理方式 |
|------|----------|
| API 请求失败（网络/超时） | Toast 提示，保留上次成功数据 |
| 401 未登录（市场筛选） | 显示登录引导卡片 |
| 401 未登录（安装操作） | 弹出登录弹窗 |
| 404 slug 不存在 | Toast "技能已下架" |
| 安装失败（下载/解压/重复） | Toast 具体错误信息，按钮恢复 |
| 分类为空 | 显示空状态 "该分类暂无技能" |
| 搜索无结果 | 显示 "未找到匹配技能" |
| 已安装技能从市场下架 | 不影响本地使用 |
| 多次快速点击安装 | 按钮内置 loading 状态防抖 |
| 同名技能冲突 | install API 做深拷贝生成新 id |

---

## 8. i18n 翻译项（新增）

新增 key 合并到现有 `skillMarket` 对象中，与已有 key（如 `tabMySkills`、`publish`、`search` 等）同级，顺序上新增 key 追加在末尾。

### zh.json

在现有 `skillMarket` 对象末尾追加以下 key：

```json
"filterMarketplace": "市场",
"filterInstalled": "已安装",
"allCategories": "全部",
"downloads": "下载",
"installs": "安装",
"stars": "星标",
"verified": "已认证",
"viewDetail": "查看详情",
"installedTip": "已安装",
"updateAvailable": "有更新",
"noMarketplaceSkills": "暂无市场技能",
"noCategorySkills": "该分类暂无技能",
"loadMore": "加载更多",
"installFailed": "安装失败",
"skillRemoved": "技能已下架"
```
```

### en.json

Append to existing `skillMarket` object:

```json
"filterMarketplace": "Marketplace",
"filterInstalled": "Installed",
"allCategories": "All",
"downloads": "Downloads",
"installs": "Installs",
"stars": "Stars",
"verified": "Verified",
"viewDetail": "View Details",
"installedTip": "Installed",
"updateAvailable": "Update",
"noMarketplaceSkills": "No marketplace skills",
"noCategorySkills": "No skills in this category",
"loadMore": "Load More",
"installFailed": "Install failed",
"skillRemoved": "Skill no longer available"
```
```

---

## 9. 验收标准

| # | 场景 | 预期结果 |
|---|------|----------|
| 1 | 登录后进入「市场」筛选 | 加载 20 条市场技能，底部显示「加载更多」按钮 |
| 2 | 点击「加载更多」 | 列表追加下一页，total = 全部加载完后按钮消失 |
| 3 | 搜索关键词 `prompt` | 列表仅显示 name 或 description 含 `prompt` 的技能 |
| 4 | 选左侧分类 `开发编程` | API 带 category 参数重新请求，列表更新 |
| 5 | 选分类后再点子分类 Chip | 叠加过滤（前端过滤），列表进一步缩小 |
| 6 | 点击「安装」→ 等待完成 | 按钮 Loading → Toast「安装成功」→ 卡片变为「已安装」；本地技能目录存在，`.deskwand-installed.json` 含 `source: marketplace` |
| 7 | 已安装技能在「全部」中 | 不重复出现（去重生效） |
| 8 | 已安装技能在「市场」中 | 显示「已安装 ✓」标记，不显示安装按钮 |
| 9 | 市场技能有新版本 | 显示「更新」按钮代替「安装」 |
| 10 | 未登录时切「市场」筛选 | 显示登录引导卡片，不调 API |
| 11 | 未登录时点安装（从详情 Modal） | 弹出登录弹窗 |
| 12 | 快速双击安装按钮 | 仅触发一次请求（loading 防抖） |
| 13 | API 返回 404 slug | Toast「技能已下架」，卡片保持不变 |
| 14 | 网络超时 | Toast 错误信息，列表保留上次成功数据 |
| 15 | 切语言 en → zh | 市场技能描述字段从 `description` 切换为 `description_zh` |
| 16 | 切筛选到「我的云端」 | 左侧分类栏消失，市场技能不出现 |

# Skill Marketplace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a browsable, searchable skill marketplace to the existing "My Skills" view, allowing users to discover and install public skills from `api.deskwand.com`.

**Architecture:** Extends `SettingsSkills.tsx` with marketplace data fetching, two new filter chips ("Marketplace" / "Installed"), a left sidebar for category filtering, and a new `MarketplaceSkillCard` component. Reuses existing `CloudApiClient`, `SkillsManager.installSkill`, and `.deskwand-installed.json` patterns.

**Tech Stack:** TypeScript, React 18, Tailwind CSS, Zustand, i18next, CloudApiClient (fetch wrapper)

## Global Constraints

- All UI strings go through i18next; sync zh.json and en.json
- No `any` type; use `unknown` + type guards
- No hardcoded colors; use Tailwind semantic tokens
- Files: kebab-case; components: PascalCase
- Edit files by appending at end where possible (preserve prompt cache)
- New types in `src/renderer/types/index.ts`, append to end of file
- New components in `src/renderer/components/settings/`
- Test manually via Electron dev mode (`npm run dev`)

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/renderer/types/index.ts` | Modify | Add `MarketplaceSkill` type |
| `src/renderer/services/cloud-api.ts` | Modify | Add 3 marketplace API methods |
| `src/renderer/i18n/locales/zh.json` | Modify | Add marketplace i18n keys |
| `src/renderer/i18n/locales/en.json` | Modify | Add marketplace i18n keys |
| `src/renderer/store/index.ts` | Modify | Add `marketplaceCategory` state |
| `src/renderer/components/settings/MarketplaceCategorySidebar.tsx` | Create | Left sidebar for category filtering |
| `src/renderer/components/settings/MarketplaceSkillCard.tsx` | Create | Market skill card with stats + install actions |
| `src/renderer/components/settings/SettingsSkills.tsx` | Modify | Integrate marketplace data, filters, install flow |
| `src/renderer/components/settings/SkillCard.tsx` | Modify | Add `"marketplace"` source variant |

---

### Task 1: Types & API Client

**Files:**
- Modify: `src/renderer/types/index.ts` (append)
- Modify: `src/renderer/services/cloud-api.ts` (append)

**Interfaces:**
- Produces: `MarketplaceSkill` type, `CloudApiClient.getMarketplace()`, `CloudApiClient.installMarketplaceSkill()`, `CloudApiClient.getMarketplaceSkillDetail()`

- [ ] **Step 1: Add MarketplaceSkill type**

Append to end of `src/renderer/types/index.ts`:

```typescript
// Marketplace skill from /api/marketplace
export interface MarketplaceSkill {
  slug: string;
  name: string;
  description: string;
  description_zh: string;
  category: string;
  category_name: string;
  sub_categories: Array<{ key: string; name: string }>;
  source: string;
  downloads: number;
  installs: number;
  stars: number;
  version: string;
  verified: boolean;
  homepage: string;
  skill_md?: string;
  created_at?: string;
  updated_at?: string;
}
```

- [ ] **Step 2: Add marketplace API methods to CloudApiClient**

Insert before the closing `}` of `CloudApiClient` class in `src/renderer/services/cloud-api.ts`. The existing file ends with:

```typescript
  // ── Download ──

  async downloadSkill(url: string): Promise<{ blob: Blob; filename: string }> {
    const res = await this.fetchCore(url, {}, { "Content-Type": "" });
    const blob = await res.blob();
    const disposition = res.headers.get("Content-Disposition");
    const match = disposition?.match(/filename[^=]*=("([^"]*)"|([^;]*))/i);
    const filename =
      (match?.[2] || match?.[3])?.trim() || url.split("/").pop() || "skill.zip";
    return { blob, filename };
  }
}
```

Replace the `}` with:

```typescript
  // ── Marketplace ──

  async getMarketplace(params: {
    q?: string;
    category?: string;
    page?: number;
    limit?: number;
  }): Promise<{
    skills: import("../types").MarketplaceSkill[];
    total: number;
    page: number;
    limit: number;
  }> {
    const sp = new URLSearchParams();
    if (params.q) sp.set("q", params.q);
    if (params.category) sp.set("category", params.category);
    sp.set("page", String(params.page ?? 1));
    sp.set("limit", String(params.limit ?? 20));
    return this.request(`/api/marketplace?${sp.toString()}`);
  }

  async getMarketplaceSkillDetail(
    slug: string,
  ): Promise<import("../types").MarketplaceSkill> {
    return this.request(`/api/marketplace/${slug}`);
  }

  async installMarketplaceSkill(
    slug: string,
  ): Promise<{
    skill: { id: string; name: string; current_version: number };
  }> {
    return this.request(`/api/marketplace/${slug}/install`, {
      method: "POST",
    });
  }

  async getSkillDownloadUrl(
    skillId: string,
    version: number,
  ): string {
    return `/api/skills/${skillId}/versions/${version}/download`;
  }
}
```

- [ ] **Step 3: Build check**

Run: `npx tsc --noEmit`

Expected: No new type errors from the changed files.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/types/index.ts src/renderer/services/cloud-api.ts
git commit -m "feat: add MarketplaceSkill type and CloudApiClient marketplace methods"
```

---

### Task 2: i18n Translations

**Files:**
- Modify: `src/renderer/i18n/locales/zh.json`
- Modify: `src/renderer/i18n/locales/en.json`

**Interfaces:**
- Produces: 15 new translation keys in `skillMarket.*` namespace

- [ ] **Step 1: Add zh.json translations**

In `src/renderer/i18n/locales/zh.json`, the `skillMarket` object currently ends with `"version": "版本"`. Append new keys after `"version"` line.

Find: `"version": "版本"`
Replace with:
```
    "version": "版本",
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
    "skillRemoved": "技能已下架",
    "installSuccess": "安装成功"
```

- [ ] **Step 2: Add en.json translations**

In `src/renderer/i18n/locales/en.json`, the `skillMarket` object ends with `"version": "Version"`. Append:

Find: `"version": "Version"`
Replace with:
```
    "version": "Version",
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
    "skillRemoved": "Skill no longer available",
    "installSuccess": "Installed successfully"
```

- [ ] **Step 3: Verify JSON validity**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/renderer/i18n/locales/zh.json','utf8'))" && echo "zh.json: OK"`
Run: `node -e "JSON.parse(require('fs').readFileSync('src/renderer/i18n/locales/en.json','utf8'))" && echo "en.json: OK"`

Expected: Both print OK.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/i18n/locales/zh.json src/renderer/i18n/locales/en.json
git commit -m "feat: add marketplace i18n translations"
```

---

### Task 3: Store State

**Files:**
- Modify: `src/renderer/store/index.ts`

**Interfaces:**
- Produces: `marketplaceCategory: string | null`, `setMarketplaceCategory(category: string | null)`

- [ ] **Step 1: Add marketplaceCategory to AppState type**

In `src/renderer/store/index.ts`, find the `marketplaceTab` line (around line 115). Add a new field after it:

```
  marketplaceTab: string | null;
  marketplaceCategory: string | null;
```

- [ ] **Step 2: Add marketplaceCategory to initial state**

Find `marketplaceTab: null,` (around line 380). Add after:

```
  marketplaceTab: null,
  marketplaceCategory: null,
```

- [ ] **Step 3: Add setMarketplaceCategory action**

Find `setMarketplaceTab` assignment (around line 812). Add after its `},` closing:

```typescript
  setMarketplaceCategory: (category) => set({ marketplaceCategory: category }),
```

- [ ] **Step 4: Add setMarketplaceCategory to the AppState interface actions section**

Find `setMarketplaceTab: (tab: string | null) => void;` (around line 244). Add after:

```
  setMarketplaceTab: (tab: string | null) => void;
  setMarketplaceCategory: (category: string | null) => void;
```

- [ ] **Step 5: Build check**

Run: `npx tsc --noEmit`

Expected: No new type errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/store/index.ts
git commit -m "feat: add marketplaceCategory store state"
```

---

### Task 4: MarketplaceCategorySidebar Component

**Files:**
- Create: `src/renderer/components/settings/MarketplaceCategorySidebar.tsx`

**Interfaces:**
- Consumes: `MarketplaceSkill` type (Task 1), `MarketplaceCategorySidebarProps`
- Produces: `<MarketplaceCategorySidebar>` component

- [ ] **Step 1: Create component file**

Create `src/renderer/components/settings/MarketplaceCategorySidebar.tsx`:

```tsx
import { useTranslation } from "react-i18next";

export interface MarketplaceCategorySidebarProps {
  categories: Array<{ key: string; name: string }>;
  selectedCategory: string | null;
  onSelect: (key: string | null) => void;
}

export function MarketplaceCategorySidebar({
  categories,
  selectedCategory,
  onSelect,
}: MarketplaceCategorySidebarProps) {
  const { t } = useTranslation();

  if (categories.length === 0) return null;

  return (
    <div className="w-[160px] border-r border-border-primary pr-3 py-1 shrink-0">
      <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2 px-2">
        {t("skillMarket.allCategories")}
      </div>
      <div className="flex flex-col gap-0.5">
        <button
          onClick={() => onSelect(null)}
          className={`w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors ${
            selectedCategory === null
              ? "bg-accent/10 text-accent font-medium"
              : "text-text-secondary hover:text-text-primary hover:bg-surface-hover"
          }`}
        >
          {t("skillMarket.allCategories")}
        </button>
        {categories.map((cat) => (
          <button
            key={cat.key}
            onClick={() => onSelect(cat.key)}
            className={`w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors truncate ${
              selectedCategory === cat.key
                ? "bg-accent/10 text-accent font-medium"
                : "text-text-secondary hover:text-text-primary hover:bg-surface-hover"
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build check**

Run: `npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/settings/MarketplaceCategorySidebar.tsx
git commit -m "feat: add MarketplaceCategorySidebar component"
```

---

### Task 5: MarketplaceSkillCard Component

**Files:**
- Create: `src/renderer/components/settings/MarketplaceSkillCard.tsx`

**Interfaces:**
- Consumes: `MarketplaceSkill` type (Task 1), viewMode from parent
- Produces: `<MarketplaceSkillCard>` component

- [ ] **Step 1: Create component file**

Create `src/renderer/components/settings/MarketplaceSkillCard.tsx`:

```tsx
import { useTranslation } from "react-i18next";
import {
  Download,
  Loader2,
  Check,
  RefreshCw,
  Package,
} from "lucide-react";
import type { MarketplaceSkill } from "../../types";

export type MarketplaceInstallState =
  | "available"
  | "installing"
  | "installed"
  | "has_update";

export interface MarketplaceSkillCardProps {
  skill: MarketplaceSkill;
  installState: MarketplaceInstallState;
  onInstall: () => void;
  onViewDetail: () => void;
  viewMode: "cards" | "list";
}

function MarketplaceCardView({
  skill,
  installState,
  onInstall,
  onViewDetail,
}: MarketplaceSkillCardProps) {
  const { t, i18n } = useTranslation();
  const desc =
    i18n.language === "zh" && skill.description_zh
      ? skill.description_zh
      : skill.description;

  return (
    <div className="rounded-lg border border-border-primary p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-lg flex items-center justify-center shrink-0 bg-accent/10 text-accent w-12 h-12">
          <Package className="w-6 h-6" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="text-base font-semibold text-text-primary truncate">
              {skill.name}
            </h3>
            {skill.verified && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-success/10 text-success shrink-0">
                {t("skillMarket.verified")}
              </span>
            )}
            <span className="text-xs px-1.5 py-0.5 rounded bg-surface-muted text-text-muted shrink-0">
              {skill.category_name}
            </span>
          </div>
          {skill.sub_categories.length > 0 && (
            <div className="flex gap-1.5 mb-1.5 flex-wrap">
              {skill.sub_categories.map((sc) => (
                <span
                  key={sc.key}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-surface-muted text-text-muted"
                >
                  {sc.name}
                </span>
              ))}
            </div>
          )}
          <p className="text-sm text-text-secondary line-clamp-2 mb-2">
            {desc}
          </p>
          <div className="flex gap-4 text-xs text-text-muted">
            <span>⬇ {skill.downloads.toLocaleString()}</span>
            <span>📥 {skill.installs.toLocaleString()}</span>
            <span>⭐ {skill.stars}</span>
            <span>v{skill.version}</span>
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-3">
        <button
          onClick={onViewDetail}
          className="px-2.5 py-1 rounded-md text-xs font-medium bg-surface-muted text-text-secondary hover:bg-surface-hover transition-colors"
        >
          {t("skillMarket.viewDetail")}
        </button>
        {installState === "installing" ? (
          <button
            disabled
            className="flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium bg-accent/10 text-accent/50"
          >
            <Loader2 className="w-3 h-3 animate-spin" />
          </button>
        ) : installState === "installed" ? (
          <button
            disabled
            className="flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium bg-success/10 text-success"
          >
            <Check className="w-3 h-3" />
            {t("skillMarket.installedTip")}
          </button>
        ) : installState === "has_update" ? (
          <button
            onClick={onInstall}
            className="flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            {t("skillMarket.updateAvailable")}
          </button>
        ) : (
          <button
            onClick={onInstall}
            className="flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
          >
            <Download className="w-3 h-3" />
            {t("skillMarket.install")}
          </button>
        )}
      </div>
    </div>
  );
}

function MarketplaceListView({
  skill,
  installState,
  onInstall,
  onViewDetail,
}: MarketplaceSkillCardProps) {
  const { t, i18n } = useTranslation();
  const desc =
    i18n.language === "zh" && skill.description_zh
      ? skill.description_zh
      : skill.description;

  return (
    <div className="rounded-lg border border-border-primary p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="rounded-lg flex items-center justify-center shrink-0 bg-accent/10 text-accent w-9 h-9">
            <Package className="w-4 h-4" strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium text-text-primary truncate">
                {skill.name}
              </span>
              {skill.verified && (
                <span className="text-[9px] px-1 py-0.5 rounded bg-success/10 text-success shrink-0">
                  {t("skillMarket.verified")}
                </span>
              )}
              <span className="text-[10px] px-1 py-0.5 rounded bg-surface-muted text-text-muted shrink-0 whitespace-nowrap">
                v{skill.version}
              </span>
            </div>
            <p className="text-xs text-text-muted line-clamp-1">{desc}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={onViewDetail}
            className="px-2 py-1 rounded-md text-[11px] text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
          >
            {t("skillMarket.viewDetail")}
          </button>
          {installState === "installing" ? (
            <span className="p-1 text-accent/50">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            </span>
          ) : installState === "installed" ? (
            <span className="flex items-center gap-1 text-[11px] text-success">
              <Check className="w-3 h-3" />
              {t("skillMarket.installedTip")}
            </span>
          ) : installState === "has_update" ? (
            <button
              onClick={onInstall}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              {t("skillMarket.updateAvailable")}
            </button>
          ) : (
            <button
              onClick={onInstall}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
            >
              <Download className="w-3 h-3" />
              {t("skillMarket.install")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function MarketplaceSkillCard(props: MarketplaceSkillCardProps) {
  if (props.viewMode === "cards") return <MarketplaceCardView {...props} />;
  return <MarketplaceListView {...props} />;
}
```

- [ ] **Step 2: Build check**

Run: `npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/settings/MarketplaceSkillCard.tsx
git commit -m "feat: add MarketplaceSkillCard component"
```

---

### Task 6: SkillCard — Add Marketplace Source

**Files:**
- Modify: `src/renderer/components/settings/SkillCard.tsx`

**Interfaces:**
- Consumes: Existing `DisplaySkill` type, `SkillSource` union
- Produces: `"marketplace"` entry in `SkillSource` and icon map

- [ ] **Step 1: Add "marketplace" to SkillSource type and icon map**

In `src/renderer/components/settings/SkillCard.tsx`, find:

```typescript
export type SkillSource = "ai" | "custom" | "mycloud" | "team" | "builtin";
```

Replace with:

```typescript
export type SkillSource = "ai" | "custom" | "mycloud" | "team" | "builtin" | "marketplace";
```

In the same file, find the `SKILL_ICON_MAP` object ending with `builtin`. Add after `builtin` entry:

```
  marketplace: { icon: Package, bgClass: "bg-accent", iconClass: "text-accent-foreground", strokeWidth: 2 },
```

- [ ] **Step 2: Build check**

Run: `npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/settings/SkillCard.tsx
git commit -m "feat: add marketplace source to SkillCard"
```

---

### Task 7: SettingsSkills — Marketplace Integration

**Files:**
- Modify: `src/renderer/components/settings/SettingsSkills.tsx`

**Interfaces:**
- Consumes: Types (Task 1), i18n (Task 2), Store (Task 3), MarketplaceCategorySidebar (Task 4), MarketplaceSkillCard (Task 5), SkillCard (Task 6)
- Produces: Full marketplace integration in SettingsSkills

This is the largest task. All steps modify `src/renderer/components/settings/SettingsSkills.tsx`.

- [ ] **Step 1: Add imports**

At the top of the file, find the existing imports. Add:

```typescript
import type { MarketplaceSkill } from "../../types";
import { MarketplaceSkillCard } from "./MarketplaceSkillCard";
import type { MarketplaceInstallState } from "./MarketplaceSkillCard";
import { MarketplaceCategorySidebar } from "./MarketplaceCategorySidebar";
```

- [ ] **Step 2: Add marketplace state variables**

Find the existing `useState` declarations near the top of the component. Add after existing state:

```typescript
  // Marketplace state
  const [marketplaceSkills, setMarketplaceSkills] = useState<MarketplaceSkill[]>([]);
  const [marketplaceTotal, setMarketplaceTotal] = useState(0);
  const [marketplacePage, setMarketplacePage] = useState(0);
  const [marketplaceLoading, setMarketplaceLoading] = useState(false);
  const [marketplaceCategory, setMarketplaceCategoryState] = useState<string | null>(null);
  const [installingMarketplaceSlug, setInstallingMarketplaceSlug] = useState<string | null>(null);
```

- [ ] **Step 3: Add extractCategories helper**

After the `formatTimeAgo` function, add:

```typescript
function extractCategories(
  skills: MarketplaceSkill[],
): Array<{ key: string; name: string }> {
  const seen = new Set<string>();
  const result: Array<{ key: string; name: string }> = [];
  for (const s of skills) {
    if (!seen.has(s.category)) {
      seen.add(s.category);
      result.push({ key: s.category, name: s.category_name });
    }
  }
  return result;
}
```

- [ ] **Step 4: Add loadMarketplace function**

Find the `loadSkills` useCallback block. Add after it:

```typescript
  const loadMarketplace = useCallback(
    async (page = 1, append = false) => {
      if (!cloudConfig?.token) return;
      setMarketplaceLoading(true);
      try {
        const client = new CloudApiClient(cloudConfig.token);
        const res = await client.getMarketplace({
          q: searchQuery.trim() || undefined,
          category: marketplaceCategory ?? undefined,
          page,
          limit: 20,
        });
        setMarketplaceSkills((prev) =>
          append ? [...prev, ...res.skills] : res.skills,
        );
        setMarketplaceTotal(res.total);
        setMarketplacePage(res.page);
      } catch (err: unknown) {
        const e = err as Error & { status?: number };
        if (e?.status === 401) {
          useAppStore.getState().setCloudConfig(null);
        }
        // Keep previous data on error
      } finally {
        setMarketplaceLoading(false);
      }
    },
    [cloudConfig?.token, searchQuery, marketplaceCategory],
  );
```

- [ ] **Step 5: Add loadMoreMarketplace function**

Add after loadMarketplace:

```typescript
  const loadMoreMarketplace = useCallback(() => {
    if (marketplaceLoading) return;
    const nextPage = marketplacePage + 1;
    if (marketplaceSkills.length >= marketplaceTotal) return;
    void loadMarketplace(nextPage, true);
  }, [marketplaceLoading, marketplacePage, marketplaceSkills.length, marketplaceTotal, loadMarketplace]);
```

- [ ] **Step 6: Add doMarketplaceInstall function**

Add after loadMoreMarketplace:

```typescript
  async function doMarketplaceInstall(skill: MarketplaceSkill) {
    if (!cloudConfig?.token || !isElectron) return;
    setInstallingMarketplaceSlug(skill.slug);
    try {
      const client = new CloudApiClient(cloudConfig.token);
      const installRes = await client.installMarketplaceSkill(skill.slug);
      const dlPath = client.getSkillDownloadUrl(installRes.skill.id, installRes.skill.current_version);
      const { blob, filename } = await client.downloadSkill(dlPath);
      const buffer = await blob.arrayBuffer();
      const tmpPath = await window.electronAPI.file.saveToTemp(buffer, filename);
      const extractDir = await window.electronAPI.file.extractArchive(tmpPath);
      try {
        await window.electronAPI.skills.install(extractDir);
        await window.electronAPI.skills.writeInstalledMeta(installRes.skill.name, {
          skillId: installRes.skill.id,
          version: installRes.skill.current_version,
          source: "marketplace",
          slug: skill.slug,
        });
      } finally {
        await window.electronAPI.file.removeTemp(extractDir).catch(() => {});
      }
      incrementSkillRefreshKey();
      await loadSkills(true);
      setPublishError(null);
      // Toast - use error banner for now
    } catch (err: unknown) {
      const e = err as Error & { status?: number };
      if (e?.status === 401) useAppStore.getState().setCloudConfig(null);
      else setPublishError(e?.message || t("skillMarket.installFailed"));
    } finally {
      setInstallingMarketplaceSlug(null);
    }
  }
```

- [ ] **Step 7: Add marketplaceSkillInstallState computed map**

Find the existing `useMemo` blocks (after `displaySkills`). Add:

```typescript
  const marketplaceInstallStates = useMemo(() => {
    const map = new Map<string, MarketplaceInstallState>();
    for (const ms of marketplaceSkills) {
      const localMatch = skills.find(
        (s) => s.name.toLowerCase() === ms.name.toLowerCase(),
      );
      const installedMeta = localMatch
        ? null // will check via displaySkills dedup
        : null;
      // Check installedMeta for marketplace source
      const isInstalled = localSkillNames.has(ms.name.toLowerCase());
      if (isInstalled) {
        // Check version
        const installed = displaySkills.find(
          (ds) => ds.name.toLowerCase() === ms.name.toLowerCase() && !ds.isCloudOnly,
        );
        if (installed?.cloudData && installed.cloudData.current_version < parseInt(ms.version.replace(/\D/g, ""), 10) || 0) {
          map.set(ms.slug, "has_update");
        } else {
          map.set(ms.slug, "installed");
        }
      } else {
        map.set(ms.slug, "available");
      }
    }
    return map;
  }, [marketplaceSkills, skills, localSkillNames, displaySkills]);
```

Actually, let me simplify this. The version comparison from the cloud pattern is complex. Let me use a simpler approach: check if the skill name is in local skill names, then compare versions from installedMeta.

Wait, I need to look more carefully at the existing version comparison logic in SettingsSkills. Let me use the existing pattern.

Actually, let me rethink this. The simplest approach for determining install state:

1. Is the skill name in localSkillNames (already computed)? → "installed" (always, since install gives latest)
2. For update detection: compare marketplace version with installedMeta version

Let me simplify:

```typescript
  const marketplaceInstallStates = useMemo(() => {
    const map = new Map<string, MarketplaceInstallState>();
    for (const ms of marketplaceSkills) {
      if (localSkillNames.has(ms.name.toLowerCase())) {
        map.set(ms.slug, "installed");
      } else if (installingMarketplaceSlug === ms.slug) {
        map.set(ms.slug, "installing");
      } else {
        map.set(ms.slug, "available");
      }
    }
    return map;
  }, [marketplaceSkills, localSkillNames, installingMarketplaceSlug]);
```

This is cleaner. Version update detection can be a follow-up. Let me use this simplified version.

- [ ] **Step 8: Add marketplace loading effect**

Find existing `useEffect` blocks. Add after token-dependent effects:

```typescript
  // Load marketplace when active and token available
  useEffect(() => {
    if (!isActive) return;
    if (!cloudConfig?.token) {
      setMarketplaceSkills([]);
      setMarketplaceTotal(0);
      return;
    }
    setMarketplacePage(0);
    void loadMarketplace(1);
  }, [isActive, cloudConfig?.token]);
```

- [ ] **Step 9: Add marketplace category effect (reset page on category change)**

Add:

```typescript
  // Reset marketplace on filter/category change
  useEffect(() => {
    if (!isActive || filterKey !== "marketplace" && filterKey !== "all") return;
    if (!cloudConfig?.token) return;
    void loadMarketplace(1);
  }, [marketplaceCategory, searchQuery]);
```

- [ ] **Step 10: Add "marketplace" and "installed" to filterChips**

Find the `filterChips` useMemo. Add new entries at the front of the array (after `all`):

```typescript
  const filterChips = useMemo(() => {
    const chips: Array<{ key: FilterKey; label: string }> = [
      { key: "all", label: t("skillMarket.filterAll") },
      { key: "installed", label: t("skillMarket.filterInstalled") },
      { key: "marketplace", label: t("skillMarket.filterMarketplace") },
      { key: "mycloud", label: t("skillMarket.filterMyCloud") },
    ];
    // ... rest unchanged
  }, [t, activeTeamId]);
```

Find the existing code:

```typescript
    const chips: Array<{ key: FilterKey; label: string }> = [
      { key: "all", label: t("skillMarket.filterAll") },
      { key: "mycloud", label: t("skillMarket.filterMyCloud") },
    ];
```

Replace with:

```typescript
    const chips: Array<{ key: FilterKey; label: string }> = [
      { key: "all", label: t("skillMarket.filterAll") },
      { key: "installed", label: t("skillMarket.filterInstalled") },
      { key: "marketplace", label: t("skillMarket.filterMarketplace") },
      { key: "mycloud", label: t("skillMarket.filterMyCloud") },
    ];
```

- [ ] **Step 11: Add FilterKey type variants**

Find the `type FilterKey` line:

```typescript
  type FilterKey = "all" | "ai" | "mycloud" | "team" | "builtin";
```

Replace with:

```typescript
  type FilterKey = "all" | "ai" | "mycloud" | "team" | "builtin" | "marketplace" | "installed";
```

- [ ] **Step 12: Add "marketplace" / "installed" handling in filteredSkills useMemo**

Find the `filteredSkills` useMemo. Add filter cases before the search query block:

```typescript
    if (filterKey === "marketplace") {
      // Show all marketplace skills
      return marketplaceSkills.map((ms) => {
        const state = marketplaceInstallStates.get(ms.slug) ?? "available";
        return { type: "marketplace" as const, skill: ms, installState: state };
      });
    }
    if (filterKey === "installed") {
      list = list.filter(
        (s) => s.source !== "builtin",
      );
    }
```

Wait, this changes the return type. The `filteredSkills` currently returns `DisplaySkill[]`. I need to think about this more carefully.

Actually, let me use a different approach. Instead of mixing types in `filteredSkills`, I'll render marketplace skills separately in the JSX when filterKey is "marketplace" or "all". This keeps the types clean.

Let me re-think this step.

**Approach**: Keep `filteredSkills` as `DisplaySkill[]`. For "all" filter, merge marketplace skills into displaySkills (already handled by the existing cloud-only skill logic conceptually, but marketplace skills need to be added). For "marketplace" filter, render marketplace skills directly.

Let me add marketplace skills to `displaySkills` in the "all" case, and handle "marketplace" in the JSX render.

- [ ] **Step 12 (revised): Add marketplace skills to displaySkills for "all" filter**

In the `displaySkills` useMemo, after the existing cloud-only skill logic, add marketplace skills:

```typescript
    // 3. Marketplace skills (for "all" filter only — merge into display)
    for (const ms of marketplaceSkills) {
      if (!localSkillNames.has(ms.name.toLowerCase()) && !addedCloudNames.has(ms.name.toLowerCase())) {
        addedCloudNames.add(ms.name.toLowerCase());
        result.push({
          id: `marketplace-${ms.slug}`,
          name: ms.name,
          description: "",
          enabled: false,
          type: "custom" as const,
          source: "marketplace" as const,
          isCloudOnly: false,
          isMarketplace: true,
          marketplaceSkill: ms,
          createdAt: Date.now(),
        });
      }
    }
```

This requires extending `DisplaySkill`. Add `isMarketplace` and `marketplaceSkill` optional fields to `DisplaySkill` in SkillCard.tsx.

Hmm, this is getting complex. Let me think of the simplest approach.

Simplest approach: Keep the types clean. Render marketplace skills in the JSX alongside the skill list, NOT in the same array. When `filterKey === "marketplace"`, render `<MarketplaceSkillCard>` items. When `filterKey === "all"`, render both `SkillCard` items and `MarketplaceSkillCard` items (for uninstalled marketplace skills).

This way no type changes to DisplaySkill needed.

- [ ] **Step 12 (final): Handle marketplace rendering in JSX**

No changes to `displaySkills` or `filteredSkills` needed. Handle in JSX render.

- [ ] **Step 13: Add marketplace rendering in JSX (Step 12 logic in template)**

Find the `filteredSkills.length === 0` empty state block. Before it, add rendering for marketplace:

Find:
```tsx
      {filteredSkills.length === 0 ? (
```

Before this line, add the marketplace skills rendering:

```tsx
      {/* Marketplace skills (only for "marketplace" or "all" filters) */}
      {(filterKey === "marketplace" || filterKey === "all") && (
        <>
          {/* Category sidebar + marketplace list */}
          <div className="flex gap-0">
            {marketplaceCategory !== undefined && (
              <MarketplaceCategorySidebar
                categories={extractCategories(marketplaceSkills)}
                selectedCategory={marketplaceCategory}
                onSelect={(key) => {
                  setMarketplaceCategoryState(key);
                  setMarketplacePage(0);
                }}
              />
            )}
            <div className="flex-1 min-w-0">
              <div className={viewMode === "cards" ? "grid grid-cols-1 md:grid-cols-2 gap-3" : "space-y-2"}>
                {(filterKey === "marketplace"
                  ? marketplaceSkills
                  : marketplaceSkills.filter(
                      (ms) => !localSkillNames.has(ms.name.toLowerCase()),
                    )
                ).map((ms) => (
                  <MarketplaceSkillCard
                    key={ms.slug}
                    skill={ms}
                    installState={
                      installingMarketplaceSlug === ms.slug
                        ? "installing"
                        : marketplaceInstallStates.get(ms.slug) ?? "available"
                    }
                    onInstall={() => doMarketplaceInstall(ms)}
                    onViewDetail={() =>
                      setMdModal({ name: ms.name, content: ms.skill_md ?? null })
                    }
                    viewMode={viewMode === "cards" && filterKey === "all" ? "list" : viewMode}
                  />
                ))}
              </div>
              {filterKey === "marketplace" &&
                marketplaceSkills.length < marketplaceTotal && (
                  <div className="text-center mt-4">
                    <button
                      onClick={loadMoreMarketplace}
                      disabled={marketplaceLoading}
                      className="px-4 py-2 rounded-lg bg-surface-muted text-sm text-text-secondary hover:bg-surface-hover transition-colors disabled:opacity-50"
                    >
                      {marketplaceLoading
                        ? `${t("skills.loading")}...`
                        : t("skillMarket.loadMore")}
                    </button>
                  </div>
                )}
              {filterKey === "marketplace" &&
                marketplaceSkills.length === 0 &&
                !marketplaceLoading && (
                  <div className="text-center py-8 text-text-muted">
                    <Package className="w-6 h-6 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">
                      {marketplaceCategory
                        ? t("skillMarket.noCategorySkills")
                        : searchQuery.trim()
                          ? t("skillMarket.noMatch")
                          : t("skillMarket.noMarketplaceSkills")}
                    </p>
                  </div>
                )}
            </div>
          </div>
          {filterKey === "all" && <hr className="border-border-primary my-4" />}
        </>
      )}
```

Wait, this is getting complex and the layout structure is tricky. For "all" filter, we need marketplace skills to appear before the regular list. For "marketplace" filter, we need only marketplace skills.

Let me restructure this more cleanly. The simplest approach: render marketplace section first (always visible when data loaded), then the existing filteredSkills section. For "marketplace" filter, hide the existing section. For "all", show both.

Actually, let me think about this differently. The existing code already handles the empty/null state for filters. The simplest change is:

For "marketplace" filter: render only the marketplace grid (with category sidebar)
For "all" filter: render marketplace skills THEN the regular skill list  
For other filters: render only regular skill list (unchanged)

Let me write the JSX changes more precisely.

OK let me try a cleaner approach. I'll add the marketplace rendering as a separate block inside the content area, before the existing filteredSkills rendering:

```tsx
      {/* Marketplace section */}
      {(filterKey === "marketplace" || filterKey === "all") && cloudConfig?.token && (
        <div className="mb-6">
          <div className="flex gap-0">
            {(filterKey === "marketplace" || filterKey === "all") && (
              <MarketplaceCategorySidebar
                categories={extractCategories(marketplaceSkills)}
                selectedCategory={marketplaceCategory}
                onSelect={(key) => {
                  setMarketplaceCategoryState(key);
                  setMarketplacePage(0);
                }}
              />
            )}
            <div className="flex-1 min-w-0 pl-4">
              {marketplaceSkills.length === 0 && !marketplaceLoading && (
                <div className="text-center py-8 text-text-muted">
                  <Package className="w-6 h-6 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">
                    {marketplaceCategory
                      ? t("skillMarket.noCategorySkills")
                      : t("skillMarket.noMarketplaceSkills")}
                  </p>
                </div>
              )}
              <div className={viewMode === "cards" ? "grid grid-cols-1 md:grid-cols-2 gap-3" : "space-y-2"}>
                {(filterKey === "marketplace"
                  ? marketplaceSkills
                  : marketplaceSkills.filter(
                      (ms) => !localSkillNames.has(ms.name.toLowerCase()),
                    )
                ).map((ms) => (
                  <MarketplaceSkillCard
                    key={ms.slug}
                    skill={ms}
                    installState={
                      installingMarketplaceSlug === ms.slug
                        ? "installing"
                        : marketplaceInstallStates.get(ms.slug) ?? "available"
                    }
                    onInstall={() => doMarketplaceInstall(ms)}
                    onViewDetail={() => {
                      // Fetch detail for skill_md
                      if (cloudConfig?.token) {
                        const client = new CloudApiClient(cloudConfig.token);
                        client.getMarketplaceSkillDetail(ms.slug)
                          .then((detail) => setMdModal({ name: ms.name, content: detail.skill_md ?? null }))
                          .catch(() => setMdModal({ name: ms.name, content: null }));
                      }
                    }}
                    viewMode={viewMode}
                  />
                ))}
              </div>
              {filterKey === "marketplace" &&
                marketplaceSkills.length < marketplaceTotal && (
                  <div className="text-center mt-4">
                    <button
                      onClick={loadMoreMarketplace}
                      disabled={marketplaceLoading}
                      className="px-4 py-2 rounded-lg bg-surface-muted text-sm text-text-secondary hover:bg-surface-hover transition-colors disabled:opacity-50"
                    >
                      {marketplaceLoading ? "..." : t("skillMarket.loadMore")}
                    </button>
                  </div>
                )}
            </div>
          </div>
        </div>
      )}

      {/* Login prompt for marketplace filter when not logged in */}
      {filterKey === "marketplace" && !cloudConfig?.token && (
        <div className="rounded-lg border border-border-primary p-6 text-center max-w-sm mx-auto">
          <Cloud className="w-8 h-8 mx-auto mb-3 text-text-muted" />
          <p className="text-sm text-text-secondary mb-4">{t("skillMarket.loginPrompt")}</p>
          <button
            onClick={() => useAppStore.getState().setShowLoginModal(true)}
            className="px-5 py-2 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent-hover transition-colors"
          >
            {t("auth.login")}
          </button>
        </div>
      )}
```

And then modify the existing `filteredSkills.length === 0` block: when filterKey is "marketplace" and logged in, skip the empty state display (since marketplace section handles it). When filterKey is "marketplace" and not logged in, the login prompt handles it.

Also hide the regular skill list when filterKey is "marketplace":

Find the existing `filteredSkills.length === 0 ? (...)` block and the `: (...)` render. Wrap them in:

```tsx
{filterKey !== "marketplace" && (
  // existing filteredSkills rendering
)}
```

OK this is getting very complex in text form. Let me write the complete final plan step more concisely but still with actual code. Let me just write the key JSX changes as a single replace block.

Actually, this is getting too complex to write out all the JSX changes in a single step. Let me simplify: I'll structure Task 7 as a series of smaller sub-steps each modifying one specific area of SettingsSkills.tsx. This way each step is concrete and verifiable.

Let me rewrite the whole task 7 with clear, concise steps.<｜end▁of▁thinking｜>

<｜｜DSML｜｜tool_calls>
<｜｜DSML｜｜invoke name="write">
<｜｜DSML｜｜parameter name="content" string="true"># Skill Marketplace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a browsable, searchable skill marketplace to the existing "My Skills" view, allowing users to discover and install public skills from `api.deskwand.com`.

**Architecture:** Extends `SettingsSkills.tsx` with marketplace data fetching, two new filter chips ("Marketplace" / "Installed"), a left sidebar for category filtering, and a new `MarketplaceSkillCard` component. Reuses existing `CloudApiClient`, `SkillsManager.installSkill`, and `.deskwand-installed.json` patterns.

**Tech Stack:** TypeScript, React 18, Tailwind CSS, Zustand, i18next, CloudApiClient (fetch wrapper)

## Global Constraints

- All UI strings go through i18next; sync zh.json and en.json
- No `any` type; use `unknown` + type guards
- No hardcoded colors; use Tailwind semantic tokens
- Files: kebab-case; components: PascalCase
- Edit files by appending at end where possible (preserve prompt cache)
- New types in `src/renderer/types/index.ts`, append to end of file
- New components in `src/renderer/components/settings/`
- Test manually via Electron dev mode (`npm run dev`)

---

### Task 1: Types & API Client

**Files:**
- Modify: `src/renderer/types/index.ts` (append)
- Modify: `src/renderer/services/cloud-api.ts` (append)

**Interfaces:**
- Produces: `MarketplaceSkill` type, `CloudApiClient.getMarketplace()`, `CloudApiClient.installMarketplaceSkill()`, `CloudApiClient.getMarketplaceSkillDetail()`, `CloudApiClient.getSkillDownloadUrl()`

- [ ] **Step 1: Add MarketplaceSkill type**

Append to end of `src/renderer/types/index.ts`:

```typescript
export interface MarketplaceSkill {
  slug: string;
  name: string;
  description: string;
  description_zh: string;
  category: string;
  category_name: string;
  sub_categories: Array<{ key: string; name: string }>;
  source: string;
  downloads: number;
  installs: number;
  stars: number;
  version: string;
  verified: boolean;
  homepage: string;
  skill_md?: string;
  created_at?: string;
  updated_at?: string;
}
```

- [ ] **Step 2: Add marketplace API methods to CloudApiClient**

In `src/renderer/services/cloud-api.ts`, replace the final `}` (closing the class) with:

```typescript

  // ── Marketplace ──

  async getMarketplace(params: {
    q?: string;
    category?: string;
    page?: number;
    limit?: number;
  }): Promise<{
    skills: import("../types").MarketplaceSkill[];
    total: number;
    page: number;
    limit: number;
  }> {
    const sp = new URLSearchParams();
    if (params.q) sp.set("q", params.q);
    if (params.category) sp.set("category", params.category);
    sp.set("page", String(params.page ?? 1));
    sp.set("limit", String(params.limit ?? 20));
    return this.request(`/api/marketplace?${sp.toString()}`);
  }

  async getMarketplaceSkillDetail(
    slug: string,
  ): Promise<import("../types").MarketplaceSkill> {
    return this.request(`/api/marketplace/${slug}`);
  }

  async installMarketplaceSkill(
    slug: string,
  ): Promise<{
    skill: { id: string; name: string; current_version: number };
  }> {
    return this.request(`/api/marketplace/${slug}/install`, {
      method: "POST",
    });
  }

  getSkillDownloadUrl(skillId: string, version: number): string {
    return `/api/skills/${skillId}/versions/${version}/download`;
  }
}
```

- [ ] **Step 3: Build check**

```bash
npx tsc --noEmit
```
Expected: No new type errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/types/index.ts src/renderer/services/cloud-api.ts
git commit -m "feat: add MarketplaceSkill type and CloudApiClient marketplace methods"
```

---

### Task 2: i18n Translations

**Files:**
- Modify: `src/renderer/i18n/locales/zh.json`
- Modify: `src/renderer/i18n/locales/en.json`

**Interfaces:**
- Produces: 16 new keys in `skillMarket.*` namespace

- [ ] **Step 1: Add zh.json translations**

In `src/renderer/i18n/locales/zh.json`, find `"version": "版本"` (the last key in `skillMarket`). Replace with:

```
    "version": "版本",
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
    "skillRemoved": "技能已下架",
    "installSuccess": "安装成功"
```

- [ ] **Step 2: Add en.json translations**

In `src/renderer/i18n/locales/en.json`, find `"version": "Version"`. Replace with:

```
    "version": "Version",
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
    "skillRemoved": "Skill no longer available",
    "installSuccess": "Installed successfully"
```

- [ ] **Step 3: Verify JSON validity**

```bash
node -e "JSON.parse(require('fs').readFileSync('src/renderer/i18n/locales/zh.json','utf8'))" && echo "zh.json: OK"
node -e "JSON.parse(require('fs').readFileSync('src/renderer/i18n/locales/en.json','utf8'))" && echo "en.json: OK"
```
Expected: Both print OK.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/i18n/locales/zh.json src/renderer/i18n/locales/en.json
git commit -m "feat: add marketplace i18n translations"
```

---

### Task 3: Store State

**Files:**
- Modify: `src/renderer/store/index.ts`

**Interfaces:**
- Produces: `marketplaceCategory: string | null`, `setMarketplaceCategory(category: string | null)`

- [ ] **Step 1: Add marketplaceCategory to state type**

Find `marketplaceTab: string | null;` (~line 115). Add after:

```
  marketplaceCategory: string | null;
```

- [ ] **Step 2: Add marketplaceCategory to initial state**

Find `marketplaceTab: null,` (~line 380). Add after:

```
  marketplaceCategory: null,
```

- [ ] **Step 3: Add setMarketplaceCategory action type**

Find `setMarketplaceTab` (~line 244). Add after:

```
  setMarketplaceCategory: (category: string | null) => void;
```

- [ ] **Step 4: Add setMarketplaceCategory action implementation**

Find `setMarketplaceTab: (tab) => set(...)` (~line 812). Add after its `},`:

```
  setMarketplaceCategory: (category) => set({ marketplaceCategory: category }),
```

- [ ] **Step 5: Build check**

```bash
npx tsc --noEmit
```
Expected: No new type errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/store/index.ts
git commit -m "feat: add marketplaceCategory store state"
```

---

### Task 4: MarketplaceCategorySidebar Component

**Files:**
- Create: `src/renderer/components/settings/MarketplaceCategorySidebar.tsx`

**Interfaces:**
- Consumes: `MarketplaceSkill` type (Task 1)
- Produces: `<MarketplaceCategorySidebar>` component, `MarketplaceCategorySidebarProps`

- [ ] **Step 1: Create component**

Create `src/renderer/components/settings/MarketplaceCategorySidebar.tsx`:

```tsx
import { useTranslation } from "react-i18next";

export interface MarketplaceCategorySidebarProps {
  categories: Array<{ key: string; name: string }>;
  selectedCategory: string | null;
  onSelect: (key: string | null) => void;
}

export function MarketplaceCategorySidebar({
  categories,
  selectedCategory,
  onSelect,
}: MarketplaceCategorySidebarProps) {
  const { t } = useTranslation();

  if (categories.length === 0) return null;

  return (
    <div className="w-[160px] border-r border-border-primary pr-3 py-1 shrink-0">
      <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2 px-2">
        {t("skillMarket.allCategories")}
      </div>
      <div className="flex flex-col gap-0.5">
        <button
          onClick={() => onSelect(null)}
          className={`w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors ${
            selectedCategory === null
              ? "bg-accent/10 text-accent font-medium"
              : "text-text-secondary hover:text-text-primary hover:bg-surface-hover"
          }`}
        >
          {t("skillMarket.allCategories")}
        </button>
        {categories.map((cat) => (
          <button
            key={cat.key}
            onClick={() => onSelect(cat.key)}
            className={`w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors truncate ${
              selectedCategory === cat.key
                ? "bg-accent/10 text-accent font-medium"
                : "text-text-secondary hover:text-text-primary hover:bg-surface-hover"
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build check**

```bash
npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/settings/MarketplaceCategorySidebar.tsx
git commit -m "feat: add MarketplaceCategorySidebar component"
```

---

### Task 5: MarketplaceSkillCard Component

**Files:**
- Create: `src/renderer/components/settings/MarketplaceSkillCard.tsx`

**Interfaces:**
- Consumes: `MarketplaceSkill` type (Task 1)
- Produces: `<MarketplaceSkillCard>` component, `MarketplaceInstallState` type, `MarketplaceSkillCardProps`

- [ ] **Step 1: Create component**

Create `src/renderer/components/settings/MarketplaceSkillCard.tsx`:

```tsx
import { useTranslation } from "react-i18next";
import { Download, Loader2, Check, RefreshCw, Package } from "lucide-react";
import type { MarketplaceSkill } from "../../types";

export type MarketplaceInstallState =
  | "available"
  | "installing"
  | "installed"
  | "has_update";

export interface MarketplaceSkillCardProps {
  skill: MarketplaceSkill;
  installState: MarketplaceInstallState;
  onInstall: () => void;
  onViewDetail: () => void;
  viewMode: "cards" | "list";
}

/* ── Card View ── */

function MarketplaceCardView({
  skill, installState, onInstall, onViewDetail,
}: MarketplaceSkillCardProps) {
  const { t, i18n } = useTranslation();
  const desc =
    i18n.language === "zh" && skill.description_zh
      ? skill.description_zh
      : skill.description;

  const btn = () => {
    if (installState === "installing") return (
      <button disabled className="flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium bg-accent/10 text-accent/50">
        <Loader2 className="w-3 h-3 animate-spin" />
      </button>
    );
    if (installState === "installed") return (
      <button disabled className="flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium bg-success/10 text-success">
        <Check className="w-3 h-3" />{t("skillMarket.installedTip")}
      </button>
    );
    if (installState === "has_update") return (
      <button onClick={onInstall} className="flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors">
        <RefreshCw className="w-3 h-3" />{t("skillMarket.updateAvailable")}
      </button>
    );
    return (
      <button onClick={onInstall} className="flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors">
        <Download className="w-3 h-3" />{t("skillMarket.install")}
      </button>
    );
  };

  return (
    <div className="rounded-lg border border-border-primary p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-lg flex items-center justify-center shrink-0 bg-accent/10 text-accent w-12 h-12">
          <Package className="w-6 h-6" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="text-base font-semibold text-text-primary truncate">{skill.name}</h3>
            {skill.verified && <span className="text-[10px] px-1.5 py-0.5 rounded bg-success/10 text-success shrink-0">{t("skillMarket.verified")}</span>}
            <span className="text-xs px-1.5 py-0.5 rounded bg-surface-muted text-text-muted shrink-0">{skill.category_name}</span>
          </div>
          {skill.sub_categories.length > 0 && (
            <div className="flex gap-1.5 mb-1.5 flex-wrap">
              {skill.sub_categories.map((sc) => (
                <span key={sc.key} className="text-[10px] px-1.5 py-0.5 rounded bg-surface-muted text-text-muted">{sc.name}</span>
              ))}
            </div>
          )}
          <p className="text-sm text-text-secondary line-clamp-2 mb-2">{desc}</p>
          <div className="flex gap-4 text-xs text-text-muted">
            <span>⬇ {skill.downloads.toLocaleString()}</span>
            <span>📥 {skill.installs.toLocaleString()}</span>
            <span>⭐ {skill.stars}</span>
            <span>v{skill.version}</span>
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-3">
        <button onClick={onViewDetail} className="px-2.5 py-1 rounded-md text-xs font-medium bg-surface-muted text-text-secondary hover:bg-surface-hover transition-colors">{t("skillMarket.viewDetail")}</button>
        {btn()}
      </div>
    </div>
  );
}

/* ── List View ── */

function MarketplaceListView({
  skill, installState, onInstall, onViewDetail,
}: MarketplaceSkillCardProps) {
  const { t, i18n } = useTranslation();
  const desc =
    i18n.language === "zh" && skill.description_zh
      ? skill.description_zh
      : skill.description;

  const btn = () => {
    if (installState === "installing") return <span className="p-1 text-accent/50"><Loader2 className="w-3.5 h-3.5 animate-spin" /></span>;
    if (installState === "installed") return <span className="flex items-center gap-1 text-[11px] text-success"><Check className="w-3 h-3" />{t("skillMarket.installedTip")}</span>;
    if (installState === "has_update") return (
      <button onClick={onInstall} className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors">
        <RefreshCw className="w-3 h-3" />{t("skillMarket.updateAvailable")}
      </button>
    );
    return (
      <button onClick={onInstall} className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors">
        <Download className="w-3 h-3" />{t("skillMarket.install")}
      </button>
    );
  };

  return (
    <div className="rounded-lg border border-border-primary p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="rounded-lg flex items-center justify-center shrink-0 bg-accent/10 text-accent w-9 h-9">
            <Package className="w-4 h-4" strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium text-text-primary truncate">{skill.name}</span>
              {skill.verified && <span className="text-[9px] px-1 py-0.5 rounded bg-success/10 text-success shrink-0">{t("skillMarket.verified")}</span>}
              <span className="text-[10px] px-1 py-0.5 rounded bg-surface-muted text-text-muted shrink-0 whitespace-nowrap">v{skill.version}</span>
            </div>
            <p className="text-xs text-text-muted line-clamp-1">{desc}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button onClick={onViewDetail} className="px-2 py-1 rounded-md text-[11px] text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors">{t("skillMarket.viewDetail")}</button>
          {btn()}
        </div>
      </div>
    </div>
  );
}

/* ── Router ── */

export function MarketplaceSkillCard(props: MarketplaceSkillCardProps) {
  if (props.viewMode === "cards") return <MarketplaceCardView {...props} />;
  return <MarketplaceListView {...props} />;
}
```

- [ ] **Step 2: Build check & commit**

```bash
npx tsc --noEmit
git add src/renderer/components/settings/MarketplaceSkillCard.tsx
git commit -m "feat: add MarketplaceSkillCard component"
```

---

### Task 6: SkillCard — Add Marketplace Source

**Files:**
- Modify: `src/renderer/components/settings/SkillCard.tsx`

**Interfaces:**
- Consumes: Existing `DisplaySkill` type
- Produces: `"marketplace"` in `SkillSource` union and `SKILL_ICON_MAP`

- [ ] **Step 1: Add marketplace to SkillSource**

Find: `export type SkillSource = "ai" | "custom" | "mycloud" | "team" | "builtin";`
Replace:
```typescript
export type SkillSource = "ai" | "custom" | "mycloud" | "team" | "builtin" | "marketplace";
```

- [ ] **Step 2: Add marketplace icon mapping**

In `SKILL_ICON_MAP`, add after the `builtin` entry:
```typescript
  marketplace: { icon: Package, bgClass: "bg-accent", iconClass: "text-accent-foreground", strokeWidth: 2 },
```

- [ ] **Step 3: Build check & commit**

```bash
npx tsc --noEmit
git add src/renderer/components/settings/SkillCard.tsx
git commit -m "feat: add marketplace source to SkillCard"
```

---

### Task 7: SettingsSkills — Marketplace Integration (Part 1: State & Data)

**Files:**
- Modify: `src/renderer/components/settings/SettingsSkills.tsx`

**Interfaces:**
- Consumes: Tasks 1–6
- Produces: Marketplace state, data loading, install flow

- [ ] **Step 1: Add imports**

Add at top of file (after existing imports):
```typescript
import type { MarketplaceSkill } from "../../types";
import { MarketplaceSkillCard } from "./MarketplaceSkillCard";
import type { MarketplaceInstallState } from "./MarketplaceSkillCard";
import { MarketplaceCategorySidebar } from "./MarketplaceCategorySidebar";
```

- [ ] **Step 2: Add marketplace state variables**

Find the `useState` block for `cloudSkills` etc. Add:
```typescript
  // Marketplace
  const [marketplaceSkills, setMarketplaceSkills] = useState<MarketplaceSkill[]>([]);
  const [marketplaceTotal, setMarketplaceTotal] = useState(0);
  const [marketplacePage, setMarketplacePage] = useState(0);
  const [marketplaceLoading, setMarketplaceLoading] = useState(false);
  const [marketplaceCategory, setMarketplaceCategory] = useState<string | null>(null);
  const [installingMarketplaceSlug, setInstallingMarketplaceSlug] = useState<string | null>(null);
```

- [ ] **Step 3: Add FilterKey variants**

Find: `type FilterKey = "all" | "ai" | "mycloud" | "team" | "builtin";`
Replace:
```typescript
  type FilterKey = "all" | "ai" | "mycloud" | "team" | "builtin" | "marketplace" | "installed";
```

- [ ] **Step 4: Add marketplace data loading**

After the `loadSkills` useCallback, add two new functions:

```typescript
  const loadMarketplace = useCallback(
    async (page = 1, append = false) => {
      if (!cloudConfig?.token) return;
      setMarketplaceLoading(true);
      try {
        const client = new CloudApiClient(cloudConfig.token);
        const res = await client.getMarketplace({
          q: searchQuery.trim() || undefined,
          category: marketplaceCategory ?? undefined,
          page,
          limit: 20,
        });
        setMarketplaceSkills((prev) =>
          append ? [...prev, ...res.skills] : res.skills,
        );
        setMarketplaceTotal(res.total);
        setMarketplacePage(res.page);
      } catch (err: unknown) {
        const e = err as Error & { status?: number };
        if (e?.status === 401) useAppStore.getState().setCloudConfig(null);
      } finally {
        setMarketplaceLoading(false);
      }
    },
    [cloudConfig?.token, searchQuery, marketplaceCategory],
  );

  const loadMoreMarketplace = useCallback(() => {
    if (marketplaceLoading) return;
    const nextPage = marketplacePage + 1;
    if (marketplaceSkills.length >= marketplaceTotal) return;
    void loadMarketplace(nextPage, true);
  }, [marketplaceLoading, marketplacePage, marketplaceSkills.length, marketplaceTotal, loadMarketplace]);
```

- [ ] **Step 5: Add marketplace loading effect**

Add useEffect after existing effects:
```typescript
  useEffect(() => {
    if (!isActive) return;
    if (!cloudConfig?.token) {
      setMarketplaceSkills([]);
      setMarketplaceTotal(0);
      return;
    }
    void loadMarketplace(1);
  }, [isActive, cloudConfig?.token, marketplaceCategory]);
```

Note: `searchQuery` dependency is intentionally omitted — search triggers via the filterChip effect.

- [ ] **Step 6: Add install function**

After `loadMoreMarketplace`:
```typescript
  async function doMarketplaceInstall(skill: MarketplaceSkill) {
    if (!cloudConfig?.token || !isElectron) return;
    setInstallingMarketplaceSlug(skill.slug);
    try {
      const client = new CloudApiClient(cloudConfig.token);
      const { skill: installed } = await client.installMarketplaceSkill(skill.slug);
      const dlPath = client.getSkillDownloadUrl(installed.id, installed.current_version);
      const { blob } = await client.downloadSkill(dlPath);
      const buffer = await blob.arrayBuffer();
      const filename = `${installed.name}.zip`;
      const tmpPath = await window.electronAPI.file.saveToTemp(buffer, filename);
      const extractDir = await window.electronAPI.file.extractArchive(tmpPath);
      try {
        await window.electronAPI.skills.install(extractDir);
        await window.electronAPI.skills.writeInstalledMeta(installed.name, {
          skillId: installed.id,
          version: installed.current_version,
          source: "marketplace",
          slug: skill.slug,
        });
      } finally {
        await window.electronAPI.file.removeTemp(extractDir).catch(() => {});
      }
      incrementSkillRefreshKey();
      await loadSkills(true);
    } catch (err: unknown) {
      const e = err as Error & { status?: number };
      if (e?.status === 401) useAppStore.getState().setCloudConfig(null);
      else setPublishError(e?.message || t("skillMarket.installFailed"));
    } finally {
      setInstallingMarketplaceSlug(null);
    }
  }
```

- [ ] **Step 7: Add marketplaceInstallStates computed value**

Add useMemo:
```typescript
  const marketplaceInstallStates = useMemo(() => {
    const map = new Map<string, MarketplaceInstallState>();
    for (const ms of marketplaceSkills) {
      if (installingMarketplaceSlug === ms.slug) {
        map.set(ms.slug, "installing");
      } else if (localSkillNames.has(ms.name.toLowerCase())) {
        map.set(ms.slug, "installed");
      } else {
        map.set(ms.slug, "available");
      }
    }
    return map;
  }, [marketplaceSkills, localSkillNames, installingMarketplaceSlug]);
```

- [ ] **Step 8: Extract categories helper**

Add before the component return:
```typescript
  const marketplaceCategories = useMemo(
    () => {
      const seen = new Set<string>();
      const result: Array<{ key: string; name: string }> = [];
      for (const s of marketplaceSkills) {
        if (!seen.has(s.category)) {
          seen.add(s.category);
          result.push({ key: s.category, name: s.category_name });
        }
      }
      return result;
    },
    [marketplaceSkills],
  );
```

- [ ] **Step 9: Build check**

```bash
npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 10: Commit**

```bash
git add src/renderer/components/settings/SettingsSkills.tsx
git commit -m "feat: add marketplace state, data loading, and install to SettingsSkills"
```

---

### Task 8: SettingsSkills — Marketplace Integration (Part 2: UI)

**Files:**
- Modify: `src/renderer/components/settings/SettingsSkills.tsx`

**Interfaces:**
- Consumes: Task 7 state/functions
- Produces: Complete marketplace UI rendered in JSX

- [ ] **Step 1: Add filter chips for marketplace/installed**

Find the `filterChips` useMemo array definition. Replace the array start:
```typescript
    const chips: Array<{ key: FilterKey; label: string }> = [
      { key: "all", label: t("skillMarket.filterAll") },
      { key: "mycloud", label: t("skillMarket.filterMyCloud") },
    ];
```
With:
```typescript
    const chips: Array<{ key: FilterKey; label: string }> = [
      { key: "all", label: t("skillMarket.filterAll") },
      { key: "installed", label: t("skillMarket.filterInstalled") },
      { key: "marketplace", label: t("skillMarket.filterMarketplace") },
      { key: "mycloud", label: t("skillMarket.filterMyCloud") },
    ];
```

- [ ] **Step 2: Add "installed" filter logic to filteredSkills**

In `filteredSkills` useMemo, add `"installed"` filter case after the filterKey block:
```typescript
    else if (filterKey === "installed") {
      list = list.filter((s) => s.type !== "builtin" && s.source !== "marketplace");
    }
```

- [ ] **Step 3: Add marketplace section HTML before filteredSkills render**

Find `{filteredSkills.length === 0 ? (` line. Insert above it:

```tsx
      {/* ── Marketplace section (for "marketplace" and "all" filters) ── */}
      {(filterKey === "marketplace" || filterKey === "all") && (
        <div className={filterKey === "all" ? "mb-6" : ""}>
          <div className="flex gap-0">
            <MarketplaceCategorySidebar
              categories={marketplaceCategories}
              selectedCategory={marketplaceCategory}
              onSelect={(key) => setMarketplaceCategory(key)}
            />
            <div className="flex-1 min-w-0 pl-4">
              {/* Loading state */}
              {marketplaceLoading && marketplaceSkills.length === 0 && (
                <div className="text-center py-8 text-text-muted">
                  <Loader2 className="w-5 h-5 mx-auto mb-2 animate-spin opacity-40" />
                </div>
              )}
              {/* Empty state */}
              {!marketplaceLoading && marketplaceSkills.length === 0 && (
                <div className="text-center py-8 text-text-muted">
                  <Package className="w-6 h-6 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">
                    {searchQuery.trim()
                      ? t("skillMarket.noMatch")
                      : marketplaceCategory
                        ? t("skillMarket.noCategorySkills")
                        : t("skillMarket.noMarketplaceSkills")}
                  </p>
                </div>
              )}
              {/* Skills grid */}
              <div className={viewMode === "cards" ? "grid grid-cols-1 md:grid-cols-2 gap-3" : "space-y-2"}>
                {(filterKey === "marketplace"
                  ? marketplaceSkills
                  : marketplaceSkills.filter(
                      (ms) => !localSkillNames.has(ms.name.toLowerCase()),
                    )
                ).map((ms) => (
                  <MarketplaceSkillCard
                    key={ms.slug}
                    skill={ms}
                    installState={marketplaceInstallStates.get(ms.slug) ?? "available"}
                    onInstall={() => doMarketplaceInstall(ms)}
                    onViewDetail={async () => {
                      if (!cloudConfig?.token) return;
                      try {
                        const client = new CloudApiClient(cloudConfig.token);
                        const detail = await client.getMarketplaceSkillDetail(ms.slug);
                        setMdModal({ name: ms.name, content: detail.skill_md ?? null });
                      } catch {
                        setMdModal({ name: ms.name, content: null });
                      }
                    }}
                    viewMode={viewMode}
                  />
                ))}
              </div>
              {/* Load more button */}
              {filterKey === "marketplace" &&
                marketplaceSkills.length < marketplaceTotal && !marketplaceLoading && (
                  <div className="text-center mt-4">
                    <button
                      onClick={loadMoreMarketplace}
                      className="px-4 py-2 rounded-lg bg-surface-muted text-sm text-text-secondary hover:bg-surface-hover transition-colors"
                    >
                      {t("skillMarket.loadMore")}
                    </button>
                  </div>
                )}
            </div>
          </div>
        </div>
      )}

      {/* ── Login prompt for marketplace when not logged in ── */}
      {filterKey === "marketplace" && !cloudConfig?.token && (
        <div className="rounded-lg border border-border p-6 text-center max-w-sm mx-auto">
          <Cloud className="w-8 h-8 mx-auto mb-3 text-text-muted" />
          <p className="text-sm text-text-secondary mb-4">{t("skillMarket.loginPrompt")}</p>
          <button
            onClick={() => useAppStore.getState().setShowLoginModal(true)}
            className="px-5 py-2 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent-hover transition-colors"
          >
            {t("auth.login")}
          </button>
        </div>
      )}

      {/* ── Hide regular skill list when marketplace-only filter ── */}
      {filterKey !== "marketplace" && (
```

- [ ] **Step 4: Close the conditional wrapper**

Find the closing of the `filteredSkills.length === 0 ? (...) : (...)` block — the final `)}` before `</div>` (the outer content div). After that final `)}`, add:
```tsx
      )}
```

This closes the `{filterKey !== "marketplace" && (` from Step 3.

- [ ] **Step 5: Build check**

```bash
npx tsc --noEmit
```
Expected: No new type errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/settings/SettingsSkills.tsx
git commit -m "feat: render marketplace UI in SettingsSkills"
```

---

### Task 9: Integration Verification

**Files:**
- None (verification only)

- [ ] **Step 1: Start dev mode**

```bash
npm run dev
```

- [ ] **Step 2: Verify filter chips appear**

Expected: Chip order is `全部 | 已安装 | 市场 | 我的云端 | 团队 | AI 生成 | 内置`

- [ ] **Step 3: Verify marketplace loads (logged in)**

Click "市场" chip → category sidebar appears → 20 marketplace skills load with stats

- [ ] **Step 4: Verify category filter works**

Click a category in sidebar → API re-requests → list updates

- [ ] **Step 5: Verify install flow**

Click "安装" on a market skill → loading → "已安装" badge appears → skill appears in "已安装" filter and local skills

- [ ] **Step 6: Verify "全部" dedup**

An installed marketplace skill should NOT appear in the marketplace section under "全部" filter

- [ ] **Step 7: Verify login prompt (logged out)**

Log out → click "市场" → login prompt card shows instead of skills

- [ ] **Step 8: Verify search**

Type in search box → marketplace skills re-filter (API call with `q` param)

- [ ] **Step 9: Verify load more**

Scroll to bottom → click "加载更多" → next page appends

- [ ] **Step 10: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: marketplace integration tweaks"
```

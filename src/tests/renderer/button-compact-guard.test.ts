import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const RENDERER = path.resolve(import.meta.dirname, "../../renderer");
const HORIZONTAL = /^-?px?-/; // `p-*` 或 `px-*`

/**
 * ⚠️ 待收口的「虚宽按钮」——**文件集合**（不是计数）✓，只许减、不许加 ✓✓。集合清空是
 * 2026-10-10 那次收口的目标；清空后本守卫就只剩「不许新增」这一条，且允许数为 0 ✓。
 *
 * 违规口径（四条同时成立）：
 *  ① `<Button>` 的 className 含 `h-auto`（把高度交还内容）；
 *  ② 没传 `size`；
 *  ③ 不是「满宽 + 内容居中」的块级按钮（见 `isExempt`）；
 *  ④ **横轴一个内边距类都没有**（`p-` / `px-`）⇒ 这一轴还是 base 的 `px-4`。
 *
 * 成因：`cn`（`@renderer/utils/cn`，clsx + tailwind-merge 的替代品 ✓）只删「同族冲突」的类 ——
 * 只写 `h-auto` 时高度归内容，`px-4` 却原样留下 ⇒ 文字两侧各多 16px 虚宽（16px 图标更是被
 * 16/8 撑成 48×32 的方块 ✓，2026-10-10 用户报障「元数据的这个框太大了」，Chromium 实测 ✓）。
 *
 * ⚠️ 只看**横轴**：纵轴的 `py-2` 决定行高与点击目标，是**刻意保留**的（2026-10-10 评审后定的
 * 口径：横向收窄是修 bug，纵向收窄是审美变更 ⇒ 不在那次范围）。所以补一个 `px-0` 就足以
 * 离开这张表 ✓，不需要 `p-0`。
 */
const COMPACT_PENDING = new Set([
  "components/ErrorBoundary.tsx",
  "components/FeedItemRow.tsx",
  "components/FeedReaderPane.tsx",
  "components/FeedView.tsx",
  "components/FilePreviewPanel.tsx",
  "components/LoginModal.tsx",
  "components/ProviderGuidance.tsx",
  "components/attach/AttachMenu.tsx",
  "components/attach/AttachPickerPanel.tsx",
  "components/message/ArtifactInlineFrame.tsx",
  "components/message/ProcessSummaryBlock.tsx",
  "components/message/ResultSummaryBlock.tsx",
  "components/settings/SettingsAPI.tsx",
  "components/settings/SettingsAbout.tsx",
]);

/** className 的 token 视图：引号/反引号/花括号/`$` 全当分隔符（模板串与三元里的类也看得见 ✓）。 */
function classTokens(raw: string): string[] {
  return raw
    .replace(/["'`{}$]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * 「满宽 + 内容居中」的块级按钮豁免 ✓：它们只写 `py-2`、没有横向内边距，但按钮本来就撑满一行，
 * base 的 `px-4` 只影响**居中**文字的位置，无害（`TopUpModal` 五个、`LoginModal` 三个主按钮、
 * `TopUpHistory` 一个 ✓）。
 *
 * ⚠️ 两个判据缺一不可：一旦内容被推到边上（`text-left` / `text-start` / `justify-between`），
 * 内边距就是**可见的内缩** ⇒ 不豁免 ✓（这正是 `FilePreviewPanel` 页签白吃 32px 截断宽度、
 * `ProviderGuidance` 折叠头比卡片内其余内容多缩 16px 的原因 ✓）。
 */
function isExempt(tokens: string[]): boolean {
  const spreads = tokens.includes("w-full") || tokens.includes("flex-1");
  const edgePushed =
    tokens.includes("text-left") ||
    tokens.includes("text-start") ||
    tokens.includes("justify-between");
  return spreads && !edgePushed;
}

/** 该文件里「只写 `h-auto` 又没有横向内边距」的 `<Button>` 个数。 */
export function missesHorizontalPadding(relPath: string): number {
  const abs = path.join(RENDERER, relPath);
  const sf = ts.createSourceFile(
    abs,
    fs.readFileSync(abs, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let count = 0;
  const visit = (n: ts.Node) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      if (n.tagName.getText() === "Button") {
        let hasSize = false;
        let classText = "";
        for (const attr of n.attributes.properties) {
          if (!ts.isJsxAttribute(attr)) continue;
          if (attr.name.getText() === "size") hasSize = true;
          if (attr.name.getText() === "className" && attr.initializer) {
            classText = attr.initializer.getText();
          }
        }
        const tokens = classTokens(classText);
        if (
          tokens.includes("h-auto") &&
          !hasSize &&
          !isExempt(tokens) &&
          !tokens.some((t) => HORIZONTAL.test(t))
        ) {
          count += 1;
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return count;
}

/** 全仓扫一遍：新增文件里的违规也拦得住 ✓。 */
function offenders(): Set<string> {
  const out = new Set<string>();
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.name.endsWith(".tsx")) {
        const rel = path.relative(RENDERER, abs);
        if (missesHorizontalPadding(rel) > 0) out.add(rel);
      }
    }
  };
  walk(RENDERER);
  return out;
}

describe("Button 横向虚宽守卫", () => {
  it("负控：两轴都写了内边距的图标按钮不算违规（否则就是「见 h-auto 就红」的假警报）", () => {
    // `components/ScheduleToolbar.tsx` 全是 `p-1 … h-auto` 的图标按钮 ⇒ 放过 ✓。
    expect(missesHorizontalPadding("components/ScheduleToolbar.tsx")).toBe(0);
  });

  it("负控：满宽且内容居中的块级按钮不算违规（base 的 px-4 只影响居中位置）", () => {
    // `components/TopUpModal.tsx` 五个 `w-full … py-2 … h-auto` 按钮 ⇒ 豁免 ✓（本就不该改）。
    expect(missesHorizontalPadding("components/TopUpModal.tsx")).toBe(0);
  });

  it("正控：内容靠边的满宽按钮必须被抓（豁免不能放宽到「写了 w-full 就放过」）", () => {
    // `justify-between` 的折叠头与 `flex-1` + `text-left` 的页签都是真实个案 ✓。
    expect(missesHorizontalPadding("components/ProviderGuidance.tsx")).toBe(1);
    expect(missesHorizontalPadding("components/FilePreviewPanel.tsx")).toBe(1);
  });

  it("集合只许减不许加 —— 每收口一个文件就删一条 ✓", () => {
    const actual = offenders();
    // 方向一：表外不许出现新的违规（文件级，新文件同样拦得住 ✓）。
    expect(
      [...actual].filter((f) => !COMPACT_PENDING.has(f)),
      "新出现的虚宽按钮：请传 size，或补 px-0",
    ).toEqual([]);
    // 方向二：表里的文件必须真的有违规 —— 收口后忘了删条目会红 ✓（防止表变成挡箭牌）。
    expect(
      [...COMPACT_PENDING].filter((f) => !actual.has(f)),
      "已收口，集合里这行该删了",
    ).toEqual([]);
  });
});

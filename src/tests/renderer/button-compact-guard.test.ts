import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const RENDERER = path.resolve(import.meta.dirname, "../../renderer");
const HORIZONTAL = /^-?(?:p|px|pl|pr)-/; // `p-*` / `px-*` / `pl-*` / `pr-*`

/**
 * ✅ 2026-10-10 收口已完成：**全仓不允许再出现虚宽按钮** ⇒ 本守卫只剩一条断言（全仓扫描必须
 * 为空 ✓✓），任何新增写法当场红 ✓。下面记的是判据与成因，改动前先读完 ✓。
 *
 * 违规口径（四条同时成立）：
 *  ① `<Button>` 的 className 含 `h-auto`（把高度交还内容）；
 *  ② `size` 没传、或传的正是 `default`（等于没传 ⇒ 缺省档的 `px-4 py-2` 还在 ✗）；
 *  ③ 不是「满宽 + 内容居中」的块级按钮（见 `isExempt`）；
 *  ④ **横轴一个内边距类都没有**（`p-` / `px-` / `pl-` / `pr-`）⇒ 这一轴还是 base 的 `px-4`。
 *
 * 成因：`cn`（`@renderer/utils/cn`，clsx + tailwind-merge 的替代品 ✓）只删「同族冲突」的类 ——
 * 只写 `h-auto` 时高度归内容，`px-4` 却原样留下 ⇒ 文字两侧各多 16px 虚宽（16px 图标更是被
 * 16/8 撑成 48×32 的方块 ✓，2026-10-10 用户报障「元数据的这个框太大了」，Chromium 实测 ✓）。
 * 当时的收口按「框是否可见」分两类：看得见的传紧凑档（`iconSm` 28×28 / `xs` 24px）✓，
 * 看不见的就地补 `px-0`、**高度刻意不动** ✓（横向收窄是修 bug、纵向收窄是审美变更 ✗）。
 *
 * ⚠️ 已知盲区（审查核过：今天全仓无此类写法 ⇒ 未处理，出现时靠评审而不是靠这条守卫 ✓）：
 *  · `className={SOME_CONST}` —— 常量里的 `h-auto` / 内边距看不见 ✗；
 *  · `cn("h-auto", cond && "px-0")` —— 条件为假时仍会被判成「有内边距」✗；
 *  · `size={expr}` —— 无法静态判断 ⇒ 一律放行（宁可漏报、不误报 ✗）。
 */
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
export function isExempt(tokens: string[]): boolean {
  const spreads = tokens.includes("w-full") || tokens.includes("flex-1");
  const edgePushed =
    tokens.includes("text-left") ||
    tokens.includes("text-start") ||
    tokens.includes("justify-between");
  return spreads && !edgePushed;
}

/**
 * `size` 是否已经把缺省档的 `px-4 py-2` 换掉了 ✓。
 *
 * ⚠️ 只看「有没有传 `size`」是不够的：`size="default"` 是合法写法，它带回来的正是
 * `h-9 px-4 py-2` ⇒ 与「没传」等价，原始的虚宽 bug 会复现 ✗（审查发现的潜在地雷；今天全仓
 * 没有调用点这么写 ✓，但守卫得拦住它 ✓）。
 */
export function sizeReplacesDefaultSlab(sizeText: string | null): boolean {
  if (sizeText === null) return false; // 没传 ⇒ 缺省档在场
  if (sizeText.startsWith("{")) return true; // 表达式：静态判断不了 ⇒ 放行（见文件头盲区）
  return sizeText.replace(/^["']|["']$/g, "").trim() !== "default";
}

/** 直接从源码文本数（导出以便用内联 fixture 做正控 —— 活文件收口后就没有正例了 ✓）。 */
export function countInSource(sourceText: string): number {
  const sf = ts.createSourceFile(
    "probe.tsx",
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let count = 0;
  const visit = (n: ts.Node) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      if (n.tagName.getText() === "Button") {
        let sizeText: string | null = null;
        let classText = "";
        for (const attr of n.attributes.properties) {
          if (!ts.isJsxAttribute(attr)) continue;
          if (attr.name.getText() === "size") {
            sizeText = attr.initializer ? attr.initializer.getText() : "";
          }
          if (attr.name.getText() === "className" && attr.initializer) {
            classText = attr.initializer.getText();
          }
        }
        const tokens = classTokens(classText);
        if (
          tokens.includes("h-auto") &&
          !sizeReplacesDefaultSlab(sizeText) &&
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

/** 该文件里「只写 `h-auto` 又没有横向内边距」的 `<Button>` 个数。 */
export function missesHorizontalPadding(relPath: string): number {
  return countInSource(fs.readFileSync(path.join(RENDERER, relPath), "utf8"));
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
  it("正控：AST 路径本身必须抓得到违规（活文件收口后已无正例，靠内联 fixture 守）", () => {
    // ① 原始 bug 的形状：只写 `h-auto`、没内边距、没 size ✓
    expect(
      countInSource(
        `const A = () => (<Button className="text-xs h-auto hover:bg-transparent">重试</Button>);`,
      ),
      "① 只写 h-auto 的必须抓",
    ).toBe(1);
    // ② `size="default"` 等于没传 ⇒ 缺省档的 `px-4 py-2` 还在 ⇒ 同样必须抓 ✓（潜在地雷）
    expect(
      countInSource(
        `const B = () => (<Button size="default" className="text-xs h-auto">重试</Button>);`,
      ),
      "② size=default 必须抓",
    ).toBe(1);
    // ③ 三种合法写法都放过：补了 `px-0` / 传了紧凑档 / 满宽且内容居中 ✓
    expect(
      countInSource(
        `const C = () => (<Button className="text-xs h-auto px-0">重试</Button>);`,
      ),
      "③ 补了 px-0 应放过",
    ).toBe(0);
    expect(
      countInSource(
        `const D = () => (<Button size="xs" className="text-xs h-auto">重试</Button>);`,
      ),
      "③ 传了紧凑档应放过",
    ).toBe(0);
    expect(
      countInSource(
        `const E = () => (<Button className="w-full py-2 h-auto">确定</Button>);`,
      ),
      "③ 满宽 + 居中应放过",
    ).toBe(0);
  });

  it("负控：两轴都写了内边距的图标按钮不算违规（否则就是「见 h-auto 就红」的假警报）", () => {
    // `components/ScheduleToolbar.tsx` 全是 `p-1 … h-auto` 的图标按钮 ⇒ 放过 ✓。
    expect(missesHorizontalPadding("components/ScheduleToolbar.tsx")).toBe(0);
  });

  it("负控：满宽且内容居中的块级按钮不算违规（base 的 px-4 只影响居中位置）", () => {
    // `components/TopUpModal.tsx` 五个 `w-full … py-2 … h-auto` 按钮 ⇒ 豁免 ✓（本就不该改）。
    expect(missesHorizontalPadding("components/TopUpModal.tsx")).toBe(0);
  });

  it("判据本身：靠边的满宽按钮不得被豁免（豁免不能放宽到「写了 w-full 就放过」）", () => {
    const t = (s: string) => s.split(/\s+/);
    expect(isExempt(t("w-full py-2 h-auto"))).toBe(true); // 满宽 + 默认居中 ⇒ 豁免 ✓
    expect(isExempt(t("flex-1 truncate text-left h-auto"))).toBe(false); // 靠边 ⇒ 不豁免 ✓
    expect(isExempt(t("w-full justify-between py-2 h-auto"))).toBe(false); // 靠边 ⇒ 不豁免 ✓
  });

  it("集合为空 ⇒ 全仓再无虚宽按钮；任何新增都会当场红 ✓", () => {
    const actual = offenders();
    expect(
      [...actual],
      "新出现的虚宽按钮：请传 size（xs / iconSm），或补 px-0",
    ).toEqual([]);
  });
});

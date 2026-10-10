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

/**
 * ② 2026-10-10 新增：**手写固定盒被缺省档内边距钳住**这一类（与上面那条 `h-auto` 的判据正交）。
 *
 * 形状四件套同时成立才算违规：
 *  ① 没传 `size`，或传的正是 `default`（等于没传 ⇒ 缺省档 `h-9 px-4 py-2` 在场；
 *    合法出路是传档位 —— 28² 用 `iconSm`、24² 用 `iconXs`、其余小尺寸就地补 `px-0` ✓）；
 *  ② 该轴没有作者自己的内边距：**横轴**要 `p-*`/`px-*`/`pl-*`/`pr-*`（沿用既有 `HORIZONTAL`
 *     的口径），**纵轴**要 `p-*`/`py-*`/`pt-*`/`pb-*`；
 *  ③ 手写了**固定** `w-*` / `h-*`（`w-full` / `min-w-*` / `max-w-*` / `h-auto` / `h-full`
 *     不是固定盒 ⇒ 放过）；
 *  ④ 该值**小于内边距之和**（宽 32 / 高 16）—— `box-sizing: border-box` 下 used width 不能
 *     小于 `padding-left + padding-right` ⇒ 盒被抬到内边距之和，作者写的 20/24/28 全变成 32
 *     （2026-10-10 真 Chromium 实测 ✓）。这就是 `TitlebarButton` 的「语音图标没居中」根因：
 *     它是全仓唯一的 `grid` 按钮，内容盒只剩 0×12 ⇒ 单行落回顶部 ⇒ 24px 的球下偏 6px ✗✗。
 *
 * ⚠️ 两条容易写错的判据：
 *  · **分轴判**：只写 `py-*` 的按钮，宽度照样被 `px-4` 钳住 ⇒ 不能拿「写了内边距」一刀切放过 ✗。
 *  · **`pl-*`/`pr-*` 算横轴已接管**：`cn` 的冲突表里 `pl/pr` 不会删掉 `px-4`，但全仓无此写法，
 *    且与 `HORIZONTAL` 的既有裁决一致（宁可漏报、不可误报）✓。
 *
 * ⚠️ 为什么不顺带禁「`grid` + 内边距」：`h-12`(48) 这类够高的 grid 按钮并不偏（内容盒 32 >
 * 子元素 24，`align-content: stretch` 会把单行撑开 ⇒ `align-items: center` 照常居中 ✓）
 * ⇒ 一刀切会误报。垂直下偏那一个实例由 `titlebar-widgets.test.ts` 的 DOM 断言盯着 ✓。
 *
 * ⚠️ 已知盲区（今天无样本，出现时靠评审）：`className={SOME_CONST}` 这一形状**看不见**
 * （`FeedListenButton` / `VoiceMiniButton` 的 6 处常量就是人工登记的 ✓）；变体前缀
 * （`sm:w-6`）与 `size={expr}` 看不见；判据阈值只按**缺省档**口径算 —— 若将来有人写
 * `size="sm"`（`px-3`=24）再手写更小的 `w-4`，会被漏报（同样属「宁可漏报」）✓。
 */
const BOX_SCALE: Record<string, number> = {
  "0": 0,
  px: 1,
  "0.5": 2,
  "1": 4,
  "1.5": 6,
  "2": 8,
  "2.5": 10,
  "3": 12,
  "3.5": 14,
  "4": 16,
  "5": 20,
  "6": 24,
  "7": 28,
  "8": 32,
  "9": 36,
  "10": 40,
  "11": 44,
  "12": 48,
};
const VERTICAL = /^(?:[a-z-]+:)*(?:p|py|pt|pb)-/; // 纵轴接管
const CLAMP_W = 32; // 缺省档 px-4 之和
const CLAMP_H = 16; // 缺省档 py-2 之和

/** 无变体前缀的 `w-*` / `h-*` → 像素；其余 token（含带变体前缀的 = 盲区）一律 null。 */
export function fixedBoxPx(token: string): number | null {
  const m = /^(?:w|h)-([\w.]+)$/.exec(token);
  if (!m) return null;
  const value = m[1];
  if (value in BOX_SCALE) return BOX_SCALE[value];
  const arbitrary = /^\[(\d+(?:\.\d+)?)px\]$/.exec(value);
  return arbitrary ? Number(arbitrary[1]) : null;
}

/** 该源码里「手写固定盒 + 缺省档内边距在场 + 被钳住」的 `<Button>` 个数。 */
export function countClampedBoxInSource(sourceText: string): number {
  const sf = ts.createSourceFile(
    "probe.tsx",
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let count = 0;
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (node.tagName.getText() === "Button") {
        let sizeText: string | null = null;
        let classText = "";
        for (const attr of node.attributes.properties) {
          if (!ts.isJsxAttribute(attr)) continue;
          if (attr.name.getText() === "size") {
            sizeText = attr.initializer ? attr.initializer.getText() : "";
          }
          if (attr.name.getText() === "className" && attr.initializer) {
            classText = attr.initializer.getText();
          }
        }
        const tokens = classTokens(classText);
        const clampedWidth =
          tokens
            .filter((t) => /^w-/.test(t))
            .some((t) => (fixedBoxPx(t) ?? Infinity) < CLAMP_W) &&
          !tokens.some((t) => HORIZONTAL.test(t));
        const clampedHeight =
          tokens
            .filter((t) => /^h-/.test(t))
            .some((t) => (fixedBoxPx(t) ?? Infinity) < CLAMP_H) &&
          !tokens.some((t) => VERTICAL.test(t));
        if (
          (clampedWidth || clampedHeight) &&
          !sizeReplacesDefaultSlab(sizeText)
        ) {
          count += 1;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return count;
}

/** 该文件里仍被内边距钳住的 `<Button>` 个数。 */
export function clampedBoxes(relPath: string): number {
  return countClampedBoxInSource(
    fs.readFileSync(path.join(RENDERER, relPath), "utf8"),
  );
}

/** 全仓扫一遍：新增文件里的违规也拦得住 ✓。 */
function clampedBoxOffenders(): Set<string> {
  const out = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.name.endsWith(".tsx")) {
        const rel = path.relative(RENDERER, abs);
        if (clampedBoxes(rel) > 0) out.add(rel);
      }
    }
  };
  walk(RENDERER);
  return out;
}

describe("Button 固定盒被内边距钳住守卫", () => {
  it("正控/负控 fixture：手写固定盒 + 缺省档 ⇒ 抓；补齐内边距或走紧凑档 ⇒ 放过", () => {
    // ① 原始形状：不传 size + 手写 w-6 h-6（< 32）⇒ 必须抓
    expect(
      countClampedBoxInSource(
        `const A = () => (<Button className="h-6 w-6 rounded" />);`,
      ),
    ).toBe(1);
    // ② `size="default"` 等于没传 ⇒ 同样必须抓
    expect(
      countClampedBoxInSource(
        `const B = () => (<Button size="default" className="h-6 w-6" />);`,
      ),
    ).toBe(1);
    // ③ 三种合法写法：传紧凑档 / 补 px-0 / 尺寸本来就没被钳（w-8 = 32）
    expect(
      countClampedBoxInSource(
        `const C = () => (<Button size="iconSm" className="rounded" />);`,
      ),
    ).toBe(0);
    expect(
      countClampedBoxInSource(
        `const D = () => (<Button className="h-6 w-6 px-0" />);`,
      ),
    ).toBe(0);
    expect(
      countClampedBoxInSource(
        `const E = () => (<Button className="h-8 w-8" />);`,
      ),
    ).toBe(0);
    // ④ 非固定盒：w-full / flex-1 / h-full / h-auto / min-w-* / max-w-* 都不与内边距争同一根轴
    for (const cls of [
      "w-full h-auto",
      "flex-1 h-7",
      "h-full w-full",
      "min-w-0 h-7",
      "max-w-[16rem] h-7",
    ]) {
      expect(
        countClampedBoxInSource(
          `const F = () => (<Button className="${cls}" />);`,
        ),
        cls,
      ).toBe(0);
    }
    // ⑤ 分轴判：只有 py-* 的按钮宽度照样被钳 ⇒ 仍要抓；只有 px-* 的按钮高度被钳到 16 ⇒ 也仍要抓
    expect(
      countClampedBoxInSource(
        `const G = () => (<Button className="h-6 w-6 py-1" />);`,
      ),
    ).toBe(1);
    expect(
      countClampedBoxInSource(
        `const H = () => (<Button className="h-3 w-9 px-0" />);`,
      ),
    ).toBe(1);
  });

  it("集合为空 ⇒ 全仓再无被内边距钳住的固定盒按钮；任何新增都会当场红", () => {
    expect(
      [...clampedBoxOffenders()],
      "新出现的被钳按钮：补 px-0，或按意图传 size（iconSm / 什么都不传）",
    ).toEqual([]);
  });
});

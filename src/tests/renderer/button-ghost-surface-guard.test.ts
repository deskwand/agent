import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const RENDERER = path.resolve(import.meta.dirname, "../../renderer");
const SOLID_PRIMARY = /(?<![-\w/])bg-primary(?![-/\w])/; // `bg-primary`，但不算 `bg-primary/10` 与 `bg-primary-*`
/** 把 hover 底从 ghost 的 `hover:bg-accent` 手里夺回来的两种写法 ✓。 */
const NEUTRALIZED = /hover:bg-(primary|transparent)/;

/**
 * ✅ 2026-10-10 收口已完成：**ghost 按钮不允许再被 hover 抽走主色底** ⇒ 本守卫只剩一条断言
 * （全仓扫描必须为空 ✓✓），任何新增写法当场红 ✓。下面记的是判据与成因，改动前先读完 ✓。
 *
 * 违规口径（三条同时成立）：
 *  ① `<Button>` 传了 `variant="ghost"`（它自带 `hover:bg-accent` ✓）；
 *  ② className 里画了**实心** `bg-primary`（带透明度的 `bg-primary/10` 这类"淡底"不算 ✗
 *     —— 它们本来就该在 hover 时让位，`hover:bg-accent` 正是想要的观感 ✓）；
 *  ③ className 里**没有** `hover:bg-primary*` 或 `hover:bg-transparent`（= 没把 hover 底夺回来）。
 *
 * 成因（2026-10-10 用户报障「主色的按钮获得焦点时看不清字了」，Chromium 实测 ✓）：
 * ghost 的 `hover:bg-accent` 与调用点自己的 `bg-primary` 是**不同变体**的同一个属性 ⇒ `cn`
 * （`@renderer/utils/cn`，clsx + tailwind-merge 的替代品）不去重、两条类都在 ✓；产物里
 * `.hover\:bg-accent:hover` 又排在 `.bg-primary` 之后 ⇒ hover 时底色被换成 `--accent`
 *（亮色主题的 hover 表面色 ≈ #f4f4f5 ✗），而文字还是近白的 `--primary-foreground`
 * ⇒ 对比度 **1.03:1**，整行看不见 ✗✗。
 *
 * 判据的落点：**条件底色**的控件（页签、开关）留 ghost、在"亮底"那一支补 `hover:bg-primary/90` ✓；
 * **无条件实心**的主按钮改挂 `variant="default"`（底色/文字/hover 全交给变体 ✓，
 * 见 `ChatView` 的语音 CTA ✓）—— 后者不在本守卫的扫描面上（它不是 ghost ✓）。
 *
 * ⚠️ 已知盲区（宁可漏报、不误报 ✗）：
 *  · `className={SOME_CONST}` / 展开属性 —— 常量与 spread 里的类看不见 ✗；
 *  · `variant={expr}` —— 静态判断不了 ⇒ 一律放行 ✓；
 *  · 其他变体（`outline` / `secondary`）自带 hover 底，同款风险，今天全仓无调用点
 *    ⇒ 出现时靠评审而不是靠这条守卫 ✓。
 */
export function ghostPrimaryWithoutOwnHover(sourceText: string): number {
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
        let variant = "";
        let classText = "";
        for (const attr of n.attributes.properties) {
          if (!ts.isJsxAttribute(attr)) continue;
          if (attr.name.getText() === "variant" && attr.initializer) {
            variant = attr.initializer.getText().replace(/^["']|["']$/g, "");
          }
          if (attr.name.getText() === "className" && attr.initializer) {
            classText = attr.initializer.getText();
          }
        }
        if (
          variant === "ghost" &&
          SOLID_PRIMARY.test(classText) &&
          !NEUTRALIZED.test(classText)
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

/** 该文件里有几处「ghost 画了实心主色底、又没把 hover 底夺回来」。 */
export function stealsPrimarySurface(relPath: string): number {
  return ghostPrimaryWithoutOwnHover(
    fs.readFileSync(path.join(RENDERER, relPath), "utf8"),
  );
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
        if (stealsPrimarySurface(rel) > 0) out.add(rel);
      }
    }
  };
  walk(RENDERER);
  return out;
}

describe("ghost 变体的主色表面守卫", () => {
  it("正控：AST 路径本身必须抓得到违规（活文件收口后已无正例，靠内联 fixture 守）", () => {
    // ① 原始 bug 的形状：ghost + 实心主色底 + 近白文字，没有 hover 兜底 ✓
    expect(
      ghostPrimaryWithoutOwnHover(
        `const A = () => (<Button variant="ghost" className="rounded-lg bg-primary text-sm text-primary-foreground">保存</Button>);`,
      ),
      "① 原始形状必须抓",
    ).toBe(1);
    // ② 条件底色（页签/开关）的"亮底"那一支同样必须抓 ✓
    expect(
      ghostPrimaryWithoutOwnHover(
        `const B = (p: { on: boolean }) => (<Button variant="ghost" className={\`w-10 h-6 rounded-full \${p.on ? "bg-primary" : "bg-border"}\`} />);`,
      ),
      "② 条件亮底必须抓",
    ).toBe(1);
  });

  it("负控：三种合法写法一个都不许报（否则就是「见 bg-primary 就红」的假警报）", () => {
    // ① 就地补 `hover:bg-primary/90` ✓
    expect(
      ghostPrimaryWithoutOwnHover(
        `const C = () => (<Button variant="ghost" className="bg-primary text-primary-foreground hover:bg-primary/90">保存</Button>);`,
      ),
      "① 补了 hover:bg-primary/90 应放过",
    ).toBe(0);
    // ② `hover:bg-transparent`（本仓另一条既有约定）✓
    expect(
      ghostPrimaryWithoutOwnHover(
        `const D = () => (<Button variant="ghost" className="bg-primary text-primary-foreground hover:bg-transparent hover:text-current">重试</Button>);`,
      ),
      "② hover:bg-transparent 应放过",
    ).toBe(0);
    // ③ 淡底 `bg-primary/10` 本来就该让位给 accent ⇒ 不算实心 ✓
    expect(
      ghostPrimaryWithoutOwnHover(
        `const E = () => (<Button variant="ghost" className="bg-primary/10 text-primary-text">插入</Button>);`,
      ),
      "③ bg-primary/10 是淡底，应放过",
    ).toBe(0);
    // ④ 主按钮走 default 变体（ChatView 语音 CTA 的写法）⇒ 不在扫描面上 ✓
    expect(
      ghostPrimaryWithoutOwnHover(
        `const F = () => (<Button variant="default" className="rounded-2xl bg-primary text-primary-foreground shadow-none">开始语音</Button>);`,
      ),
      "④ default 变体应放过",
    ).toBe(0);
  });

  it("负控：条件底色里「暗底」那一支自带 `hover:bg-accent`，不算违规", () => {
    expect(
      ghostPrimaryWithoutOwnHover(
        `const G = (p: { on: boolean }) => (<Button variant="ghost" className={\`\${p.on ? "bg-primary hover:bg-primary/90" : "bg-muted hover:bg-accent"}\`} />);`,
      ),
    ).toBe(0);
  });

  it("集合为空 ⇒ 全仓再无「hover 抽走主色底」的按钮；任何新增都会当场红 ✓", () => {
    const actual = offenders();
    expect(
      [...actual],
      '新出现的违规：亮底那一支补 `hover:bg-primary/90`，或把主按钮改挂 variant="default"',
    ).toEqual([]);
  });
});

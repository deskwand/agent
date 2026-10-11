// 原生光标守卫。
//
// 口径（第 21/38 项）：原生列表行/按钮/页签**不换光标**。悬停变背景色是对的，
// 把手型光标挂上去才是「这是网页」的即时 tell。
//
// ⚠️ 只禁 `cursor-pointer`，不禁所有 cursor-*：仓库里另有三类**正确**用法 ——
//   `cursor-col-resize`（面板拖拽分隔条，App.tsx:695）、
//   `cursor-default`（Radix 菜单项，ui/dropdown-menu.tsx）、
//   `disabled:cursor-not-allowed`（禁用态，原生就该是它）。
//   写成「禁掉所有 cursor-*」会把这三种一起打红 ⇒ 负控里逐个钉住。
//
// ⚠️ 本文件在 tailwind 的 content 扫描范围内，所以字面量拆开拼：见 focus-ring-css.test.ts 文件头。
//
// ⚠️⚠️ 2026-10-11 用户报障后补的关键一条（「鼠标挪到左下角头像上，现在是一个手」）：
// 手型光标有**两个来源**，只扫源码只能看见其中一个。
//   ① 源码里显式的 `cursor-pointer` 类 —— 全仓扫描能抓到（下面的 offenders()）；
//   ② **Tailwind v3 的 preflight**：
//        button, [role="button"] { cursor: pointer }
//      （node_modules/tailwindcss/lib/css/preflight.css，构建时生成，注释原文
//        「Set the default cursor for buttons.」）—— **它不在任何源码文件里**，
//      所以上面那套源码扫描判据一个都看不见它。413 个 <Button> + 51 个 <button> +
//      4 个 role="button" 全都还带着手型光标，而本文件曾经是绿的
//      （grep role="button" 会数到 5 处，第 5 处在 OpenWithSystemAppButton.tsx:16 的注释里）。
// ⇒ 必须再加一条**反向断言**：globals.css 里必须存在把它压回 cursor: default 的规则。
//    删掉那条规则会让按钮全部恢复手型光标，下面最后一个用例会当场红。
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { css, RENDERER } from "./theme-css-helpers";

/** 拆开拼，避免本文件自己把这个工具类生成出来。 */
const POINTER = "cursor-" + "pointer";

/** 剥掉注释后的 globals.css：注释里会写到选择器与属性名，不能当成规则（见文件头）。 */
const declarations = css.replace(/\/\*[\s\S]*?\*\//g, "");

/** globals.css 里所有 `2 空格缩进的选择器 { … 2 空格缩进的 }` 规则。 */
function rules(): { selector: string; body: string }[] {
  return [
    ...declarations.matchAll(/^ {2}([^{}]+?)\s*\{([\s\S]*?)^ {2}\}/gm),
  ].map((m) => ({ selector: m[1].replace(/\s+/g, " ").trim(), body: m[2] }));
}

/** 该源码里手型光标的处数。导出以便用内联 fixture 做正控。 */
export function pointerCountInSource(sourceText: string): number {
  return sourceText.split(POINTER).length - 1;
}

/** 全仓扫一遍：新增文件里的违规也拦得住。 */
function offenders(): Set<string> {
  const out = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) {
        if (pointerCountInSource(fs.readFileSync(abs, "utf8")) > 0) {
          out.add(path.relative(RENDERER, abs));
        }
      }
    }
  };
  walk(RENDERER);
  return out;
}

describe("原生光标守卫", () => {
  it("正控：判据本身必须抓得到手型光标", () => {
    expect(pointerCountInSource(`<div className="cursor-pointer" />`)).toBe(1);
    expect(
      pointerCountInSource(`cn("flex", canClick && "cursor-pointer")`),
    ).toBe(1);
  });

  it("负控：原生该用的光标一律放过（列宽拖拽 / 菜单项 / 禁用态）", () => {
    for (const cls of [
      "cursor-col-resize",
      "cursor-default",
      "disabled:cursor-not-allowed",
    ]) {
      expect(pointerCountInSource(`<div className="${cls}" />`), cls).toBe(0);
    }
  });

  it("集合为空 ⇒ 全仓再无显式手型光标；任何新增都会当场红", () => {
    expect(
      [...offenders()],
      "新增的手型光标：原生行/按钮/页签不换光标，删掉即可（拖拽把手用 cursor-col-resize）",
    ).toEqual([]);
  });

  // ── 下面是 2026-10-11 补的那条：手型光标的第二个来源 ──

  it("正控/负控：规则提取器认得选择器、且不被注释骗", () => {
    const parsed = [
      ...`  button,\n  [role="button"] {\n    cursor: default;\n  }\n`.matchAll(
        /^ {2}([^{}]+?)\s*\{([\s\S]*?)^ {2}\}/gm,
      ),
    ].map((m) => ({ selector: m[1].replace(/\s+/g, " ").trim(), body: m[2] }));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].selector).toBe('button, [role="button"]');
    expect(parsed[0].body).toMatch(/cursor:\s*default/);
    // 负控：只有注释时不该被当成规则（declarations 已剥注释）
    expect(
      rules().some((r) =>
        r.body.includes("Set the default cursor for buttons"),
      ),
      "注释不该被当成规则体",
    ).toBe(false);
  });

  it("globals.css 必须把 preflight 装的手型光标压回 default（否则按钮全部恢复手型）", () => {
    expect(
      overridesPreflightButtonCursor(rules()),
      'globals.css 缺少把 `button, [role="button"]` 压回 cursor: default 的规则 —— ' +
        "Tailwind preflight 会给它们装手型光标，删掉这条覆盖按钮就全部变回手",
    ).toBe(true);
  });
});

/**
 * globals.css 里是否已经把 preflight 的手型光标压回 default。
 *
 * 判据必须**分别**覆盖元素选择器 `button` 与 `[role="button"]`：
 * preflight 那条是 `button, [role="button"] { cursor: pointer }`，
 * 只压半个就会漏掉另一半（413 个 <Button>/51 个原生 <button> 属于前者，
 * 4 处 row/card 属于后者）。同一条规则承担两个目标、或拆成两条，都算数。
 *
 * ⚠️ 三条硬要求都是实测踩坑踩出来的，改动这里前先读完：
 *  ① **不能对整串选择器直接 `\bbutton\b`** —— `"` 是**非单词字符**，
 *     那样会匹配 `[role="button"]` **里面**的 button，判据塔缩成「有没有 [role=button]」，
 *     于是收窄成只覆盖 role 也判绿。2026-10-11 评审实测：把规则收窄成
 *     `[role="button"] { cursor: default }` 后，413 个 <Button> + 51 个原生 <button>
 *     （包括用户报障的左下角头像）全部恢复手型光标，而当时的判据仍是绿的。
 *     做法：先把 `[role="button"]` 摘掉，剩下的部分才代表元素选择器。
 *  ② **不能只看摘完还剩不剩 button 这个词** —— 那样 `.my-button` / `.btn-button` 也算，
 *     做法：按逗号拆段，要求某段**以** `button` 开头（允许 `:is(` / `:where(` 包裹）。
 *  ③ **`@apply cursor-default` 与裸声明等价** —— globals.css 上面两条规则就是用 @apply 写的，
 *     只认裸声明会把正确实现判成缺失（假红）。
 *
 * 导出以便用内联 fixture 钉住判据本身。
 */
export function overridesPreflightButtonCursor(
  input: { selector: string; body: string }[],
): boolean {
  const setsDefault = (body: string) =>
    /cursor:\s*default/.test(body) ||
    /@apply\s+[^;]*\bcursor-default\b/.test(body);
  // 不带 g：带 g 的正则用 .test() 会记 lastIndex，多次调用结果会交替 —— 这是个经典坑。
  const ROLE_BUTTON = /\[role=["']button["']\]/;
  const coversButton = (selector: string) =>
    selector
      .replace(/\[role=["']button["']\]/g, " ")
      .split(",")
      .some((segment) => /^\s*(?::is\(|:where\()?\s*button\b/.test(segment));
  const coversRole = (selector: string) => ROLE_BUTTON.test(selector);
  const defaulters = input.filter((r) => setsDefault(r.body));
  return (
    defaulters.some((r) => coversButton(r.selector)) &&
    defaulters.some((r) => coversRole(r.selector))
  );
}

describe("preflight 光标覆盖的判据本身", () => {
  const rule = (selector: string, body = "cursor: default;") => [
    { selector, body },
  ];

  it("正控：一条规则同时覆盖两个目标，或拆成两条，都算数", () => {
    expect(
      overridesPreflightButtonCursor(rule('button, [role="button"]')),
    ).toBe(true);
    expect(
      overridesPreflightButtonCursor([
        ...rule("button"),
        ...rule('[role="button"]'),
      ]),
      "拆成两条也该算数",
    ).toBe(true);
  });

  it("负控：只覆盖一半必须判否（2026-10-11 评审实测的假绿）", () => {
    // ★ 收窄成只覆盖 [role="button"] 时，413 个 <Button> + 51 个原生 <button>
    //   全部恢复手型光标（含用户报障的左下角头像），而当时的判据仍是绿的。
    expect(
      overridesPreflightButtonCursor(rule('[role="button"]')),
      "只覆盖 [role=button] ⇒ 按钮仍是手 ⇒ 必须判否",
    ).toBe(false);
    expect(
      overridesPreflightButtonCursor(rule("button")),
      "只覆盖 button ⇒ 按下 role=button 渲染的行/卡片仍是手 ⇒ 必须判否",
    ).toBe(false);
  });

  it("负控：碰巧含 button 字样的类名不算覆盖（`.my-button` 那种）", () => {
    expect(
      overridesPreflightButtonCursor(rule('.my-button, [role="button"]')),
      ".my-button 不是元素选择器 button ⇒ 必须判否",
    ).toBe(false);
    expect(
      overridesPreflightButtonCursor(
        rule('button, [role="button"]', "cursor: pointer;"),
      ),
      "设成 pointer 当然不算覆盖",
    ).toBe(false);
  });

  it("正控：@apply cursor-default 与裸声明等价（假红陷阱）", () => {
    expect(
      overridesPreflightButtonCursor(
        rule('button, [role="button"]', "@apply cursor-default;"),
      ),
      "globals.css 上面两条规则就是用 @apply 写的，只认裸声明会假红",
    ).toBe(true);
  });
});

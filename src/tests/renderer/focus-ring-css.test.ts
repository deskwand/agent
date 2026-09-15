// 焦点环机制的回归守卫。
//
// 背景：全局规则原本给焦点环同时加了 accent 色与 30% 透明度，而 accent 在
// tailwind.config.js 里是 `var(--color-accent)`（整值、没有 alpha 插槽），
// 于是 ring-opacity-* 设置了却从不被 ring 阴影消费——环永远是不透明的，
// 浅色主题下就是那道近黑实心环。同样的原因，对 var 色值写 `ring-accent/{alpha}`
// 这类透明度修饰符在产物里一条规则都不生成（全仓 24 处，实际全部失效）。
//
// 注意：本文件在 tailwind 的 content 扫描范围内，注释里**不要**写出完整的
// 工具类字面量（写了就会被当成用法、把那个死类真的生成出来）。
import { describe, expect, it } from "vitest";
import { css, cssFlat } from "./theme-css-helpers";

/** 去掉注释再断言：注释里会提到 `ring-opacity` 这个坑，那是文档、不是用法。 */
const declarations = css.replace(/\/\*[\s\S]*?\*\//g, "");

describe("焦点环机制", () => {
  it("不再出现 ring-opacity 后缀（对本配置下的 var() 色值是空操作）", () => {
    expect(declarations).not.toMatch(/ring-opacity-/);
  });

  it("不再出现 2px 的焦点环", () => {
    expect(declarations).not.toMatch(/focus:ring-2|focus-visible:ring-2/);
  });

  it("支撑焦点环的 4 条基础规则宽度都是 1px、颜色都是主题强调色", () => {
    // 逐条断言而不是全文件计数：全文件计数以后加一处合法用法就会误报。
    const rules = (cssFlat.match(/@apply[^;]*;/g) ?? []).filter((rule) =>
      /focus(-visible)?:ring-/.test(rule),
    );

    expect(rules).toHaveLength(4); // select/input/textarea、button、.btn、.input
    for (const rule of rules) {
      expect(rule).toMatch(/focus(-visible)?:ring-1\b/);
      expect(rule).toMatch(/focus(-visible)?:ring-accent/);
    }
  });
});

// 侧栏滚动条沟槽守卫。
//
// 口径：会话列表的滚动条**常占位**，不允许「出现/消失时把行挤动」。
//
// 背景（2026-10-19 用户报障：「不是常占位，显示的时候会导致布局飘」）：
//   globals.css 的 .sidebar-scroll 设了 scrollbar-width / scrollbar-color。
//   Chromium（Electron）不会给它 overlay 滚动条，而是**占布局宽度**的经典滚动条 —— 于是列表一变成
//   可滚动（展开分组、会话变多），内容可用宽度就被吃掉一条滚动条，会话行整体左移。
//   本机 Electron 实测：原生滚动条 15px、thin 11px；环境无关，故不写数字进断言。
//   `scrollbar-gutter: stable` 恒定预留这段宽度 ⇒ 溢出前后、hover 前后行宽一致
//   （实测差值为 0，见提交说明）。
//
// 为什么不做「自绘浮层滑块」：零占宽的方案要新增组件 + 滚动/尺寸监听 + 拖拽，
// 对一次布局抖动来说过重；留一段固定沟槽已经消除抖动，且保住原生滚动条的可达性。
//
// jsdom 不结算 CSS，滚动条宽度这类东西在 renderer 测试里测不出来，
// 所以照 native-cursor-guard.test.ts 的办法直接读 globals.css 做源码级守卫。
import { describe, expect, it } from "vitest";
import { css } from "./theme-css-helpers";

/** 源码里所有 `2 空格缩进的选择器 { … 2 空格缩进的 }` 规则。
 *  先剥注释：注释里会写到选择器、属性名甚至花括号，不剥就会被当成规则（见下面负控）。 */
function rules(source: string): { selector: string; body: string }[] {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...stripped.matchAll(/^ {2}([^{}]+?)\s*\{([\s\S]*?)^ {2}\}/gm)].map(
    (m) => ({
      selector: m[1].replace(/\s+/g, " ").trim(),
      body: m[2],
    }),
  );
}

/** 选择器列表里含该选择器的规则体（取 globals.css）。 */
function bodyOf(selector: string): string {
  const hit = rules(css).filter((r) =>
    r.selector.split(",").some((s) => s.trim() === selector),
  );
  expect(
    hit.length,
    `globals.css 里找不到选择器 "${selector}" 的规则`,
  ).toBeGreaterThan(0);
  return hit.map((r) => r.body).join("\n");
}

describe("侧栏滚动条沟槽", () => {
  it("正控：规则提取器认得规则体", () => {
    const parsed = rules(`  .a {\n    scrollbar-gutter: stable;\n  }\n`);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].selector).toBe(".a");
    expect(parsed[0].body).toMatch(/scrollbar-gutter:\s*stable/);
  });

  it("负控：被注释掉的规则不算数", () => {
    expect(
      rules(`  /* .a {\n    scrollbar-gutter: stable;\n  } */\n`),
      "注释里的属性名不能当成规则 —— 否则把真规则注释掉也能保持绿",
    ).toHaveLength(0);
  });

  it(".sidebar-scroll 必须声明 scrollbar-gutter: stable —— 删掉它列表就会左右飘", () => {
    expect(
      bodyOf(".sidebar-scroll"),
      "globals.css 的 .sidebar-scroll 少了 scrollbar-gutter: stable —— " +
        "该元素设了 scrollbar-width/scrollbar-color，Chromium 会用占布局宽度的滚动条，" +
        "会话列表可靠滚动时内容宽度被吃掉，行随之左移（用户报的「布局飘」）",
    ).toMatch(/scrollbar-gutter:\s*stable\b/);
  });

  it("滚动条仍是细条 + 默认透明，hover / 键盘聚焦时才上色", () => {
    const base = bodyOf(".sidebar-scroll");
    expect(base, "细条宽度被改掉会顺带改变预留沟槽的宽度").toMatch(
      /scrollbar-width:\s*thin;/,
    );
    expect(base, "未 hover 时应透明，避免侧栏常驻一道滑块").toMatch(
      /scrollbar-color:\s*transparent\s+transparent;/,
    );

    // 上色规则同时覆盖 hover 与 focus-within：只有 hover 的话键盘浏览看不到滑块。
    // 上色只改颜色不改宽度 —— 这正是 gutter 常占位之后不再抖动的关键。
    for (const [state, why] of [
      [":hover", "鼠标悬停侧栏时应浮出滑块"],
      [
        ":focus-within",
        "键盘浏览侧栏时也应浮出滑块，否则成了只对鼠标可见的功能",
      ],
    ] as const) {
      expect(
        bodyOf(`.group${state} .sidebar-scroll`),
        `globals.css 缺少 \`.group${state} .sidebar-scroll\` 的上色规则 —— ${why}`,
      ).toMatch(/scrollbar-color:\s*var\(--border\)/);
    }
  });
});

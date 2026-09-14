// 长 token 消息换行 —— 见 design-docs/plans/2026-09-14-chat-long-token-wrapping.md
//
// 排版本身不可单测（jsdom 不做布局），这里锁的是「修复所依赖的声明还在」：
//   1. .message-user 声明 max-width: 100% —— 气泡上限必须来自容器，而不是内容的
//      min-content（fit-content 的下限会让 260 字符的不可断片段把气泡撑到 1935px）
//   2. 气泡父级不把宽度交给内容 —— 百分比 max-width 解的是父级的 used width；
//      父级一旦按内容撑开（w-fit / w-max / inline-flex），100% 也跟着变大，bug 复发
//   2b. .message-user 仍保留 width: fit-content —— 换成 width: 100% 也能让
//      「不超容器」成立，但短消息会从贴内容变成铺满列宽（实测 64px → 整列），
//      这条守卫专门防那种“修法”
//   3. .prose-chat 声明 overflow-wrap: break-word —— 正文盒宽已确定，断词即可；
//      不用 anywhere（后者会改动 prose 内所有内容的 min-content）
//   4. 代码块复位为 overflow-wrap: normal —— 否则 break-word 继承进去会让代码折行，
//      丢掉原有的横向滚动
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { RENDERER, classNameAt, cssFlat } from "./theme-css-helpers";

const messageCard = fs.readFileSync(
  path.join(RENDERER, "components/MessageCard.tsx"),
  "utf8",
);

describe("用户气泡：长 token 不再撑破气泡", () => {
  it(".message-user 声明 max-width: 100%", () => {
    expect(cssFlat).toMatch(/\.message-user\s*\{[^}]*max-width:\s*100%;/);
  });

  it(".message-user 保留 width: fit-content（短消息仍贴内容，不铺满列宽）", () => {
    expect(cssFlat).toMatch(/\.message-user\s*\{[^}]*width:\s*fit-content;/);
  });

  it("气泡父级不把宽度交给内容（max-width: 100% 要有一个确定宽度可解）", () => {
    // 百分比 max-width 解的是父级的 used width：父级是行内 flex item，宽度由
    // 「行宽 ∩ max-w-[80%]」确定。一旦给它加 w-fit / w-max / inline-flex，
    // 父级就会按内容（也就是那条长 token）撑开，100% 跟着变大 → bug 复发。
    const wrapper = classNameAt(
      messageCard,
      "max-w-[80%] min-w-0 flex flex-col items-end",
      '"',
    );
    expect(wrapper, wrapper).not.toMatch(
      /(?:^|\s)(?:w-fit|w-max|w-min|inline-flex|inline-block)(?:\s|$)/,
    );
  });
});

describe("助手正文：长 token 折行，代码块保持横滚", () => {
  it(".prose-chat 声明 overflow-wrap: break-word", () => {
    expect(cssFlat).toMatch(
      /\.prose-chat\s*\{[^}]*overflow-wrap:\s*break-word;/,
    );
  });

  it("代码块复位为 overflow-wrap: normal", () => {
    expect(cssFlat).toMatch(
      /\.prose-chat pre\s*\{[^}]*overflow-wrap:\s*normal;/,
    );
  });

  it(".code-block 保留横向滚动（不被改成折行）", () => {
    expect(cssFlat).toMatch(/\.code-block\s*\{\s*@apply[^}]*overflow-x-auto/);
  });
});

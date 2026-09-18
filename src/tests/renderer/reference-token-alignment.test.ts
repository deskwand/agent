// 设计文档 design-docs/2026-09-17-inline-reference-tokens-design.md §13 的不变量。
//
// token 必须与正文共享同一根基线 —— 之前用 inline-flex 时整体高了约 2px（实测输入框
// -2.06px、气泡 -2px）。jsdom 不算布局、量不到基线，所以这里锁的是**机制**，和
// chat-visual-hierarchy.test.ts 一样从源码/CSS 里读，不写死量出来的像素值。
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RENDERER, css } from "./theme-css-helpers";

const editorContent = fs.readFileSync(
  path.join(RENDERER, "utils/editor-content.ts"),
  "utf8",
);
const referenceToken = fs.readFileSync(
  path.join(RENDERER, "components/ReferenceToken.tsx"),
  "utf8",
);

/** 取出某个 `const X = "..."` 的类串。找不到就抛错 —— 这本身就是回归信号。 */
function classConstant(source: string, declaration: string): string {
  const m = new RegExp(`${declaration}\\s*=\\s*"([^"]+)"`).exec(source);
  if (!m) throw new Error(`源码里找不到 ${declaration}`);
  return m[1];
}

/** .reference-token-icon 规则的规则体。 */
function iconRule(): string {
  const m = /\.reference-token-icon\s*\{([^}]*)\}/.exec(css);
  if (!m) throw new Error("globals.css 里找不到 .reference-token-icon");
  return m[1];
}

describe("行内引用 token 的基线对齐", () => {
  it("容器不能是 inline-flex（根因：基线取自首个 flex item 的底边）", () => {
    // inline-flex + items-center 让容器的基线按首个 flex item（svg）的边框盒合成
    // （CSS Flexbox §8.5），整个 token 被抬起约 2px。两处都不能回退。
    expect(classConstant(editorContent, "const TOKEN_CLASS")).not.toContain(
      "inline-flex",
    );
    expect(classConstant(referenceToken, "const BASE_CLASS")).not.toContain(
      "inline-flex",
    );
  });

  it("输入框与气泡共用同一套基础类串，不许漂移", () => {
    const editorClasses = classConstant(
      editorContent,
      "const TOKEN_CLASS",
    ).split(/\s+/);
    const bubbleClasses = classConstant(
      referenceToken,
      "const BASE_CLASS",
    ).split(/\s+/);
    expect(bubbleClasses.length).toBeGreaterThan(0);
    for (const cls of bubbleClasses) {
      expect(editorClasses, `气泡有 ${cls}，输入框没有`).toContain(cls);
    }
  });

  it("图标规则显式声明 display:inline（preflight 给 svg 的是 display:block）", () => {
    expect(iconRule()).toMatch(/display:\s*inline\s*;/);
  });

  it("图标用负的带单位 vertical-align 做光学居中（middle 会让图标偏低）", () => {
    const m = /vertical-align:\s*(-?[\d.]+)(em|px|rem)\s*;/.exec(iconRule());
    if (!m)
      throw new Error(".reference-token-icon 缺少带单位的 vertical-align");
    expect(Number(m[1]), "负值才表示把图标上移").toBeLessThan(0);
  });

  it("两处图标引用都挂了 .reference-token-icon", () => {
    expect(editorContent).toContain("reference-token-icon");
    expect(referenceToken).toContain("reference-token-icon");
  });
});

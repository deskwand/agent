// 级联守卫：顶层（未被 @layer 包裹的 :root）与主题块**不得声明同名 token**。
//
// 为什么这条最要紧：产物里 @layer base 的主题块排在前，顶层 :root 排在后，
// 两者特异性都是 (0,1,0) ⇒ 顶层必胜。任何"顶层再声明一次"的写法都会让主题块里
// 那条静默变成死代码（亮色会拿到暗色的值，且不报错）。
//
// 2026-10-10：原先这里还锁 overlay-hover / press / on 三个叠层 token 的强度带 ——
// 那三个 token 随官方 vocabulary 切换被删（悬浮/选中底改用官方 --accent），
// 强度断言一并删除；本文件只留级联守卫。
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { RENDERER, css } from "./theme-css-helpers";

const appTsx = fs.readFileSync(path.join(RENDERER, "App.tsx"), "utf8");

describe("固定语义层与主题层的级联边界", () => {
  it("固定语义层声明的 token 不出现在 @layer base 的主题块里", () => {
    // 锚到含 --app-chrome 的那个顶层 :root（固定语义层）。
    const anchor = css.indexOf("--app-chrome");
    expect(anchor, "globals.css 里找不到 --app-chrome").toBeGreaterThan(-1);
    const start = css.lastIndexOf("\n:root {", anchor);
    const end = css.indexOf("\n}", anchor);
    expect(start, "找不到含 --app-chrome 的顶层 :root").toBeGreaterThan(-1);
    const declared = [
      ...css.slice(start, end).matchAll(/^\s*(--[\w-]+)\s*:/gm),
    ].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(0);

    // ⚠️ 锚到 "@layer base {"（带花括号）而不是 "@layer base"：固定语义层的注释里
    // 也写着这个词，用裸词会让切片从注释内开始、把顶层 :root 圈进来（假红）。
    const baseLayer = css.slice(
      css.indexOf("@layer base {"),
      css.indexOf("@layer components"),
    );
    expect(baseLayer.length).toBeGreaterThan(0);
    for (const token of declared) {
      expect(
        baseLayer.includes(`${token}:`),
        `${token} 既在顶层 :root 声明，又在 @layer base 的主题块里声明 —— 后者是死代码`,
      ).toBe(false);
    }
  });

  it("主题层声明的官方变量不出现在顶层", () => {
    const top = css.slice(0, css.indexOf("@layer base {"));
    // 抽样官方变量：只要顶层出现任何一个，主题块的值就会被它盖掉。
    for (const token of [
      "--background:",
      "--card:",
      "--primary:",
      "--accent:",
      "--border:",
      "--ring:",
    ]) {
      expect(top.includes(token), `顶层不该声明 ${token}`).toBe(false);
    }
  });

  it("主题类与预设属性都挂在 documentElement 上", () => {
    expect(appTsx).toMatch(/document\.documentElement\.classList/);
    expect(appTsx).toMatch(/document\.documentElement\.setAttribute/);
  });
});

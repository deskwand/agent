import { describe, expect, it } from "vitest";

import { appButtonVariants, shouldLeftAlign } from "@renderer/components/app-button";
import { buttonVariants } from "@renderer/components/ui/button";

/**
 * `app-button` 是 vendored `ui/button` 的**非 vendored 包装层** ✓，只做两处**有意的**差异：
 *  ① `ghost` **不带** `hover:text-accent-foreground` ✓（它在部分主题是白色，会把本仓按钮的文字
 *     刷白压在自己的浅色 hover 底上 —— 2026-10-09 用户报障的根因之一 ✓）；
 *  ② 按 token 精确判定后，只给「原生就是居左」的调用方补 `justify-start` ✓。
 *
 * 两处都是**视觉**差异，截图类断言看不见 ⇒ 这里**锁机制** ✓✓，与 `reference-token-alignment.test.ts`
 * / `coding-subscription-edit-row-alignment.test.ts` 同一做法（从源码/产出锁机制 ✓）。
 * ⚠️ 本文件的边界用例全部来自**代码审查时的浏览器实测** ✓，不是想象出来的 ✓。
 */
describe("app-button 包装层", () => {
  it("ghost 不带 hover:text-accent-foreground（用户报障根因①）", () => {
    const ghost = appButtonVariants({ variant: "ghost" });
    expect(ghost).not.toContain("hover:text-accent-foreground");
    expect(ghost).toContain("hover:bg-accent");
  });

  it("真正的 flex 容器才拿到 justify-start", () => {
    expect(shouldLeftAlign("flex w-full items-center gap-2")).toBe(true);
    expect(shouldLeftAlign("inline-flex items-center")).toBe(true);
  });

  it("⚠️ flex-1 / flex-shrink-0 是 flex 子项，不是容器 —— 绝不能注入", () => {
    // 审查实测：`\b` 把 `-` 当边界 ⇒ 这三者误命中 ⇒ 弹窗按钮被推左（偏移 −118px ✗）。
    expect(shouldLeftAlign("flex-1 rounded-lg bg-primary py-2")).toBe(false);
    expect(shouldLeftAlign("flex-shrink-0 rounded px-2")).toBe(false);
    expect(shouldLeftAlign("flex-none")).toBe(false);
  });

  it("只写 w-full text-left（无 flex）的按钮也要居左（用户报障根因②的另一半）", () => {
    // 原生 `<button class="w-full text-left">` 是 text-align:left（居左 ✓）；迁移后 base 的
    // `inline-flex` 让 text-align 失效 ⇒ 实测左内缩 16px → 230px（居中 ✗）。
    expect(shouldLeftAlign("w-full text-left text-sm")).toBe(true);
    expect(shouldLeftAlign("text-start")).toBe(true);
    // 但纯文字按钮**保持居中** ✓（== 原生 text-align:center ✓）
    expect(shouldLeftAlign("w-full rounded-lg bg-primary py-2")).toBe(false);
  });

  it("调用方自己写了 justify-* 就由它赢", () => {
    expect(shouldLeftAlign("flex items-center justify-center")).toBe(false);
    // 写在三元里的也算调用方写过 ✓（SettingsPanel 的实际形态：紧凑时由分支给 justify-center ✓）
    expect(shouldLeftAlign(`flex w-full ${true ? "justify-center p-2.5" : "gap-2.5"}`)).toBe(false);
  });

  it("⚠️ 漂移守卫：与 vendored 变体表逐项比对，只允许两处已记录的差异", () => {
    // 包装层复制了 vendored 的变体表 ⇒ 上游改动**到不了这 105 个文件** ✗（审查 Minor 4）。
    // 这条把「允许的差异」写成可执行的事实 ✓：多一处、少一处都会红 ✓。
    const variants = ["default", "destructive", "outline", "secondary", "ghost", "link"] as const;
    const sizes = ["default", "sm", "lg", "icon"] as const;
    for (const variant of variants) {
      for (const size of sizes) {
        const vendor = buttonVariants({ variant, size }).split(/\s+/).filter(Boolean).sort();
        const app = appButtonVariants({ variant, size }).split(/\s+/).filter(Boolean).sort();
        if (variant !== "ghost") {
          expect(app, `${variant}/${size} 不该与 vendored 有差异`).toEqual(vendor);
        } else {
          expect(vendor.filter((c) => !app.includes(c)), "ghost 只允许少这一条").toEqual([
            "hover:text-accent-foreground",
          ]);
          expect(app.filter((c) => !vendor.includes(c)), "ghost 不该多出任何类").toEqual([]);
        }
      }
    }
  });
});

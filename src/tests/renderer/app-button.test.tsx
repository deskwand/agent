import { describe, expect, it } from "vitest";

import { appButtonVariants, shouldLeftAlign } from "@renderer/components/app-button";
import { buttonVariants } from "@renderer/components/ui/button";

/**
 * `app-button` 是 vendored `ui/button` 的**非 vendored 包装层** ✓，只做三处**有意的**差异：
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
    // ⚠️ 没写 `flex` 的调用点**不会**被注入 ✓ —— 消息区图标按钮就靠这一条：它们只要颜色类，
    // 居中由 base 的 `justify-center` 负责（2026-10-10：写了 `flex` 的那几个被注成靠左，实测
    // 图标左 0 / 右 12 ✗；显式 `justify-center` 后 6 / 6 ✓）。
    expect(shouldLeftAlign("text-muted-foreground hover:text-foreground transition-colors")).toBe(false);
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

  it("⚠️ 漂移守卫：与 vendored 变体表逐项比对，只允许三处已记录的差异", () => {
    // 包装层复制了 vendored 的变体表 ⇒ 上游改动**到不了这 105 个文件** ✗（审查 Minor 4）。
    // 这条把「允许的差异」写成可执行的事实 ✓：多一处、少一处都会红 ✓。
    const variants = ["default", "destructive", "outline", "secondary", "ghost", "link"] as const;
    const sizes = ["default", "sm", "lg", "icon"] as const;
    for (const variant of variants) {
      for (const size of sizes) {
        const vendor = buttonVariants({ variant, size }).split(/\s+/).filter(Boolean).sort();
        const app = appButtonVariants({ variant, size }).split(/\s+/).filter(Boolean).sort();
        if (variant === "link") {
          // 第二处有意差异（强调色维度上线后新增）：link 的文字色必须是"强调色文字档"
          // `--primary-text`，不能用填充色 `--primary` —— 官方 accent 的亮色 lime/neutral
          // 当文字只有 1.53:1。vendored 文件不知道这个档，所以只能在这里登记。
          expect(
            vendor.filter((c) => !app.includes(c)),
            "link 只允许少 text-primary",
          ).toEqual(["text-primary"]);
          expect(
            app.filter((c) => !vendor.includes(c)),
            "link 只允许把 text-primary 换成 text-primary-text",
          ).toEqual(["text-primary-text"]);
        } else if (variant !== "ghost") {
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

  it("app 层独有的紧凑三档 xs / iconSm / iconXs —— 默认档的垫子一个都不许留", () => {
    // ⚠️ 这三档**只有 app 层有** ✓（vendored 的表里没有）⇒ 本用例**能编译**本身即一道锁 ✓：
    // 谁把 `xs` / `iconSm` / `iconXs` 从 `app-button.tsx` 删掉，这里立刻 TS 报错 ✓✓；
    // 而 `buttonVariants({ variant: "ghost", size: "iconSm" })` 会**编译失败** ✓ —— 差异是单向的 ✓。
    // 2026-10-10 用户报障「元数据的这个框太大了」的由来：缺省档 `h-9 px-4 py-2` 一直在场，而那几处
    // 只写了 `h-auto`（只顶掉高度 ✗）⇒ 16px 图标被 16/8 的内边距撑成 48×32 ✓（Chromium 实测 ✓）。
    const tokensOf = (size: "xs" | "iconSm" | "iconXs") =>
      appButtonVariants({ variant: "ghost", size }).split(/\s+/);
    const xs = tokensOf("xs");
    const iconSm = tokensOf("iconSm");
    const iconXs = tokensOf("iconXs");
    for (const [name, tokens] of [
      ["xs", xs],
      ["iconSm", iconSm],
      ["iconXs", iconXs],
    ] as const) {
      for (const slab of ["h-9", "px-4", "py-2", "h-auto"]) {
        expect(tokens, `${name} 不该带默认档的 ${slab}`).not.toContain(slab);
      }
    }
    // 尺寸：带字那档 24px 高；图标那档 28×28 —— 与仓库既有的 `w-7 h-7` 图标键（`BrowserPanel` /
    // `TitlebarButton` / `ReviewPanel`）**同尺寸** ✓，这档位只是给那个既有约定一个名字 ✓。
    expect(xs, "xs 应该是 24px 高").toContain("h-6");
    expect(xs, "带字的档不该定宽（靠内容撑宽）").not.toContain("w-6");
    expect(iconSm, "iconSm 应该是 28px 高").toContain("h-7");
    expect(iconSm, "纯图标那档必须同时定宽 —— 缺省档本身没有 w-*").toContain("w-7");
    // `iconXs` 是 24² 的纯图标档（菜单行首的星标槽：6px 容器 + 24px 槽 + 4px = 34px）。
    // 它存在的理由是一条实测：调用点只写 `h-6 w-6` 而不给档位时，**默认档的 `px-4 py-2`
    // 仍在场**，而 border-box 的宽度下限是内边距之和 ⇒ 槽位撑成 32px、星标右移 4px、
    // 行名右移 8px（2026-10-10 用户报障「slash 菜单图标没有对齐」的根因 ✓）。
    expect(iconXs, "iconXs 该是 24px 高").toContain("h-6");
    expect(iconXs, "纯图标那档必须同时定宽").toContain("w-6");
    // `xs` 带 `text-xs` ⇒ 顶掉 base 的 `text-sm` ✓（`cn` 合并同类、后来者胜 ✓）；
    // 图标那档不带字号，避免把调用点的文字改小 ✓。
    expect(xs).toContain("text-xs");
    expect(iconSm).not.toContain("text-xs");
    expect(iconXs).not.toContain("text-xs");
  });
});

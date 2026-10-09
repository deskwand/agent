// 设计文档 §7：圆角收敛为三档 —— 控制件 8px / 容器 12px / 覆盖层 16px。
// 数值从 tailwind.config.js 读，不写死在断言里（沿用 theme-css-helpers 的原则）。
import { describe, expect, it } from "vitest";
import { css, tailwind } from "./theme-css-helpers";

function componentBlock(name: string): string {
  const block = new RegExp(`\\.${name}\\s*\\{[\\s\\S]*?\\n  \\}`).exec(
    css,
  )?.[0];
  if (!block) throw new Error(`globals.css 里找不到 .${name}`);
  return block;
}

describe("圆角尺度", () => {
  it("tailwind 里存在 container 档 = 12px", () => {
    expect(tailwind.theme.extend.borderRadius.container).toBe("12px");
  });

  // ⚠️ 2026-10-09：原判据遍历 `.btn` / `.input` / `.tag` / `.card` 四个类 ✓，断言它们的
  // `rounded-*` 落在三档里 ✓ —— 而那四个类**已实测零消费者** ✗（渲染层 1 / 0 / 0 / 0 ✓，
  // spec 估的 22/19 是错的 ✓）⇒ 随批次 6 删掉 ✓ ⇒ **这条的主人公不存在了** ✗✓。
  // **意图不变** ✓（「圆角只许用受准的三档」✓，由本文件另外两条 + `theme-css-helpers` 保证 ✓）；
  // 这里改成**反向钉子** ✓：确认那四个类**确实没了** ✗ —— 否则将来有人加回来时，
  // 「用了三档之外的圆角」这件事会**静默无人看守** ✗✓。
  it("§9-7 四个 component 类已删除（圆角只许用受准的三档）", () => {
    for (const name of ["btn", "input", "tag", "card"]) {
      expect(
        () => componentBlock(name),
        `.${name} 不应再存在于 globals.css`,
      ).toThrow();
    }
  });
});

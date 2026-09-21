// 设计文档 §7：圆角收敛为三档 —— 控制件 8px / 容器 12px / 覆盖层 16px。
// 数值从 tailwind.config.js 读，不写死在断言里（沿用 theme-css-helpers 的原则）。
import { describe, expect, it } from "vitest";
import { css, radiusPx, tailwind } from "./theme-css-helpers";

/** 三档：8（控制件）/ 12（容器）/ 16（覆盖层）。 */
const ALLOWED = [8, 12, 16];

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

  it("§9-7 四个 component 类的圆角属于 {8, 12, 16} 且落在指定档位", () => {
    const expected: Record<string, number> = {
      btn: 8,
      input: 8,
      tag: 8,
      card: 12,
    };
    for (const [name, px] of Object.entries(expected)) {
      const block = componentBlock(name);
      const rounded = /rounded-[\w-]+/.exec(block)?.[0];
      expect(rounded, `.${name} 里没有 rounded-* 类`).toBeTruthy();
      expect(ALLOWED, `.${name} 用了三档之外的圆角 ${rounded}`).toContain(px);
      expect(radiusPx(rounded!), `.${name} 的 ${rounded}`).toBe(px);
    }
  });
});

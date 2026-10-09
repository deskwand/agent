// `cn` 是 shadcn 组件的类名合并入口。
//
// 只测一条，因为 `cn` 是第三方包，其余语义由库自身保证。
// 这一条是本次迁移的关键依赖：**同名 Tailwind 属性后者胜出**。
//
// 为什么非它不可：本仓过去用 menu-styles.ts 的 74 行注释手工对抗这个问题
//（见该文件关于「胜出顺序由生成 CSS 决定，不由 className 书写顺序决定」的说明）。
// 全量替换 456 个按钮时，调用方传 className 覆盖组件默认样式是最常见的改法；
// 若 cn 退化成纯 clsx（无 merge），那种覆盖会**静默失效**。
//
// 注意：本文件在 tailwind 的 content 扫描范围内，类名必须用模板拼接，
// 不能写出完整的工具类字面量（会被当成用法真的生成出来）。
import { describe, expect, it } from "vitest";
import { cn } from "../../renderer/utils/cn";

describe("cn", () => {
  it("lets a later class win over an earlier one with the same property", () => {
    const p = (n: number) => `p-${n}`;
    expect(cn("flex", p(2), p(4))).toBe(`flex ${p(4)}`);
  });
});

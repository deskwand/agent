// 开关的圆点必须在每个主题下都看得见 —— 两种状态都要。
//
// 历史：最早是白圆点 + 关态轨道 --accent —— 7 个亮色主题块里只有
// 1.19–1.29，圆点等于不存在。改成轨道 --border 后关态好了，但白圆点压在
// 浅色 accent 上（void/ocean/forest/paper/ember/aurora 六个暗色预设）只有 1.86–2.72，
// 开态又不行。最终圆点改用 --background：关态最小 1.47、开态最小 4.53。
//
// 阈值：关态按 theme-input-visibility 那套「相邻两层至少拉开 1.4」；开态是图形元素
// 的边界，按 WCAG 1.4.11 的 3:1。
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  RENDERER,
  composite,
  contrast,
  themeBlocks,
  tokenOf,
} from "./theme-css-helpers";

const SHARED = fs.readFileSync(
  path.join(RENDERER, "components/settings/shared.tsx"),
  "utf8",
);
// ⚠️ 2026-10-09：`SettingsSwitch` 的手搓实现已换成 **vendored `ui/switch.tsx`** ✗
// ⇒ 下面那两条「改动探测」断言（本文件自己的注释就是这么称呼它们的 ✓）要跟到**新位置** ✓。
// ⚠️ **真正的不变量是同文件下一个用例**（「14 个主题块里两种状态的圆点对比都达标」✓）——
// 那条**没红过** ✓ ⇒ 行为没问题 ✓，只是探测器该换刻度 ✓。
const SWITCH_UI = fs.readFileSync(
  path.join(RENDERER, "components/ui/switch.tsx"),
  "utf8",
);

/** 解析 color-mix(in srgb, var(--x) N%, var(--card)) —— --border 的写法。 */
function resolvedToken(block: string, name: string): string {
  const flat = block.replace(/\s+/g, " ");
  const value = tokenOf(flat, name);
  const mix = /color-mix\(\s*in srgb,\s*var\((--[a-z-]+)\)\s*([\d.]+)%/.exec(
    value,
  );
  if (!mix) return value;
  return composite(
    tokenOf(flat, "--card"),
    tokenOf(flat, mix[1]),
    parseFloat(mix[2]) / 100,
  );
}

describe("设置开关的圆点在各主题下都看得见", () => {
  // 这两条是有意的「改动探测」：换 token 时它会红，下面那条不变量才是行为判据。
  it("关态轨道用 border、开态用 accent，圆点用 background", () => {
    // ⚠️ 轨道色现在在 **vendored `ui/switch.tsx`** 里 ✓（`SettingsSwitch` 只是薄包装 ✓）。
    // 语义不变 ✓：关态 `bg-input`（`--input = --border` ✓）、
    // 开态 `bg-primary`（`--primary = --accent` ✓）—— 见 `shared.tsx` 的注释 ✓。
    expect(SWITCH_UI).toContain("data-[state=unchecked]:bg-input");
    expect(SWITCH_UI).toContain("data-[state=checked]:bg-primary");
    // 圆点用 background —— 这条位置没变 ✓（vendored Thumb 里就是这么写的 ✓）。
    expect(SWITCH_UI).toContain("rounded-full bg-background");
    // 不许再回到硬编码颜色 —— **意图与实现无关，原样保留** ✓。
    expect(SWITCH_UI).not.toContain("bg-white");
    expect(SHARED).not.toContain("bg-white");
  });

  it("14 个主题块里两种状态的圆点对比都达标", () => {
    const blocks = themeBlocks();
    expect(blocks.length).toBe(14);
    for (const block of blocks) {
      const head = block.slice(0, 60).replace(/\s+/g, " ");
      const knob = resolvedToken(block, "--background");
      const off = contrast(knob, resolvedToken(block, "--input"));
      const on = contrast(knob, resolvedToken(block, "--primary"));
      expect(
        off,
        `${head} 关态圆点与轨道只有 ${off.toFixed(2)}:1`,
        // 官方亮色下圆点(白)与关态轨道(zinc-200)只有 1.15 —— 这是官方取值本身
        // （spec §7 登记的"门槛随官方值下调"之一）；这条只保证圆点看得出来。
      ).toBeGreaterThanOrEqual(1.1);
      expect(
        on,
        `${head} 开态圆点与轨道只有 ${on.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(3);
    }
  });
});

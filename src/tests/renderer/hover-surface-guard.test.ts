// 悬停底色只能走 --hover-surface（含 vendored ui/）。
//
// 判据（2026-10-26 现场实测）：官方 --accent 亮色 #f4f4f5 压在白底 1.099、
// 侧边栏 1.017、muted 面 1.000（与 --muted/--secondary 同值）—— 要么看不见、
// 要么零变化。
//
// 第二条用例是「钉住」：vendored 的四个文件被本仓改过皮肤类，
// 将来重新 vendor 上游会把它们静默改回 --accent；这条让回退当场红。
// （刻意不写「新 token 至少出现 N 次」那类计数断言：类被删掉时组件断言本来就会红，
//  计数只会变成一个到期就腐的魔数。）
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { RENDERER } from "./theme-css-helpers";

/** 会画出「悬停反馈」的变体前缀族；`data-[…]:` 那一支管的是开态 / 选中态。 */
const BAD = [
  /(?:group-|peer-)?(?:hover|focus|focus-visible|focus-within|active):bg-(?:accent|muted)(?![\w-])/,
  /data-\[[^\]]*\]:bg-(?:accent|muted)(?![\w-])/,
];

/** `@apply` 也能把旧底写回产物里 —— globals.css 一行的威力比组件更大。 */
const BAD_APPLY =
  /@apply[^;]*(?:hover|focus|focus-visible|active):bg-(?:accent|muted)/;

/** 静止底本身就是 `bg-muted` / `bg-accent` 的元素：hover 再走 hover-surface 会
 *  「几乎没变化」（亮色 1.037），必须走 selected-surface 那一档（1.10）。 */
const RESTING_TINT = /(?<![:-])\bbg-(?:muted|accent)(?![\w-])/;
const HOVER_SURFACE = /hover:bg-hover-surface/;

/** 允许保留旧写法的地方：文件相对路径 + 说明。目前只有一处装饰性底板。 */
const ALLOWED: Array<[string, RegExp, string]> = [
  [
    "components/ui/dialog.tsx",
    /data-\[state=open\]:bg-accent/,
    "vendored DialogClose 的开态底板：弹窗一打开它就常驻，是静态底板而不是悬停/选中反馈",
  ],
];

/** 该行是否已被登记为允许项。 */
function allowed(rel: string, line: string): boolean {
  return ALLOWED.some(([file, re]) => rel === file && re.test(line));
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(abs, out);
    else if (/\.(?:tsx?|css)$/.test(entry.name)) out.push(abs);
  }
  return out;
}

describe("悬停底色统一走 hover-surface", () => {
  it("全仓不再有 hover:bg-accent / hover:bg-muted / focus:bg-accent", () => {
    const offenders: string[] = [];
    for (const abs of sourceFiles(RENDERER)) {
      const rel = path.relative(RENDERER, abs);
      fs.readFileSync(abs, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (allowed(rel, line)) return;
          if (BAD.some((re) => re.test(line)) || BAD_APPLY.test(line)) {
            offenders.push(`${rel}:${i + 1}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });

  it("静止底已是浅色块的元素，hover 不许再走 hover-surface（那里几乎没有变化）", () => {
    const offenders: string[] = [];
    for (const abs of sourceFiles(RENDERER)) {
      const rel = path.relative(RENDERER, abs);
      if (!/\.tsx?$/.test(rel)) continue;
      fs.readFileSync(abs, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (RESTING_TINT.test(line) && HOVER_SURFACE.test(line)) {
            offenders.push(`${rel}:${i + 1}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });

  it("选中态不许被 hover 降级（data-[…]:hover 覆盖 selected-surface）", () => {
    const offenders: string[] = [];
    for (const abs of sourceFiles(RENDERER)) {
      const rel = path.relative(RENDERER, abs);
      fs.readFileSync(abs, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (
            /data-\[[^\]]*\]:hover:bg-(?:hover|selected)-surface/.test(line)
          ) {
            offenders.push(`${rel}:${i + 1}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });

  it("vendored 的悬停皮肤被钉住（重新 vendor 丢不掉）", () => {
    const pinned: Array<[string, string]> = [
      ["components/ui/button.tsx", "hover:bg-hover-surface"],
      ["components/ui/table.tsx", "hover:bg-hover-surface"],
      ["components/ui/toggle.tsx", "hover:bg-hover-surface"],
      ["components/ui/dropdown-menu.tsx", "focus:bg-hover-surface"],
      ["components/ui/toggle.tsx", "data-[state=on]:bg-selected-surface"],
      [
        "components/ui/dropdown-menu.tsx",
        "data-[state=open]:bg-selected-surface",
      ],
      ["components/ui/table.tsx", "data-[state=selected]:bg-selected-surface"],
    ];
    for (const [rel, token] of pinned) {
      const source = fs.readFileSync(path.join(RENDERER, rel), "utf8");
      expect(source, `${rel} 缺 ${token}`).toContain(token);
    }
  });
});

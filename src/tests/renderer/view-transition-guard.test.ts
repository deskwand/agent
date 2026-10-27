// 视图转场与滚动方式守卫（第 40 / 43 项）。
//
// 第 40 项只钉**视图级**挂载淡入：WelcomeView。
// 内容级 animate-fade-in（ThinkingBlock、ToolResultBlock、BashToolBlock、FileToolBlock、
// ToolUseBlock 共 12 处）是刻意的流式渐显，不在本项口径内 —— 所以**不能**全仓扫描。
// ScheduleEditModal 的遮罩淡入也刻意保留；Task 2 迁移后它的外壳（含遮罩淡入/缩放）
// 由 Radix Dialog 的 `data-[state=open]:animate-in` 提供（Schedule 弹层使用 Radix 动画，
// 不再是本仓的 animate-fade-in / animate-slide-up 类）。
//
// ⚠️ 本文件在 tailwind content 扫描范围内 ⇒ 字面量拆开拼（见 focus-ring-css.test.ts 文件头）。
//
// ⚠️ 2026-10-11 评审修复：只禁 `behavior: "smooth"` 是不够的 ——
// CSSOM View 里 `behavior: "auto"` 的语义是「由容器的 scroll-behavior 计算值决定」，
// 所以有人给 html 或 .overflow-y-auto 加一条 `scroll-behavior: smooth`，
// 这些滚动就会**静默**恢复动画，而原守卫仍是绿的。现在两条一起钉：
//   · 程序化滚动必须显式 `"instant"`（不得留 `"auto"`）
//   · 全仓不得出现 CSS `scroll-behavior: smooth`
// `"instant"` 三处调用形式都已在内置浏览器实测（Electron 35.7.5 / Chromium 134）：
// window.scrollTo / element.scrollTo / scrollIntoView 都接受，不抛 TypeError。
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RENDERER } from "./theme-css-helpers";

const VIEW_FADE = "animate-fade" + "-in";

/** 视图级组件 —— 这些文件里不允许出现挂载淡入。 */
const VIEW_FILES = ["components/WelcomeView.tsx"];

function read(rel: string): string {
  return fs.readFileSync(path.join(RENDERER, rel), "utf8");
}

/** 该源码里平滑滚动的处数。导出以便用内联 fixture 做正控。 */
export function smoothScrollCountInSource(sourceText: string): number {
  return (sourceText.match(/behavior:\s*["']smooth["']/g) ?? []).length;
}

/** 该源码里显式 `behavior: "auto"` 的处数（规范上它仍受 CSS scroll-behavior 影响）。 */
export function autoBehaviorCountInSource(sourceText: string): number {
  return (sourceText.match(/behavior:\s*["']auto["']/g) ?? []).length;
}

/** 该源码里 CSS `scroll-behavior: smooth` 的处数。
 *  `\b` 是必要的：`overscroll-behavior` 里含 `scroll-behavior` 子串，那是另一个属性。 */
export function cssSmoothBehaviorCountInSource(sourceText: string): number {
  return (sourceText.match(/\bscroll-behavior:\s*smooth/g) ?? []).length;
}

/** 按扩展名扫全仓，收集命中给定判据的文件。 */
function offenders(
  hit: (source: string) => boolean,
  extensions: string[],
): Set<string> {
  const out = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (extensions.some((ext) => entry.name.endsWith(ext))) {
        if (hit(fs.readFileSync(abs, "utf8"))) {
          out.add(path.relative(RENDERER, abs));
        }
      }
    }
  };
  walk(RENDERER);
  return out;
}

describe("视图转场与滚动方式守卫", () => {
  it("正控：判据本身必须抓得到平滑滚动", () => {
    expect(
      smoothScrollCountInSource(
        `el.scrollIntoView({ block: "start", behavior: "smooth" });`,
      ),
    ).toBe(1);
    expect(
      smoothScrollCountInSource(
        `c?.scrollTo({ top: c.scrollHeight, behavior: 'smooth' });`,
      ),
    ).toBe(1);
  });

  it("负控：瞬时滚动不算违规（instant 与不传 behavior 都放过）", () => {
    expect(
      smoothScrollCountInSource(
        `el.scrollIntoView({ block: "start", behavior: "instant" });`,
      ),
    ).toBe(0);
    expect(
      smoothScrollCountInSource(`el.scrollIntoView({ block: "start" });`),
    ).toBe(0);
  });

  it("正控/负控：auto 判据抓得到 auto、放过 instant；CSS 判据不被 overscroll-behavior 骗", () => {
    expect(
      autoBehaviorCountInSource(`c.scrollTo({ top: 0, behavior: "auto" });`),
    ).toBe(1);
    expect(
      autoBehaviorCountInSource(`c.scrollTo({ top: 0, behavior: "instant" });`),
    ).toBe(0);
    expect(
      cssSmoothBehaviorCountInSource(`html { scroll-behavior: smooth; }`),
    ).toBe(1);
    // `overscroll-behavior` 里含 `scroll-behavior` 子串 —— 必须靠 \b 排除
    expect(
      cssSmoothBehaviorCountInSource(`body { overscroll-behavior: none; }`),
    ).toBe(0);
    expect(
      cssSmoothBehaviorCountInSource(`body { overscroll-behavior: smooth; }`),
      "overscroll-behavior: smooth 是另一回事，不该被判违规",
    ).toBe(0);
  });

  it("视图级组件不得有挂载淡入", () => {
    for (const rel of VIEW_FILES) {
      expect(read(rel), `${rel} 仍有视图级淡入`).not.toContain(VIEW_FADE);
    }
  });

  it("集合为空 ⇒ 全仓再无程序化平滑滚动；任何新增都会当场红", () => {
    expect(
      [...offenders((s) => smoothScrollCountInSource(s) > 0, [".tsx", ".ts"])],
      '程序化滚动一律 behavior: "instant"（原生是瞬时到位）',
    ).toEqual([]);
  });

  it("集合为空 ⇒ 程序化滚动不得留显式 auto（它受 CSS scroll-behavior 影响）", () => {
    expect(
      [...offenders((s) => autoBehaviorCountInSource(s) > 0, [".tsx", ".ts"])],
      '程序化滚动写 "instant"，别写 "auto"',
    ).toEqual([]);
  });

  it("集合为空 ⇒ 全仓无 CSS scroll-behavior: smooth（含 .css）", () => {
    expect(
      [
        ...offenders(
          (s) => cssSmoothBehaviorCountInSource(s) > 0,
          [".tsx", ".ts", ".css"],
        ),
      ],
      "scroll-behavior: smooth 会让所有显式 auto 的滚动恢复动画，一并禁掉",
    ).toEqual([]);
  });
});

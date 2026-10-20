// 可选性分层守卫（第 22 项）。
//
// 判据：UI 骨架不可选中，内容区必须可选中。**不能只断言 body 上有 none** ——
// 那样「顺手把内容也禁掉」会静默变绿，而这是功能回退（工具块输出 / 评审 diff / 通知正文都要能复制）。
//
// ⚠️ 别用 `@apply select-none` 写这条规则：仓库里 message-card-action-bar.test.ts:126
// 在 DOM 上找 `.select-none` 元素，用 @apply 会把它编译成 CSS 而不产生 DOM 节点（仍是绿的），
// 但语义上容易误导后来人。这里直接写声明。
//
// ⚠️ 解析前必须剥掉注释（已实测）：allowlist 规则自带一段注释，里面就会写到
// `[contenteditable]`、`pre`、`.prose-chat` 这些选择器名。不剥的话 `[^{}]+?` 会把注释文本
// 吸进「选择器串」，于是**从选择器里删掉 `[contenteditable]`、只把它留在注释里，断言照样绿**
// —— 假绿。既有先例：focus-ring-css.test.ts 就是先 `replace(/\/\*[\s\S]*?\*\//g, "")` 再断言。
//
// ⚠️ 本文件里有两条规则都声明 `user-select: text`（allowlist 与 `.selectable` 工具类），
// 所以**不能**按「第一条声明 text 的规则」定位 allowlist（执行时实测：那样会取到工具类那条）。
// 定位判据改用选择器特征。
//
// ⚠️ 2026-10-11 评审修复：`selectableCountInSource` 从「子串计数」改成 **AST 定位 className**。
// 子串计数有两条假绿：`unselectable` 这类英文词算命中，以及**只在注释里写一句 selectable**
// 就算命中 —— 而 `SELECTABLE_SURFACES` 只断言 >0，所以「删掉类名、注释留个词」会静默通过。
// 与 button-compact-guard.test.ts 用 `ts.createSourceFile` 走 AST 的既有手法一致。
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  SELECTION_ALLOW,
  SELECTION_SUPPRESS,
} from "../../renderer/utils/selection-menu";
import { css, RENDERER } from "./theme-css-helpers";

/** 剥掉注释：注释里的选择器名不能当成选择器（见文件头）。 */
const declarations = css.replace(/\/\*[\s\S]*?\*\//g, "");

/** globals.css 里所有 `2 空格缩进的选择器 { … 2 空格缩进的 }` 规则。 */
function allRules(): { selector: string; body: string }[] {
  return [
    ...declarations.matchAll(/^ {2}([^{}]+?)\s*\{([\s\S]*?)^ {2}\}/gm),
  ].map((m) => ({ selector: m[1].replace(/\s+/g, " ").trim(), body: m[2] }));
}

/** body 规则（`html, body, #root` 那条不会命中，因为选择器串不等于 "body"）。 */
function bodyRule(): { selector: string; body: string } {
  const rule = allRules().find((r) => r.selector === "body");
  if (!rule) throw new Error("globals.css 里找不到 body 规则");
  return rule;
}

/**
 * 内容区 allowlist —— 按「同时含 .prose-chat 与 .message-user-text」定位。
 * 不按「声明 user-select: text」定位：`.selectable` 工具类也声明它，会撞车。
 */
function allowlistRule(): { selector: string; body: string } {
  const rule = allRules().find(
    (r) =>
      r.selector.includes(".prose-chat") &&
      r.selector.includes(".message-user-text"),
  );
  if (!rule) throw new Error("globals.css 里找不到内容区 allowlist 规则");
  return rule;
}

/** `@layer utilities` 里的 `.selectable` 工具类。 */
function selectableUtility(): { selector: string; body: string } {
  const rule = allRules().find((r) => r.selector === ".selectable");
  if (!rule) throw new Error("globals.css 里找不到 .selectable 工具类");
  return rule;
}

/**
 * 该源码的 **className 属性值**里 `selectable` 这个词出现了几次。
 * 走 AST 而不是子串计数：注释、`unselectable` 之类英文词都不该算命中（见文件头）。
 * 导出以便用内联 fixture 做正控。
 */
export function selectableCountInSource(sourceText: string): number {
  const sf = ts.createSourceFile(
    "probe.tsx",
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let count = 0;
  const visit = (node: ts.Node) => {
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText() === "className" &&
      node.initializer
    ) {
      count += (node.initializer.getText().match(/\bselectable\b/g) ?? [])
        .length;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return count;
}

/** 该文件里 className 上挂了几个 selectable。 */
function selectableIn(rel: string): number {
  return selectableCountInSource(
    fs.readFileSync(path.join(RENDERER, rel), "utf8"),
  );
}

/**
 * 必须保持可选的内容面。
 *
 * 2026-10-11 评审修复：原先只列 2 个文件，而 allowlist 的失败模式是**静默**的
 * （deny-by-default 下漏一个面 = 用户复制不了，测试却全绿）。终态 bash 输出是
 * `dangerouslySetInnerHTML` 的普通 div（BashToolBlock.tsx:250），既不是 pre 也不是 code，
 * 当时就被漏掉了。现在把评审点出的漏网面全部纳入。
 * `ChatView.tsx` 那一处挂的是**消息列表容器**（无 onClick，不存在拖选误触），
 * 一次覆盖所有工具块 / 待办 / 子代理步骤。
 */
const SELECTABLE_SURFACES = [
  "components/ChatView.tsx",
  "components/ReviewPanel.tsx",
  "components/FeedItemRow.tsx",
  "components/ArtifactPanel.tsx",
  "components/FeedReaderPane.tsx",
  "components/GlobalNoticeToast.tsx",
  "components/ApiDiagnosticsPanel.tsx",
  "components/settings/MarketplaceSkillCard.tsx",
];

describe("可选性分层守卫", () => {
  it("骨架默认不可选中：body 规则必须声明 user-select: none", () => {
    const body = bodyRule().body;
    expect(body).toMatch(/user-select:\s*none/);
    expect(body).toMatch(/-webkit-user-select:\s*none/);
  });

  it("内容区显式放开：allowlist 覆盖输入、代码、弹层与聊天正文", () => {
    const { selector, body } = allowlistRule();
    // 两侧前缀都钉：body 那条钉了 -webkit- 与无前缀两行，这里同口径（Chromium 认无前缀，
    // 但 Safari/旧引擎要走 -webkit-，不对称会让人以为漏了半条）。
    expect(body).toMatch(/-webkit-user-select:\s*text/);
    expect(body).toMatch(/user-select:\s*text/);
    for (const need of [
      "input",
      "textarea",
      "[contenteditable]",
      "pre",
      "code",
      '[role="dialog"]',
      '[role="alertdialog"]',
      ".prose-chat",
      ".message-user-text",
      ".selectable",
    ]) {
      expect(selector, `allowlist 缺少 ${need}`).toContain(need);
    }
  });

  it("`@layer utilities` 里有 .selectable 工具类（同层才能压过 select-none）", () => {
    // 与 allowlist 重复是有意的：allowlist 在 @layer base，压不过 utilities 层的
    // `select-none`（如 VaultView.tsx:1099 那种行）。两处都声明才能两种场景都成立。
    expect(selectableUtility().body).toMatch(/user-select:\s*text/);
  });

  it("正控：AST 判据必须抓得到 className 上的 selectable", () => {
    expect(
      selectableCountInSource(
        `const A = () => (<div className="selectable" />);`,
      ),
    ).toBe(1);
  });

  it("负控：注释里的 selectable、以及 unselectable 这类词都不算命中", () => {
    expect(
      selectableCountInSource(`const A = () => (<div /* selectable */ />);`),
      "注释不该算命中（旧子串实现会误判）",
    ).toBe(0);
    expect(
      selectableCountInSource(
        `const A = () => (<div className="unselectable-x" />);`,
      ),
      "unselectable 不该算命中",
    ).toBe(0);
    expect(
      selectableCountInSource(`// 这里不要 selectable\nconst A = 1;`),
    ).toBe(0);
  });

  it("每个必须可选的内容面都真的挂了 .selectable", () => {
    for (const rel of SELECTABLE_SURFACES) {
      expect(selectableIn(rel), `${rel} 缺少 .selectable`).toBeGreaterThan(0);
    }
  });

  it("JS 的划词名单与 CSS allowlist 双向逐项相等", () => {
    // 两份名单分开维护，漏同步的失败模式是静默的：新面没有划词菜单，测试却全绿。
    const split = (value: string) =>
      value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .sort();
    expect(split(`${SELECTION_ALLOW}, ${SELECTION_SUPPRESS}`)).toEqual(
      split(allowlistRule().selector),
    );
  });
});

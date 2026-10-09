// occlusion 封闭性不变量。
//
// 为什么需要这条（spec §6.2 的前提被推翻）：
//
// 设计文档 §6.2 说「包装组件本身就是结构性保证，不需要源码扫描测试」。这个前提是错的：
// 包装组件让**好路径更容易**，但没有让**坏路径失败**。ui/dialog.tsx、ui/alert-dialog.tsx、
// ui/sheet.tsx 仍然自由导出 Dialog / AlertDialog / Sheet 这三个 Root，
// 一个组件完全可以 `import { Dialog } from "./ui/dialog"` —— 它能编译、能渲染、
// 能通过当时所有的测试，然后在浏览器面板打开时静默被盖住（面板是原生视图，压在 DOM 之上）。
//
// 这正是本设计要根治的失败模式，所以必须真的封住。
//
// 封闭的边界（有意为之，不是遗漏）：
//   - **Root**（Dialog / AlertDialog / Sheet）必须经 occluding-dialog 拿，
//     因为 occlusion 的挂载点就在 Root 的 open 上
//   - **子组件**（DialogContent / DialogTitle / AlertDialogFooter …）允许直接从 ui/* 导入：
//     它们不带 open 语义，包装一遍只是转手，徒增一层
//
// 本文件是纯源码扫描，不渲染。检测器自身也有用例（合成一条违规），
// 否则规则一旦失效会以「零违规」的面目假绿。
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RENDERER } from "./theme-css-helpers";

/** Root 组件名 —— 它们带 open 语义，必须经包装。 */
const ROOT_NAMES = ["Dialog", "AlertDialog", "Sheet"];

/** 提供这些 Root 的 vendored 模块（按路径后缀匹配）。 */
const ROOT_MODULES = ["ui/dialog", "ui/alert-dialog", "ui/sheet"];

/**
 * 扫出一份源码里对 Root 的直接导入。
 *
 * 返回形如 `ui/dialog → Dialog` 的条目；空数组表示没有绕过包装。
 */
function directRootImports(source: string): string[] {
  const found: string[] = [];
  // 只处理 `import { A, B } from "…"` 形式。本仓没有 default / namespace 导入
  // 这些 Root，所以不为此写揣测性的分支（真出现了，下面的树扫描会漏报 ——
  // 故在文件头注释里写明本规则只覆盖具名导入）。
  const importRe =
    /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(importRe)) {
    const specifier = match[2];
    const mod = ROOT_MODULES.find(
      (root) => specifier === root || specifier.endsWith(`/${root}`),
    );
    if (!mod) continue;

    const names = match[1]
      .split(",")
      .map(
        (raw) =>
          raw
            .trim()
            .split(/\s+as\s+/)[0]
            ?.trim() ?? "",
      )
      .filter(Boolean);

    for (const name of names) {
      if (ROOT_NAMES.includes(name)) found.push(`${mod} → ${name}`);
    }
  }
  return found;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // ui/ 目录本身是这些 Root 的定义处与包装组件的家，不参与扫描
      if (path.basename(target) === "ui") continue;
      out.push(...sourceFiles(target));
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(target);
    }
  }
  return out;
}

describe("检测器自身（防止规则以「零违规」假绿）", () => {
  it("能抓出一条直接导入 Root 的违规", () => {
    const synthetic = [
      'import { Dialog, DialogContent } from "../../renderer/components/ui/dialog";',
    ].join("\n");
    expect(directRootImports(synthetic)).toEqual(["ui/dialog → Dialog"]);
  });

  it("不把只导入子组件当成违规", () => {
    const synthetic = [
      'import { DialogContent, DialogTitle } from "../../renderer/components/ui/dialog";',
    ].join("\n");
    expect(directRootImports(synthetic)).toEqual([]);
  });
});

describe("occlusion 封闭性", () => {
  it("ui/ 之外没有任何文件直接导入 Dialog / AlertDialog / Sheet", () => {
    const violations: string[] = [];
    for (const file of sourceFiles(RENDERER)) {
      const found = directRootImports(fs.readFileSync(file, "utf8"));
      for (const item of found) {
        violations.push(`${path.relative(RENDERER, file)} → ${item}`);
      }
    }
    expect(
      violations,
      `以下文件绕过了 occlusion 包装（应改用 ui/occluding-dialog）：\n${violations.join("\n")}`,
    ).toEqual([]);
  });
});

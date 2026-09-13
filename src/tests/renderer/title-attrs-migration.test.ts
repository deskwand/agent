import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const RENDERER = path.resolve(import.meta.dirname, "../../renderer");

/** 某个 tsx 文件里，<button> 上还残留多少个 title 属性。 */
function buttonTitleCount(relPath: string): number {
  const abs = path.join(RENDERER, relPath);
  const sf = ts.createSourceFile(
    abs,
    fs.readFileSync(abs, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let count = 0;
  const visit = (n: ts.Node) => {
    if (ts.isJsxAttribute(n) && n.name.getText() === "title") {
      const el = n.parent.parent;
      if (el.tagName && el.tagName.getText() === "button") count += 1;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return count;
}

/** 刻意保留 title 的按钮（截断文本 / 路径 / 标签看全文，不是操作提示）。
 *  见设计文档 §6.1。数量是该文件允许残留的 button title 数。 */
const ALLOWED_BUTTON_TITLES: Record<string, number> = {
  "components/MergedInputChip.tsx": 2,
  "components/message/ContentBlockView.tsx": 4,
  "components/settings/SettingsLogs.tsx": 1,
  "components/settings/SettingsSkills.tsx": 1,
  "components/SettingsPanel.tsx": 1,
  "components/Sidebar.tsx": 1,
};

function allButtonTitleCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.name.endsWith(".tsx")) {
        const rel = path.relative(RENDERER, abs);
        const n = buttonTitleCount(rel);
        if (n > 0) counts.set(rel, n);
      }
    }
  };
  walk(RENDERER);
  return counts;
}

describe("button title 的全仓不变量", () => {
  it("只剩白名单里那些刻意的截断文本提示", () => {
    const found = allButtonTitleCounts();
    for (const [file, count] of found) {
      expect(count, `${file} 上还有 ${count} 个 button title`).toBe(
        ALLOWED_BUTTON_TITLES[file] ?? 0,
      );
    }
    // 反向检查：白名单条目必须与实际完全一致，否则白名单会慢慢腐烂
    for (const [file, expected] of Object.entries(ALLOWED_BUTTON_TITLES)) {
      expect(found.get(file) ?? 0, `${file} 的白名单数量与实际不符`).toBe(
        expected,
      );
    }
  });

  it("没有硬编码的 title 字面量", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(abs);
        } else if (entry.name.endsWith(".tsx")) {
          if (/title="/.test(fs.readFileSync(abs, "utf8"))) {
            hits.push(path.relative(RENDERER, abs));
          }
        }
      }
    };
    walk(RENDERER);
    expect(hits).toEqual([]);
  });
});

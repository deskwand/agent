import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const RENDERER = path.resolve(import.meta.dirname, "../../renderer");

/**
 * 会把 `title` 透传到原生元素的自有组件（大写开头，必须显式列出）。
 *
 * ⚠️ 这是个**手维护的名单**：口径是「小写标签一律监管 + 大写标签默认放行（只认下列这三个）」。
 * 前提是「透传 `title` 的自有组件就这么三个」（2026-10-10 核过全仓大写标签上的 `title=`：
 * 只剩 `SettingsSection` 与 `UsageView` 的局部 `Box`，两者都把 `title` 渲染成 `<h2>` ✗）。
 * ⇒ 新增一个「透传 title 到原生元素」的自有组件时，**必须补到这里**，否则它会绕过监管。
 */
const TITLE_FORWARDING_COMPONENTS = new Set(["Button", "Input", "Textarea"]);

/**
 * 该标签上的 `title` 算不算「原生 tooltip」。
 *
 * 判据：小写开头 = 原生 DOM 元素（`div` / `span` / `input` …）⇒ 算；
 * 显式列出的透传组件 ⇒ 算；`iframe` **排除**（它的 title 是**可达名**不是 tooltip）；
 * 其余大写开头的（`ConfirmDialog` / `SettingsRow` / `Box` …）的 `title` 是标题文本 prop ⇒ 不算。
 */
function isNativeTitleHost(tagName: string): boolean {
  if (tagName === "iframe") return false;
  return /^[a-z]/.test(tagName) || TITLE_FORWARDING_COMPONENTS.has(tagName);
}

/** 某个 tsx 文件里，原生元素上还剩多少个 `title` 属性（含透传组件）。 */
function nativeTitleCount(relPath: string): number {
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
      const tag = el.tagName && el.tagName.getText();
      // 2026-10-09 相位 4：标签从 `<button>` 迁到 shadcn 的 `<Button>` ⇒ 两者都要数。
      // 2026-10-10：口径从「只数按钮」扩到「所有原生宿主」—— 原先只有按钮受管，
      // div / span 上的 title（含热力图）无人拦，新加一个也不会红。
      if (tag && isNativeTitleHost(tag)) count += 1;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return count;
}

/**
 * 刻意保留原生 `title` 的地方 —— 全是**截断兜底 / 路径 / 标签看全文 / 数据值 / 状态说明**，
 * 不是操作提示。数量是该文件允许残留的个数；新增条目与改数字都必须带理由。
 *
 * 操作提示一律走 `app-tooltip`（见 tooltip-placement.test.ts 与设计文档 §6.1）。
 */
const ALLOWED_NATIVE_TITLES: Record<string, number> = {
  // —— 截断文本 / 路径 / 选择器看全文 ——
  "components/ArtifactPanel.tsx": 1, // 产物完整路径
  "components/attach/AttachmentTiles.tsx": 2, // 元素/文件磁贴的完整路径或密库标识
  "components/ChatInputQueueBar.tsx": 4, // 队列项全文、图片 chip、文件名、CSS selector
  "components/ChatView.tsx": 1, // 注入条目全文
  "components/FeedReaderPane.tsx": 1, // relevance 全文
  "components/FileBrowser.tsx": 1, // 文件树行的完整路径
  "components/FilePreviewPanel.tsx": 2, // 预览 tab 与标题的完整路径
  "components/MergedInputChip.tsx": 2, // 模型名全文 + 模型/思考等级的控件说明
  "components/message/ContentBlockView.tsx": 2, // 文件链接的完整路径
  "components/message/ElementRefChips.tsx": 1, // 完整 CSS selector
  "components/message/ProcessSummaryBlock.tsx": 1, // 片段全文
  "components/Sidebar.tsx": 2, // 标记完成按钮 + 项目分组完整 cwd
  // —— 状态说明（说明这个元素为什么不可用，不是操作提示） ——
  "components/message/ArtifactCard.tsx": 1, // 「已回退」：解释该行为何点不动
  // —— 数据值（数据密集，不该给每格挂 Radix） ——
  "components/usage/UsageCalendarHeatmap.tsx": 1, // 当天用量/费用
  "components/usage/UsageHourHeatmap.tsx": 1, // 星期 + 小时 + 值
  "components/ScheduleCalendar.tsx": 2, // 日历事件标题 / 标题+时间
  // —— 控件说明（挂在原生 input 上） ——
  "components/settings/SettingsAPI.tsx": 1, // 上下文窗口字段含义
  // —— 既有白名单里的按钮 title（本轮不动） ——
  // 它们挂在 `<Button>` 上，语义更接近操作/状态提示而非「截断看全文」。本轮只补覆盖面
  // （把 div / span / iframe 一并纳入监管），不重新裁决既有条目 —— 要收编它们，
  // 得先有「默认落下方 + 空文案不渲染气泡」那类抽象（下一个独立增量）。
  "components/settings/SettingsLogs.tsx": 1, // 打开日志目录
  "components/settings/SettingsSkills.tsx": 1, // 删除云版本
  "components/SettingsPanel.tsx": 1, // 折叠态 tab 名
};

function allNativeTitleCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.name.endsWith(".tsx")) {
        const rel = path.relative(RENDERER, abs);
        const n = nativeTitleCount(rel);
        if (n > 0) counts.set(rel, n);
      }
    }
  };
  walk(RENDERER);
  return counts;
}

describe("原生 title 的全仓不变量", () => {
  it("只剩白名单里那些刻意的截断文本 / 数据值 / 状态说明", () => {
    const found = allNativeTitleCounts();
    for (const [file, count] of found) {
      expect(count, `${file} 上还有 ${count} 个原生 title`).toBe(
        ALLOWED_NATIVE_TITLES[file] ?? 0,
      );
    }
    // 反向检查：白名单条目必须与实际完全一致，否则白名单会慢慢腐烂
    for (const [file, expected] of Object.entries(ALLOWED_NATIVE_TITLES)) {
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

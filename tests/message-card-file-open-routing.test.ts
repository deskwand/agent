import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function read(relativePath: string): string {
  return readFileSync(resolve(__dirname, relativePath), "utf8");
}

/**
 * 这些是结构守卫。
 *
 * 分流判定（browser → preview → office → fallback 的**顺序**）现在集中在
 * `src/renderer/utils/open-file-by-ext.ts` 的 `resolveOpenAction` 里，顺序保证由
 * `src/tests/renderer/open-file-by-ext.test.ts` 断言。所以这里不再逐处比对各文件内部
 * 的 if 顺序，改为守住"每个入口都走那个集中判定、且没有自己再写一条链"——后者是
 * 真正会漏掉 office 分支的漂移方式。
 */
describe("file open routing goes through the shared classifier", () => {
  const routingFiles = [
    "../src/renderer/components/message/ContentBlockView.tsx",
    "../src/renderer/components/ArtifactPanel.tsx",
    "../src/renderer/components/FileBrowser.tsx",
  ];

  it.each(routingFiles)("%s uses the shared classifier", (file) => {
    expect(read(file)).toContain("resolveOpenAction(");
  });

  it.each(routingFiles)("%s keeps no local three-way chain", (file) => {
    const source = read(file);
    // 本地再写一条 if 链就会漏掉 office 分支——这正是本次要防的漂移。
    expect(source).not.toContain("if (isBrowserOpenableExt(");
    expect(source).not.toContain("if (isPreviewableExt(");
  });

  it("keeps the attachment card clickable via the shared classifier", () => {
    // 附件卡曾用 opensInBrowser / canPreview / opensInOffice 三个标志自己排顺序，
    // 那会把 office 排在 preview 之前、与 resolveOpenAction 分叉；现在统一走判定，
    // 可点击性由判定结果推导。
    const source = read(
      "../src/renderer/components/message/ContentBlockView.tsx",
    );
    expect(source).toContain("resolveOpenAction(attExt)");
    expect(source).toContain('attachmentAction !== "fallback"');
  });
});

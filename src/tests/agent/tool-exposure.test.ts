import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  CODEMODE_EXPOSURE,
  codemodeOnly,
} from "../../main/agent/tools/tool-exposure";
import { createOfficeTools } from "../../main/agent/tools/office/office-tools";

const read = (relative: string) =>
  fs.readFileSync(path.join(process.cwd(), relative), "utf8");

/**
 * A1（design-docs/2026-10-06-tool-exposure-slim-design.md）：偶发工具降到 codemode 层，
 * 不在提示里声明，但仍可从 codemode 调用。这里钉住「哪一组被降级、哪一组没被降级」。
 */
describe("工具 exposure 分层", () => {
  it("codemodeOnly 只改 exposure，不动别的字段", () => {
    // 用真实工具做样本，避免在测试里伪造 ToolDefinition 的品牌类型。
    const [original] = createOfficeTools(process.cwd());
    const [wrapped] = codemodeOnly([original]);
    expect(wrapped).toMatchObject({
      name: original.name,
      description: original.description,
      exposure: "codemode",
    });
    expect(CODEMODE_EXPOSURE).toEqual({ exposure: "codemode" });
  });

  it("office 四个工具都是 codemode 暴露", () => {
    const tools = createOfficeTools(process.cwd());
    expect(tools.map((t) => t.name)).toEqual([
      "office_read_xlsx",
      "office_read_docx",
      "office_read_pptx",
      "office_read_pdf",
    ]);
    for (const tool of tools) expect(tool.exposure).toBe("codemode");
  });

  it("浏览器集群整体降级（被包住的返回数组里正好 12 个工具）", () => {
    const source = read("src/main/agent/agent-runner.ts");
    // 绑到 buildInternalBrowserTools 的那句 return 上：拆掉包裹、或改用别的数组返回，都会红。
    const wrapped = source.match(/return codemodeOnly\(\[([\s\S]*?)\]\);/);
    expect(
      wrapped,
      "buildInternalBrowserTools 的返回数组必须被 codemodeOnly 包住",
    ).not.toBeNull();
    expect((wrapped?.[1].match(/\btd\(/g) ?? []).length).toBe(12);
    expect((source.match(/name: "internal_browser_/g) ?? []).length).toBe(12);
  });

  it("保持 direct 的几组没有混入降级（web / memory / goal）", () => {
    for (const file of [
      "src/main/agent/tools/web-access/web-tools.ts",
      "src/main/memory/memory-tools.ts",
      "src/main/memory/memory-write-tools.ts",
      "src/main/extensions/goal-extension.ts",
    ]) {
      expect(read(file), file).not.toMatch(/exposure:\s*"codemode"/);
      expect(read(file), file).not.toContain("CODEMODE_EXPOSURE");
    }
  });
});

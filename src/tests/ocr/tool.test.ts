import { describe, expect, it } from "vitest";
import {
  formatOcrResult,
  LOW_CONFIDENCE_THRESHOLD,
} from "../../main/agent/tools/ocr";

describe("formatOcrResult", () => {
  it("按行拼接，丢掉空白行", () => {
    expect(
      formatOcrResult([
        { text: "第一行", score: 0.9 },
        { text: "   ", score: 0.2 },
        { text: "第二行", score: 0.9 },
      ]),
    ).toBe("第一行\n第二行");
  });

  it("没有文字时给一句话，不给空串", () => {
    expect(formatOcrResult([])).toBe("No text found in this image.");
    expect(formatOcrResult([{ text: " ", score: 0.9 }])).toBe(
      "No text found in this image.",
    );
  });

  it("平均分低于阈值时在首行提示，正文保留", () => {
    const text = formatOcrResult([
      { text: "模糊字", score: LOW_CONFIDENCE_THRESHOLD - 0.1 },
    ]);
    expect(text.split("\n")[0]).toContain("Low recognition confidence");
    expect(text).toContain("模糊字");
  });

  it("分数全为 0 时不提示，不假装知道置信度", () => {
    expect(formatOcrResult([{ text: "甲", score: 0 }])).toBe("甲");
  });
});

// ── 工具本体：错误分支与门控（spec §9 行 1–2 与 §10 要求覆盖）─────────────

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";
import {
  createOcrTool,
  shouldRegisterOcrTool,
} from "../../main/agent/tools/ocr";
import type { OcrEngine } from "../../main/ocr/engine";

/** 8 字节 PNG 魔数就够 detectImageMimeType 认了。 */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let workspace = "";

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "ocr-tool-"));
});
afterEach(() => rmSync(workspace, { recursive: true, force: true }));

/** 一个只看得到「路径」的假工具调用。 */
async function runTool(
  engine: Partial<OcrEngine> | "throws",
  path: string,
): Promise<string> {
  const tool = createOcrTool({
    workspaceDir: workspace,
    getEngine: async () => {
      if (engine === "throws") throw new Error("ORT 挂了");
      return { recognize: async () => [], ...engine } as OcrEngine;
    },
  });
  const result = (await (
    tool as { execute: (...args: unknown[]) => Promise<unknown> }
  ).execute("call-1", { path }, undefined, undefined, undefined)) as {
    content: Array<{ text: string }>;
  };
  return result.content[0].text;
}

describe("createOcrTool", () => {
  it("文件不存在 → 明确报错，不抛", async () => {
    expect(await runTool({}, "nope.png")).toContain("File not found");
  });

  it("是目录不是文件 → 明确报错", async () => {
    expect(await runTool({}, ".")).toContain("Not a file");
  });

  it("不是图片 → 说明支持哪些格式", async () => {
    writeFileSync(join(workspace, "a.txt"), "hello");
    const text = await runTool({}, "a.txt");
    expect(text).toContain("Not a supported image file");
    expect(text).toContain("PNG");
  });

  it("引擎抛错 → 把原因带回来，不抛", async () => {
    writeFileSync(join(workspace, "a.png"), PNG);
    const text = await runTool("throws", "a.png");
    expect(text).toContain("OCR failed");
    expect(text).toContain("ORT 挂了");
  });

  it("成功时返回格式化后的文字", async () => {
    writeFileSync(join(workspace, "a.png"), PNG);
    const text = await runTool(
      { recognize: async () => [{ text: "识别到的字", score: 0.99 }] },
      "a.png",
    );
    expect(text).toBe("识别到的字");
  });
});

describe("shouldRegisterOcrTool", () => {
  it("开关关着就不注册，哪怕已安装", () => {
    expect(shouldRegisterOcrTool({ enabled: false, installed: true })).toBe(
      false,
    );
    expect(shouldRegisterOcrTool({ installed: true })).toBe(false);
  });

  it("开着但没装也不注册", () => {
    expect(shouldRegisterOcrTool({ enabled: true, installed: false })).toBe(
      false,
    );
  });

  it("开着且装好才注册", () => {
    expect(shouldRegisterOcrTool({ enabled: true, installed: true })).toBe(
      true,
    );
  });
});

/** A1：ocr 降到 codemode 层（见 design-docs/2026-10-06-tool-exposure-slim-design.md）。 */
describe("ocr tool exposure", () => {
  it("is exposed through codemode", async () => {
    const { createOcrTool } = await import("../../main/agent/tools/ocr");
    const tool = createOcrTool({
      workspaceDir: process.cwd(),
      getEngine: async () => {
        throw new Error("unused");
      },
    });
    expect(tool.exposure).toBe("codemode");
  });
});

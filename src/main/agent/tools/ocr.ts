/**
 * @module main/agent/tools/ocr
 *
 * 本地 OCR 工具。只在能力开启且已安装时注册（见 agent-runner）。
 *
 * 与 `vision_describe` 的分工写在工具描述里：只要文字用这个工具（快、离线、不花 token），
 * 要理解画面用视觉模型。两边抢活会让模型选错，所以要写清楚。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { detectImageMimeType } from "./vision-describe";
import type { OcrEngine, OcrLine } from "../../ocr/engine";
import { logError } from "../../utils/logger";

/** 低于这个平均分就在结果首行提示核对原图。 */
export const LOW_CONFIDENCE_THRESHOLD = 0.6;

/**
 * 工具该不该注册。抽成纯函数是因为这是**门控**：开关与安装状态两件事都要对，
 * 而 agent-runner 那段代码没法轻量地单测。
 */
export function shouldRegisterOcrTool(opts: {
  enabled?: boolean;
  installed: boolean;
}): boolean {
  return opts.enabled === true && opts.installed;
}

export function formatOcrResult(lines: OcrLine[]): string {
  const kept = lines.filter((line) => line.text.trim() !== "");
  if (kept.length === 0) return "No text found in this image.";
  const body = kept.map((line) => line.text).join("\n");
  // 分数全为 0 说明上游没给置信度（退回文本拆分那条路）：不要凭空说「置信度低」
  const scored = kept.filter((line) => line.score > 0);
  if (scored.length === 0) return body;
  const average =
    scored.reduce((sum, line) => sum + line.score, 0) / scored.length;
  return average < LOW_CONFIDENCE_THRESHOLD
    ? `Low recognition confidence. Check the original image.\n${body}`
    : body;
}

export function createOcrTool(opts: {
  workspaceDir: string;
  getEngine: () => Promise<OcrEngine>;
}): ToolDefinition {
  // SDK 的 ToolDefinition 用了不透明的品牌类型，与 TypeBox 的普通类型对不上。
  // 这是本仓既有的避让写法（见 vision-describe.ts）。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const td = (t: any): any => t;

  return td({
    name: "ocr",
    label: "Read image text",
    description:
      "Extract text from an image file with the local OCR engine (PP-OCRv6, on this machine, no network). " +
      "Use it when you only need the text: screenshots, photos of documents, scanned pages, UI captures. " +
      "Prefer vision_describe when you need to understand the picture itself (layout, charts, scene) or when " +
      "the image has no text. Returns plain text, one line per detected text line. Images are read locally; " +
      "nothing is uploaded.",
    parameters: Type.Object({
      path: Type.String({
        description:
          "Path to the image file to read (relative to the workspace, or absolute)",
      }),
    }),
    async execute(
      _toolCallId: unknown,
      params: unknown,
      _signal: AbortSignal | undefined,
      _onUpdate: ((update: unknown) => void) | undefined,
      _ctx: unknown,
    ) {
      const { path: filePath } = params as { path: string };
      const resolved = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(opts.workspaceDir, filePath);

      if (!fs.existsSync(resolved)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: File not found: ${filePath}`,
            },
          ],
        };
      }
      if (!fs.statSync(resolved).isFile()) {
        return {
          content: [
            { type: "text" as const, text: `Error: Not a file: ${filePath}` },
          ],
        };
      }
      if (!detectImageMimeType(resolved)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: Not a supported image file: ${filePath}. Supported: PNG, JPEG, GIF, WebP, BMP.`,
            },
          ],
        };
      }

      try {
        const engine = await opts.getEngine();
        const lines = await engine.recognize(resolved);
        return {
          content: [{ type: "text" as const, text: formatOcrResult(lines) }],
        };
      } catch (error) {
        logError("[Ocr] tool failed:", error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: OCR failed for ${filePath}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        };
      }
    },
  });
}

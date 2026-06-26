/**
 * @module main/agent/tools/vision-describe
 *
 * Vision model tool — reads an image file and returns a text description
 * via a separately configured vision model. Exposed as a customTool to the
 * pi-coding-agent SDK so the main model can call it when it needs to
 * "see" an image but lacks multimodal support.
 */
import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import * as fs from "fs";
import * as path from "path";
import type { VisionModelConfig } from "../../../shared/api-model-presets";
import type {
  SharedProviderType,
  SharedCustomProtocolType,
} from "../../../shared/api-model-presets";
import { log, logError } from "../../utils/logger";

// ── MIME detection (portable, no dependencies) ──────────────────────

const IMAGE_SIGNATURES: Array<{
  offset: number;
  bytes: number[];
  mimeType: string;
  ext: string;
}> = [
  { offset: 0, bytes: [0xff, 0xd8, 0xff], mimeType: "image/jpeg", ext: ".jpg" },
  { offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47], mimeType: "image/png", ext: ".png" },
  { offset: 0, bytes: [0x47, 0x49, 0x46, 0x38], mimeType: "image/gif", ext: ".gif" },
  { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46], mimeType: "image/webp", ext: ".webp" },
  { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50], mimeType: "image/webp", ext: ".webp" },
  { offset: 0, bytes: [0x42, 0x4d], mimeType: "image/bmp", ext: ".bmp" },
];

export function detectImageMimeType(filePath: string): string | null {
  try {
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(12);
    fs.readSync(fd, buf, 0, 12, 0);
    fs.closeSync(fd);
    for (const sig of IMAGE_SIGNATURES) {
      let match = true;
      for (let i = 0; i < sig.bytes.length; i++) {
        if (buf[sig.offset + i] !== sig.bytes[i]) {
          match = false;
          break;
        }
      }
      if (match) return sig.mimeType;
    }
    // svg
    const content = fs.readFileSync(filePath, "utf-8").substring(0, 200).trim();
    if (content.startsWith("<svg") || content.startsWith("<?xml")) {
      return "image/svg+xml";
    }
    return null;
  } catch {
    return null;
  }
}

// ── API helpers ─────────────────────────────────────────────────────

function protocolForProvider(
  provider: SharedProviderType,
  customProtocol?: SharedCustomProtocolType,
): "anthropic" | "openai" | "gemini" {
  if (provider === "gemini") return "gemini";
  if (provider === "openai" || provider === "deepseek") return "openai";
  if (provider === "ollama") return "openai";
  if (provider === "custom") {
    if (customProtocol === "openai") return "openai";
    if (customProtocol === "gemini") return "gemini";
    return "anthropic";
  }
  // openrouter: use OpenAI-compatible endpoint
  if (provider === "openrouter") return "openai";
  return "anthropic";
}

async function callAnthropicVision(
  config: VisionModelConfig,
  base64Image: string,
  mimeType: string,
  signal?: AbortSignal,
): Promise<string> {
  const baseUrl = config.baseUrl || "https://api.anthropic.com";
  const url = `${baseUrl.replace(/\/$/, "")}/v1/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mimeType,
                data: base64Image,
              },
            },
            {
              type: "text",
              text: "Please describe this image in detail, in the same language as the content shown in the image. If the image contains text, transcribe it completely.",
            },
          ],
        },
      ],
    }),
    signal,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Vision model API error (${response.status}): ${body.slice(0, 500)}`,
    );
  }

  const data = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  return data.content
    ?.filter((c) => c.type === "text")
    .map((c) => c.text || "")
    .join("\n") || "(no description)";
}

async function callOpenAIVision(
  config: VisionModelConfig,
  base64Image: string,
  mimeType: string,
  signal?: AbortSignal,
): Promise<string> {
  const baseUrl = config.baseUrl || "https://api.openai.com/v1";
  const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`,
              },
            },
            {
              type: "text",
              text: "Please describe this image in detail, in the same language as the content shown in the image. If the image contains text, transcribe it completely.",
            },
          ],
        },
      ],
    }),
    signal,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Vision model API error (${response.status}): ${body.slice(0, 500)}`,
    );
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content || "(no description)";
}

async function callGeminiVision(
  config: VisionModelConfig,
  base64Image: string,
  mimeType: string,
  signal?: AbortSignal,
): Promise<string> {
  const baseUrl =
    config.baseUrl || "https://generativelanguage.googleapis.com";
  const url = `${baseUrl.replace(/\/$/, "")}/v1beta/models/${config.model}:generateContent?key=${encodeURIComponent(config.apiKey)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              inlineData: {
                mimeType,
                data: base64Image,
              },
            },
            {
              text: "Please describe this image in detail, in the same language as the content shown in the image. If the image contains text, transcribe it completely.",
            },
          ],
        },
      ],
    }),
    signal,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Vision model API error (${response.status}): ${body.slice(0, 500)}`,
    );
  }

  const data = (await response.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };
  return (
    data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text || "")
      .join("\n") || "(no description)"
  );
}

async function callVisionModel(
  config: VisionModelConfig,
  base64Image: string,
  mimeType: string,
  signal?: AbortSignal,
): Promise<string> {
  const protocol = protocolForProvider(config.provider, config.customProtocol);

  switch (protocol) {
    case "anthropic":
      return callAnthropicVision(config, base64Image, mimeType, signal);
    case "openai":
      return callOpenAIVision(config, base64Image, mimeType, signal);
    case "gemini":
      return callGeminiVision(config, base64Image, mimeType, signal);
    default:
      throw new Error(`Unsupported vision protocol: ${protocol}`);
  }
}

// ── Tool factory ────────────────────────────────────────────────────

export function createVisionDescribeTool(
  visionConfig: VisionModelConfig,
  workspaceDir: string,
): ToolDefinition {
  // Workaround for SDK ToolDefinition type strictness — the SDK uses opaque
  // branded types that don't match the plain TypeBox schema types at type level.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const td = (t: any): any => t;

  return td({
    name: "vision_describe",
    label: "Describe Image",
    description:
      "Read an image file and return a detailed text description using a dedicated vision model. " +
      "Use this tool when you need to see or read the contents of an image file (PNG, JPEG, GIF, WebP, BMP, SVG). " +
      "The tool returns a plain text description of the image contents, including any text present in the image.",
    parameters: Type.Object({
      path: Type.String({
        description: "Path to the image file to describe (relative or absolute)",
      }),
    }),
    async execute(
      _toolCallId: unknown,
      params: unknown,
      signal: AbortSignal | undefined,
      _onUpdate: ((update: unknown) => void) | undefined,
      _ctx: unknown,
    ) {
      const { path: filePath } = params as { path: string };

      // Resolve path relative to session workspace (pi-ai SDK does not
      // chdir(), so process.cwd() is unreliable for custom tool execution)
      const resolved = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(workspaceDir, filePath);

      // Check file exists
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

      // Check it's a file
      const stat = fs.statSync(resolved);
      if (!stat.isFile()) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: Not a file: ${filePath}`,
            },
          ],
        };
      }

      // Detect image type
      const mimeType = detectImageMimeType(resolved);
      if (!mimeType) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: Not a recognized image format: ${filePath}. Supported formats: PNG, JPEG, GIF, WebP, BMP, SVG.`,
            },
          ],
        };
      }

      // Size check (max 20 MB)
      const MAX_SIZE = 20 * 1024 * 1024;
      if (stat.size > MAX_SIZE) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: Image too large: ${(stat.size / 1024 / 1024).toFixed(1)} MB. Maximum is 20 MB.`,
            },
          ],
        };
      }

      // Read and encode
      const imageBuffer = fs.readFileSync(resolved);
      const base64Image = imageBuffer.toString("base64");

      // SVG: if the file is SVG format, read it as text instead
      if (mimeType === "image/svg+xml") {
        const svgText = imageBuffer.toString("utf-8");
        return {
          content: [
            {
              type: "text" as const,
              text: `[SVG Image — ${(svgText.length / 1024).toFixed(1)} KB]\n\n${svgText}`,
            },
          ],
        };
      }

      try {
        log(
          `[VisionDescribe] Calling vision model (${visionConfig.provider}/${visionConfig.model}) for: ${filePath} (${(stat.size / 1024).toFixed(1)} KB, ${mimeType})`,
        );
        const description = await callVisionModel(
          visionConfig,
          base64Image,
          mimeType,
          signal ?? AbortSignal.timeout(60_000),
        );
        log(
          `[VisionDescribe] Vision model returned ${description.length} chars`,
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `[Image description of ${path.basename(filePath)}]\n\n${description}`,
            },
          ],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logError(`[VisionDescribe] Vision model call failed:`, message);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: Vision model failed to describe the image: ${message}`,
            },
          ],
        };
      }
    },
  });
}

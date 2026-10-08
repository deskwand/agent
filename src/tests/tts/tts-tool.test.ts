/**
 * tts 工具：产物落盘成 wav、模型未装时只指向设置。
 *
 * execute 传 5 个参数是 SDK 的真实签名（房屋惯例见
 * src/tests/agent/todo-tools.test.ts:9）。
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createTtsTool } from "../../main/agent/tools/tts";
import type { TtsSpeakResult } from "../../shared/ipc-types";

type Speak = (text: string) => Promise<TtsSpeakResult>;

/** 工具只知道“读设置里的声音”：来源由接线方决定，所以两件都注入。 */
const options = (speak: Speak, source: "local" | "cloud" = "local") => ({
  workspaceDir: mkdtempSync(join(tmpdir(), "tts-tool-")),
  speak,
  voiceModeSource: () => source,
});

const run = (tool: ReturnType<typeof createTtsTool>, text: string) =>
  tool.execute("call-1", { text }, undefined, undefined, undefined as never);

describe("tts tool", () => {
  it("writes a wav into the workspace and reports the path", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "tts-tool-"));
    const tool = createTtsTool({
      ...options(
        vi.fn(async () => ({
          ok: true as const,
          samples: new Float32Array([0, 0.5, -0.5]),
          sampleRate: 44100,
        })),
      ),
      workspaceDir: workspace,
    });

    const result = await run(tool, "你好");
    const text = (result.content[0] as { text: string }).text;
    const name = text.match(/tts-[\w-]+\.wav/)?.[0];

    expect(name).toBeDefined();
    const bytes = readFileSync(join(workspace, name as string));
    expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
  });

  it("points at the settings page when the model is not installed", async () => {
    const tool = createTtsTool({
      ...options(
        vi.fn(async () => ({
          ok: false as const,
          error: "model not installed",
        })),
      ),
    });

    const result = await run(tool, "你好");
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("not installed");
    // 不触发下载 —— 下载必须由用户在界面上发起
    expect(text).toContain("Settings");
  });

  it("来源=云端时，未配置的文案指向语音卡而不是“模型没装”", async () => {
    const tool = createTtsTool(
      options(
        vi.fn(async () => ({
          ok: false as const,
          error: "cloud not configured",
          code: "unconfigured" as const,
        })),
        "cloud",
      ),
    );
    const result = await run(tool, "你好");
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("cloud voice endpoint");
    expect(text).not.toContain("Text-to-speech model is not installed");
  });
});

/** A1：tts 降到 codemode 层（见 design-docs/2026-10-06-tool-exposure-slim-design.md）。 */
describe("tts tool exposure", () => {
  it("is exposed through codemode", () => {
    const tool = createTtsTool({
      ...options(
        vi.fn(async () => ({
          ok: true as const,
          samples: new Float32Array([0]),
          sampleRate: 44100,
        })),
      ),
      workspaceDir: tmpdir(),
    });
    expect(tool.exposure).toBe("codemode");
  });
});

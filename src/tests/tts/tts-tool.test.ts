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
import type { TtsService } from "../../main/tts/service";

const service = (speak: TtsService["speak"]): TtsService =>
  ({
    isInstalled: () => true,
    load: vi.fn(async () => {}),
    speak,
  }) as TtsService;

const run = (tool: ReturnType<typeof createTtsTool>, text: string) =>
  tool.execute("call-1", { text }, undefined, undefined, undefined as never);

describe("tts tool", () => {
  it("writes a wav into the workspace and reports the path", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "tts-tool-"));
    const tool = createTtsTool({
      workspaceDir: workspace,
      service: service(
        vi.fn(async () => ({
          ok: true as const,
          samples: new Float32Array([0, 0.5, -0.5]),
          sampleRate: 44100,
        })),
      ),
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
      workspaceDir: mkdtempSync(join(tmpdir(), "tts-tool-")),
      service: service(
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
});

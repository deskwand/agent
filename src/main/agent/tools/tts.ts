/**
 * @module main/agent/tools/tts
 *
 * 给模型的朗读工具：把一段文字合成语音，写成 wav 落到工作区。
 *
 * 与界面朗读共用同一个引擎实例（`getTtsService`）—— 两个实例就是两份模型内存。
 * 模型没装时**不触发下载**：工具调用不是用户的显式意图，下载只能由用户在设置里发起。
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Type } from "@sinclair/typebox";
import { CODEMODE_EXPOSURE } from "./tool-exposure";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { encodeWav } from "../../tts/wav";
import type { TtsSpeakResult } from "../../../shared/ipc-types";

export interface TtsToolOptions {
  workspaceDir: string;
  /**
   * 合成入口，**由接线方按来源选**：云端 → `speakCloudOnce`，本机 → `service.speak`。
   * 工具自己不该知道来源是怎么决定的 —— 它只知道“读设置里的声音”。
   */
  speak: (text: string) => Promise<TtsSpeakResult>;
  /** 失败文案要指对地方：云端指语音卡，本机指能力页。 */
  voiceModeSource: () => "local" | "cloud";
}

/** 文件名带时间戳：同一段文字合成两次不该互相覆盖。 */
function outputName(now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").slice(0, 15);
  return `tts-${stamp}.wav`;
}

export function createTtsTool({
  workspaceDir,
  speak,
  voiceModeSource,
}: TtsToolOptions): ToolDefinition {
  // 与 vision-describe 同样的类型绕过：SDK 用不透明的 branded types。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const td = (t: any): any => t;

  return td({
    ...CODEMODE_EXPOSURE,
    name: "tts",
    label: "Text To Speech",
    description:
      "Convert text to speech and save it as a wav file in the workspace. " +
      "It uses the voice configured in Settings (an on-device model or a cloud endpoint). " +
      "Use it when the user asks for an audio file.",
    parameters: Type.Object({
      text: Type.String({ description: "The text to speak." }),
    }),
    async execute(
      _toolCallId: unknown,
      params: unknown,
      _signal: AbortSignal | undefined,
      _onUpdate: ((update: unknown) => void) | undefined,
      _ctx: unknown,
    ) {
      const { text } = params as { text: string };
      const result = await speak(text);
      if (!result.ok) {
        const cloud = voiceModeSource() === "cloud";
        return {
          content: [
            {
              type: "text" as const,
              text:
                // 云端失败给的是 code，不是这句字符串 —— 两边都要认
                result.code === "unconfigured" ||
                result.error === "model not installed"
                  ? cloud
                    ? "The cloud voice endpoint is not configured. Ask the user to set it up in Settings → Capabilities → Voice."
                    : "Text-to-speech model is not installed. Ask the user to enable it in Settings → Capabilities."
                  : `Text-to-speech failed: ${result.error}`,
            },
          ],
        };
      }
      const file = join(workspaceDir, outputName(new Date()));
      writeFileSync(file, encodeWav(result));
      return {
        content: [{ type: "text" as const, text: `Saved to ${file}` }],
      };
    },
  });
}

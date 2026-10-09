/**
 * @module main/agent/tools/set-voice
 *
 * 让**语音会话里的模型**改声音：音色、语速、风格/情绪。
 *
 * 它只写 `voiceMode` 配置 —— **不写工作区文件、不触发任何下载**（下载只能由用户在
 * 设置里发起，与 `tools/tts.ts` 同一条既有原则）。写完立刻生效，因为朗读与语音对话
 * 读的就是同一份配置，调用链一行没动。
 *
 * 与 `tts` 工具的分工（两边说明都要点明，否则模型会叫错）：
 * `tts` = 把文字合成成 wav **文件**；`set_voice` = 改**界面说话**的声音。
 *
 * 只在语音会话可见（`VOICE_TURN.tools` + `VOICE_ONLY_TOOLS` 在普通轮的过滤），
 * 普通文字会话既看不到也调不到。
 */
import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  clampSpeechSpeed,
  MAX_SPEECH_SPEED,
  MIN_SPEECH_SPEED,
  type VoiceModeConfig,
} from "../../../shared/voice-mode";
import { ENGINE_VOICES } from "../../../shared/engine-install";

export interface SetVoiceToolOptions {
  readVoiceMode: () => VoiceModeConfig | undefined;
  /** 与设置卡同一条写通道（`config.save`），不是新的旁路。 */
  saveVoiceMode: (patch: Partial<VoiceModeConfig>) => Promise<void>;
  /** 最佳音质档的引擎此刻可用吗 —— 决定 `voice` 与 `instructions` 是否真的生效。 */
  isBestTierAvailable: () => boolean;
}

/** 音色属性写进说明里：模型据此回答「换成女生」「换北京话」。 */
const VOICE_ATTRIBUTES: Record<string, string> = {
  serena: "female, warm and gentle, Mandarin",
  vivian: "female, bright with a young edge, Mandarin",
  ono_anna: "female, playful and light, Japanese",
  sohee: "female, warm and emotional, Korean",
  uncle_fu: "male, seasoned and mellow, Mandarin",
  dylan: "male, youthful and clear, **Beijing dialect**",
  eric: "male, lively with a husky brightness, **Sichuan dialect**",
  ryan: "male, dynamic and rhythmic, English",
  aiden: "male, sunny with a clear midrange, English",
};

function voiceCatalogue(): string {
  return ENGINE_VOICES.map(
    (v) => `${v.id} (${VOICE_ATTRIBUTES[v.id] ?? "unknown"})`,
  ).join("; ");
}

export function createSetVoiceTool(opts: SetVoiceToolOptions): ToolDefinition {
  // 与 vision-describe / tts 同样的类型绕过：SDK 用不透明的 branded types。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const td = (t: any): any => t;

  return td({
    name: "set_voice",
    label: "Set Voice",
    description:
      "Change how the assistant's own voice sounds (used by read-aloud and voice chat). " +
      "Use it when the user asks to change the voice (gender, dialect, tone, speed), or when a " +
      "different speaking manner genuinely fits what you are about to say. To *produce an audio " +
      "file* instead, use the `tts` tool. " +
      `Available voices: ${voiceCatalogue()}. ` +
      `Only Beijing and Sichuan dialects exist locally — do not promise others. ` +
      `speed is ${MIN_SPEECH_SPEED}-${MAX_SPEECH_SPEED} (out-of-range values are clamped). ` +
      "instructions is the expressive lever — prompt-injected speaking style, which moves pitch and " +
      "energy a lot (measured on the shipped model: up to +25% pitch, +78% energy on the same voice). " +
      "Reach for it when a manner of speaking is wanted, in the language of the conversation, e.g. " +
      "'用嗲声嗲气、撒娇的语气说', '用严肃低沉、像在播报坏消息的语气', '轻快、兴奋一点', '温柔一点，放慢语速'. " + // i18n-allow-cjk
      "It persists across later replies (survives restarts) until changed; pass an empty string to clear it. " +
      "instructions and the chosen voice only take effect on the best-quality tier; " +
      "on the fast/balanced tiers only speed applies. " +
      "Prefer the user's lead: change the voice when they ask for it, not on your own initiative.",
    parameters: Type.Object({
      voice: Type.Optional(
        Type.String({
          description: `One of: ${ENGINE_VOICES.map((v) => v.id).join(", ")}.`,
        }),
      ),
      speed: Type.Optional(
        Type.Number({
          description: `Speaking speed, ${MIN_SPEECH_SPEED}-${MAX_SPEECH_SPEED}. 1 is normal.`,
        }),
      ),
      instructions: Type.Optional(
        Type.String({
          description:
            "Free-form speaking style, in the language of the conversation " +
            "(e.g. '嗲一点、撒娇', '严肃低沉', '轻快兴奋', '温柔放慢'). " + // i18n-allow-cjk
            "Persists until changed; an empty string clears it.",
        }),
      ),
    }),
    async execute(
      _toolCallId: unknown,
      params: unknown,
      _signal: AbortSignal | undefined,
      _onUpdate: ((update: unknown) => void) | undefined,
      _ctx: unknown,
    ) {
      const raw = (params ?? {}) as {
        voice?: unknown;
        speed?: unknown;
        instructions?: unknown;
      };
      const patch: Partial<VoiceModeConfig> = {};

      if (typeof raw.voice === "string" && raw.voice) {
        const wanted = raw.voice.trim();
        if (!ENGINE_VOICES.some((v) => v.id === wanted)) {
          // 不静默忽略：模型会以为改了，用户则听不出来为什么没变
          return {
            content: [
              {
                type: "text" as const,
                text: `Unknown voice "${wanted}". Available: ${ENGINE_VOICES.map((v) => v.id).join(", ")}.`,
              },
            ],
          };
        }
        patch.voiceEngineVoice = wanted;
      }

      let clamped: number | undefined;
      if (typeof raw.speed === "number" && Number.isFinite(raw.speed)) {
        clamped = clampSpeechSpeed(raw.speed);
        patch.voiceSpeed = clamped;
      }

      if (typeof raw.instructions === "string") {
        // 空串（或纯空白）是**显式清空**，不是"没提到"：说明就是这么承诺的，
        // 而且设置里已经没有清空按钮 —— 这里不认空串，用户就再无撤销路径。
        patch.voiceStyle = raw.instructions.trim() ? raw.instructions : "";
      }

      if (Object.keys(patch).length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Nothing to change: pass at least one of voice, speed, instructions.",
            },
          ],
        };
      }

      // 与设置卡同一条写通道。整体替换的语义由调用方合并，这里只给要改的字段。
      await opts.saveVoiceMode(patch);

      const best = opts.isBestTierAvailable();
      const current = { ...(opts.readVoiceMode() ?? {}), ...patch };
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              voice: current.voiceEngineVoice,
              speed: current.voiceSpeed,
              instructions: current.voiceStyle,
              effective: {
                voice: best,
                speed: true,
                instructions: best,
              },
            }),
          },
        ],
      };
    },
  });
}

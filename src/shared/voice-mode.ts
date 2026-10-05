/**
 * @module shared/voice-mode
 *
 * 语音模式的两个设置项。`silenceMs` 夹到 400–2000ms：
 * 低于 400 会把人话里的停顿当成句末，高于 2000 则等得心焦。
 */
export interface VoiceModeConfig {
  silenceMs: number;
  /**
   * 语音模式是否用高速音色。它只表示"我想用" —— 模型在不在由设置行的徽标说
   * （设计 §2 规则 1）。缺字段 = 老配置 = 默认开。
   */
  fastVoice: boolean;
}

/**
 * 1200ms 而不是 800ms：800 会把人说话中间的正常停顿（尤其长句、边想边说）
 * 判成"说完了"，话还没说完就发出去。
 */
export const DEFAULT_VOICE_MODE: VoiceModeConfig = {
  silenceMs: 1200,
  fastVoice: true,
};

export const MIN_SILENCE_MS = 400;
export const MAX_SILENCE_MS = 2000;

/**
 * 两个字段**各自**归一化。
 *
 * 不要退回"任何一个字段坏掉就整体返回默认值"：那样 `{ silenceMs: 垃圾, fastVoice: false }`
 * 会把用户关掉的开关打回 true（`configStore` 写入是整体替换，这条路径很常走）。
 */
export function normalizeVoiceModeConfig(value: unknown): VoiceModeConfig {
  const raw = (typeof value === "object" && value !== null ? value : {}) as {
    silenceMs?: unknown;
    fastVoice?: unknown;
  };
  return {
    silenceMs:
      typeof raw.silenceMs === "number" && Number.isFinite(raw.silenceMs)
        ? Math.min(
            MAX_SILENCE_MS,
            Math.max(MIN_SILENCE_MS, Math.round(raw.silenceMs)),
          )
        : DEFAULT_VOICE_MODE.silenceMs,
    fastVoice:
      typeof raw.fastVoice === "boolean"
        ? raw.fastVoice
        : DEFAULT_VOICE_MODE.fastVoice,
  };
}

/**
 * 轮次档案名。目前只有语音一种；跨进程传值，所以要有一个共享类型。
 * 档案本体在 `src/main/agent/turn-profiles.ts`（渲染层用不到它）。
 */
export type TurnProfileName = "voice";

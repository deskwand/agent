/**
 * @module shared/voice-mode
 *
 * 语音模式唯一的设置项与它的边界值。夹到 400–2000ms：
 * 低于 400 会把人话里的停顿当成句末，高于 2000 则等得心焦。
 */
export interface VoiceModeConfig {
  silenceMs: number;
}

/**
 * 1200ms 而不是 800ms：800 会把人说话中间的正常停顿（尤其长句、边想边说）
 * 判成"说完了"，话还没说完就发出去。
 */
export const DEFAULT_VOICE_MODE: VoiceModeConfig = { silenceMs: 1200 };

export const MIN_SILENCE_MS = 400;
export const MAX_SILENCE_MS = 2000;

export function normalizeVoiceModeConfig(value: unknown): VoiceModeConfig {
  if (typeof value !== "object" || value === null)
    return { ...DEFAULT_VOICE_MODE };
  const raw = (value as { silenceMs?: unknown }).silenceMs;
  if (typeof raw !== "number" || !Number.isFinite(raw))
    return { ...DEFAULT_VOICE_MODE };
  return {
    silenceMs: Math.min(
      MAX_SILENCE_MS,
      Math.max(MIN_SILENCE_MS, Math.round(raw)),
    ),
  };
}

/**
 * 轮次档案名。目前只有语音一种；跨进程传值，所以要有一个共享类型。
 * 档案本体在 `src/main/agent/turn-profiles.ts`（渲染层用不到它）。
 */
export type TurnProfileName = "voice";

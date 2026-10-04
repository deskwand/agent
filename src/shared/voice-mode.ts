/**
 * @module shared/voice-mode
 *
 * 语音模式唯一的设置项与它的边界值。夹到 400–2000ms：
 * 低于 400 会把人话里的停顿当成句末，高于 2000 则等得心焦。
 */
export interface VoiceModeConfig {
  silenceMs: number;
}

export const DEFAULT_VOICE_MODE: VoiceModeConfig = { silenceMs: 800 };

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

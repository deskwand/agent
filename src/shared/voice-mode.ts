import type { TtsTone } from "./ipc-types";

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
  /**
   * 「最佳音质」档用哪个预置音色。九个 id 来自模型元数据（`ENGINE_VOICES`）。
   * 缺字段 = 没选过 = `ENGINE_VOICE_DEFAULT`。
   */
  voiceEngineVoice?: string;
  /**
   * 三档音色（`fast` / `balanced` / `best`）。**它是唯一事实来源**，
   * `fastVoice` 从此只是它的镜像（老读者、老配置都还认那个布尔值）。
   */
  tone?: TtsTone;
}

/**
 * 1200ms 而不是 800ms：800 会把人说话中间的正常停顿（尤其长句、边想边说）
 * 判成"说完了"，话还没说完就发出去。
 */
export const DEFAULT_VOICE_MODE: VoiceModeConfig = {
  silenceMs: 1200,
  fastVoice: true,
  tone: "fast",
};

/**
 * 从一个 voiceMode 配置读出三档音色。老配置只有 `fastVoice`（布尔）也认。
 *
 * 归一化之后 `tone` 一定在，但这个函数仍然做兜底：渲染层读到的是 store 里的
 * 实时配置，测试与半初始化的 store 都可能只有半截。
 */
export function resolveVoiceTone(value: unknown): TtsTone {
  const raw = (typeof value === "object" && value !== null ? value : {}) as {
    tone?: unknown;
    fastVoice?: unknown;
  };
  if (raw.tone === "fast" || raw.tone === "balanced" || raw.tone === "best") {
    return raw.tone;
  }
  if (typeof raw.fastVoice === "boolean") {
    return raw.fastVoice ? "fast" : "balanced";
  }
  return DEFAULT_VOICE_MODE.tone ?? "fast";
}

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
    voiceEngineVoice?: unknown;
    tone?: unknown;
  };
  // tone 是事实来源；没有它才看老布尔值。两个都脏就用默认。
  const tone: TtsTone =
    raw.tone === "fast" || raw.tone === "balanced" || raw.tone === "best"
      ? raw.tone
      : typeof raw.fastVoice === "boolean"
        ? raw.fastVoice
          ? "fast"
          : "balanced"
        : (DEFAULT_VOICE_MODE.tone ?? "fast");
  return {
    silenceMs:
      typeof raw.silenceMs === "number" && Number.isFinite(raw.silenceMs)
        ? Math.min(
            MAX_SILENCE_MS,
            Math.max(MIN_SILENCE_MS, Math.round(raw.silenceMs)),
          )
        : DEFAULT_VOICE_MODE.silenceMs,
    fastVoice: tone === "fast",
    // 空串 / 非字符串都当"没选过"：一个空音色 id 会让合成请求 400
    ...(typeof raw.voiceEngineVoice === "string" && raw.voiceEngineVoice
      ? { voiceEngineVoice: raw.voiceEngineVoice }
      : {}),
    tone,
  };
}

/**
 * 轮次档案名。目前只有语音一种；跨进程传值，所以要有一个共享类型。
 * 档案本体在 `src/main/agent/turn-profiles.ts`（渲染层用不到它）。
 */
export type TurnProfileName = "voice";

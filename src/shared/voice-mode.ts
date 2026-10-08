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
  /** 语速。缺省 = 1.0，也就是"不干预"。所有档位都吃它，界面上可改。 */
  voiceSpeed?: number;
  /**
   * 风格 / 情绪的自然语言指令（引擎侧叫 `instructions`）。**只对最佳音质档生效** ——
   * 快速与均衡是 sherpa，没有这条通路。它由语音会话里的模型写入（工具 `set_voice`）。
   */
  voiceStyle?: string;
  /** 来源：本机 / 云端。缺字段 = 本机（老配置零迁移）。 */
  source?: TtsSource;
  /** 云端来源下的端点、音色、凭据与档位映射。 */
  cloud?: CloudVoiceConfig;
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
    voiceSpeed?: unknown;
    voiceStyle?: unknown;
    source?: unknown;
    cloud?: unknown;
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
    // 语速：有限数字才收，且夹进区间 —— 上下界只在这一处定义，工具那边也用它
    ...(typeof raw.voiceSpeed === "number" && Number.isFinite(raw.voiceSpeed)
      ? { voiceSpeed: clampSpeechSpeed(raw.voiceSpeed) }
      : {}),
    // 风格：空串 / 非字符串都当"没设过"，与 voiceEngineVoice 同一条理由
    ...(typeof raw.voiceStyle === "string" && raw.voiceStyle.trim()
      ? { voiceStyle: raw.voiceStyle }
      : {}),
    // 来源：只认 "cloud"（其余都当本机），老配置因此零迁移
    ...(raw.source === "cloud" ? { source: "cloud" as const } : {}),
    ...(() => {
      const cloud = normalizeCloud((raw as { cloud?: unknown }).cloud);
      return cloud ? { cloud } : {};
    })(),
  };
}

/**
 * 轮次档案名。目前只有语音一种；跨进程传值，所以要有一个共享类型。
 * 档案本体在 `src/main/agent/turn-profiles.ts`（渲染层用不到它）。
 */
export type TurnProfileName = "voice";

/** 语速区间。引擎对 `speed` 没有任何校验或上下界（查过源码），这里是我们的产品选择。 */
export const MIN_SPEECH_SPEED = 0.5;
export const MAX_SPEECH_SPEED = 2;

/** 把语速夹进区间。归一化与语音工具都走它，避免两处各写一份边界。 */
export function clampSpeechSpeed(value: number): number {
  return Math.min(MAX_SPEECH_SPEED, Math.max(MIN_SPEECH_SPEED, value));
}

/** 来源：本机三档 / 云端。缺字段 = 本机（老配置零迁移）。 */
export type TtsSource = "local" | "cloud";

export interface CloudVoiceConfig {
  /** 端点或厂商 id（`openai-compatible` / `doubao` / ...）。未知 id 在解析层报 unconfigured。 */
  provider?: string;
  /** 自定义 BaseURL（通用端点与豆包的可选覆盖）。 */
  baseUrl?: string;
  /** 该端点下选中的音色 id。 */
  voiceId?: string;
  /** 三档 → 模型；只有 provider 自己没声明档位时才需要（通用端点）。 */
  models?: Partial<Record<TtsTone, string>>;
  /** providerId → { 字段名 → 值 }。与现有供应商 Key 同规格，明文存 config store。 */
  credentials?: Record<string, Record<string, string>>;
}

export function resolveTtsSource(value: unknown): TtsSource {
  const raw = (typeof value === "object" && value !== null ? value : {}) as {
    source?: unknown;
  };
  return raw.source === "cloud" ? "cloud" : "local";
}

/** 三档键的白名单：脏键写了也没人读，只会让下次归一化再跑一遍。 */
const TIER_KEYS: readonly TtsTone[] = ["fast", "balanced", "best"];

function normalizeCloud(value: unknown): CloudVoiceConfig | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const str = (v: unknown) =>
    typeof v === "string" && v.trim() ? v : undefined;
  const models: Partial<Record<TtsTone, string>> = {};
  if (typeof raw.models === "object" && raw.models !== null) {
    for (const key of TIER_KEYS) {
      const v = (raw.models as Record<string, unknown>)[key];
      if (typeof v === "string" && v.trim()) models[key] = v;
    }
  }
  const credentials: Record<string, Record<string, string>> = {};
  if (typeof raw.credentials === "object" && raw.credentials !== null) {
    for (const [provider, fields] of Object.entries(
      raw.credentials as Record<string, unknown>,
    )) {
      if (typeof fields !== "object" || fields === null) continue;
      const clean: Record<string, string> = {};
      for (const [k, v] of Object.entries(fields as Record<string, unknown>)) {
        if (typeof v === "string" && v) clean[k] = v;
      }
      if (Object.keys(clean).length) credentials[provider] = clean;
    }
  }
  const out: CloudVoiceConfig = {};
  const provider = str(raw.provider);
  if (provider) out.provider = provider;
  const baseUrl = str(raw.baseUrl);
  if (baseUrl) out.baseUrl = baseUrl;
  const voiceId = str(raw.voiceId);
  if (voiceId) out.voiceId = voiceId;
  if (Object.keys(models).length) out.models = models;
  if (Object.keys(credentials).length) out.credentials = credentials;
  return Object.keys(out).length ? out : undefined;
}

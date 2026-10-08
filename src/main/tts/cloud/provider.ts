/**
 * @module main/tts/cloud/provider
 *
 * 云端合成的最小契约。**不许 import 应用内任何东西**（electron / config / logger /
 * shared）—— 它是将来提取成独立库的边界（设计 §3.4）。
 * `../pcm` 是中性纯函数，是唯一允许的例外（将来随库一起搬走）。
 */
export type CloudVoiceTier = "fast" | "balanced" | "best";

export type CloudErrorCode =
  | "unconfigured"
  | "auth"
  | "network"
  | "quota"
  | "failed";

export interface CredentialField {
  id: string;
  labelKey: string;
  secret?: boolean;
  required?: boolean;
}

export interface CloudCapabilities {
  sampleRate: number;
  format: "pcm_s16le";
  /**
   * 是否支持风格/情绪指令（通常只有最佳档吃它）。
   * **声明必须与实现一致** —— 声明了却不发，`set_voice` 会向用户回报“已生效”。
   */
  instructions: boolean;
  /** 是否支持语速。缺省 = 支持（OpenAI 形状有 `speed`）；不支持就得如实报。 */
  speed?: boolean;
  /** 单次请求字符上限；缺省 = 不限制。超过它由 runner 按句再切。 */
  maxCharsPerRequest?: number;
}

/** provider 看到的出口：**没有 seq**（编号是 runner 的事）。 */
export interface SpeechSink {
  chunk(samples: Float32Array, sampleRate: number): void;
  done(): void;
  error(code: CloudErrorCode, detail?: string): void;
}

/** 走到 ipc 层的出口：比 sink 多一个 seq。 */
export interface SpeechOut {
  chunk(samples: Float32Array, sampleRate: number, seq: number): void;
  done(): void;
  error(code: CloudErrorCode, detail?: string): void;
}

export interface CloudStreamRequest {
  text: string;
  voiceId: string;
  model: string;
  /** providerId → 字段名 → 值（由宿主从配置里取出后注入）。 */
  credentials: Record<string, string>;
  baseUrl?: string;
  speed?: number;
  instructions?: string;
}

export interface CloudVoice {
  id: string;
  /** 音色名的 i18n 键 —— 主进程不许出现面向用户的字面量（含中文）。 */
  labelKey: string;
}

export interface CloudTtsProvider {
  id: string;
  labelKey: string;
  capabilities: CloudCapabilities;
  credentials: CredentialField[];
  /** 策展音色表；空数组 = 该端点靠手填 voice id。 */
  curatedVoices: CloudVoice[];
  /** 该档用哪个模型；返回 null = 由配置里的 models[tone] 提供（通用端点）。 */
  tierModels(tone: CloudVoiceTier): string | null;
  /** 唯一必须实现的方法：把一段文本变成 PCM 块。abort 由 `signal` 表达。 */
  stream(
    req: CloudStreamRequest,
    sink: SpeechSink,
    signal: AbortSignal,
  ): Promise<void>;
}

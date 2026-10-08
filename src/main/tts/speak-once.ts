/**
 * @module main/tts/speak-once
 *
 * 云端**整句**合成：收集 chunk 成一段 Float32。给两个非流式调用方共用 ——
 * ipc 的 `tts.speak`（含 agent 工具那条路）与设置页试听。不为它们各写一遍。
 *
 * 它不认识 Electron、也不读 config：配置与 provider 都由调用方注入（可提取纪律）。
 */
import type { TtsErrorCode, TtsSpeakResult } from "../../shared/ipc-types";
import type {
  CloudVoiceConfig,
  VoiceModeConfig,
} from "../../shared/voice-mode";
import {
  defaultVoiceId,
  getCloudProvider,
  runCloudStream,
  type CloudTtsProvider,
  type CloudVoiceTier,
  type SpeechOut,
} from "./cloud";

export interface SpeakOnceDeps {
  getVoiceMode: () => VoiceModeConfig | undefined;
  /** 默认 getCloudProvider（真实注册表）；测试注入假 provider。 */
  providerFor?: (id: string) => CloudTtsProvider | null;
}

export async function speakCloudOnce(
  deps: SpeakOnceDeps,
  text: string,
  tone: CloudVoiceTier,
  opts?: { speed?: number; instructions?: string },
): Promise<TtsSpeakResult> {
  const cloud: CloudVoiceConfig | undefined = deps.getVoiceMode()?.cloud;
  const providerId = cloud?.provider;
  const provider = providerId
    ? (deps.providerFor ?? getCloudProvider)(providerId)
    : null;
  if (!cloud || !provider) {
    return { ok: false, error: "cloud not configured", code: "unconfigured" };
  }
  // 音色：配置里的优先，否则用端点的第一个策展音色（默认值在消费方解析）
  const voiceId = cloud.voiceId || defaultVoiceId(provider);
  if (!voiceId) {
    return {
      ok: false,
      error: "no voice selected",
      code: "unconfigured",
    };
  }
  const model = cloud.models?.[tone] ?? provider.tierModels(tone);
  if (!model) {
    return {
      ok: false,
      error: `no model for tier ${tone}`,
      code: "unconfigured",
    };
  }

  const chunks: Float32Array[] = [];
  let sampleRate = provider.capabilities.sampleRate;
  let failure: { code: TtsErrorCode; detail?: string } | null = null;
  const out: SpeechOut = {
    chunk: (samples, rate) => {
      chunks.push(samples);
      sampleRate = rate;
    },
    done: () => {},
    error: (code, detail) => {
      failure = { code: code as TtsErrorCode, detail };
    },
  };
  await runCloudStream(
    provider,
    {
      text,
      voiceId,
      model,
      credentials: cloud.credentials?.[provider.id] ?? {},
      baseUrl: cloud.baseUrl,
      speed: opts?.speed,
      instructions: opts?.instructions,
    },
    out,
    new AbortController().signal,
  );
  if (failure) {
    const { code, detail } = failure as { code: TtsErrorCode; detail?: string };
    return { ok: false, error: detail ? `${code}: ${detail}` : code, code };
  }
  if (chunks.length === 0) {
    return { ok: false, error: "cloud returned no audio", code: "failed" };
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const samples = new Float32Array(total);
  let at = 0;
  for (const c of chunks) {
    samples.set(c, at);
    at += c.length;
  }
  return { ok: true, samples, sampleRate };
}

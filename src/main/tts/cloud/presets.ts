/**
 * @module main/tts/cloud/presets
 *
 * 端点预设。**只是 (label, baseUrl) 数据** —— 加一家不改代码路径。
 *
 * `streaming` / `verified` 来自探针实测（`scripts/probe-tts-endpoints.mjs`，设计 §4.2）：
 * 未实测的一律 `verified: false`，UI 会标注；拿不到 PCM 的端点**不许进这张表**。
 *
 * ⚠️ 这张表在有人跑过探针之前为空是**正确**的 —— 预设不是承诺。
 */
export interface CloudPreset {
  id: string;
  labelKey: string;
  baseUrl: string;
  streaming: boolean;
  verified: boolean;
}

export const CLOUD_PRESETS: CloudPreset[] = [
  {
    id: "openai",
    labelKey: "settings.capabilities.voiceMode.cloud.presetOpenai",
    baseUrl: "https://api.openai.com/v1",
    streaming: true,
    verified: true, // 唯一在文档层面确认支持 /audio/speech + pcm 的端点
  },
];

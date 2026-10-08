/**
 * @module renderer/components/settings/cloud-voice-catalog
 *
 * 云端语音在**渲染层**的两份清单：可选的 provider 与预设端点。
 *
 * 它们与主进程是**两份事实**：渲染进程不许 import 主进程模块（跨进程只走 IPC）。
 * 漂移的症状是「界面说支持流式、实际不支持」这类**界面说假话**，所以
 * `src/tests/tts/cloud-presets.test.ts` 把两边钉在一起。
 *
 * 单独成文件（而不是放在 .tsx 里）是为了让那条测试能在 node 环境直接 import：
 * 拖进一个 React 组件会把 jsdom 与 i18n 初始化一起拖进来。
 */
export const PROVIDER_IDS_FOR_UI = ["openai-compatible", "doubao"] as const;

/**
 * 每个 provider 的**能力声明**（必须与主进程适配器一致，`cloud-presets.test.ts` 钉住）。
 * `speed: false` 的端点不显示语速行 —— 显示一个改不动的控件比不显示更糟。
 */
export const PROVIDER_CAPS_FOR_UI = {
  "openai-compatible": { speed: true, instructions: false },
  doubao: { speed: false, instructions: false },
} as const satisfies Record<
  (typeof PROVIDER_IDS_FOR_UI)[number],
  { speed: boolean; instructions: boolean }
>;

export const PRESETS_FOR_UI = [
  {
    id: "openai",
    labelKey: "cloud.presetOpenai",
    baseUrl: "https://api.openai.com/v1",
    verified: true,
  },
] as const;

/**
 * 策展音色。**只放真机验证过的 id**（2026-10-08 用 `seed-tts-2.0` 逐条打过）：
 * 豆包会校验音色与资源的代际，1.0 代音色（`_mars_` / `_moon_` 等）配 2.0 资源会回
 * `55000000 resource ID is mismatched with speaker related resource`。
 * 音色名的文案走 labelKey（主进程不许出现面向用户的字面量）。
 */
export const CURATED_VOICES_FOR_UI: Record<
  (typeof PROVIDER_IDS_FOR_UI)[number],
  ReadonlyArray<{ id: string; labelKey: string }>
> = {
  "openai-compatible": [],
  doubao: [
    { id: "zh_female_vv_uranus_bigtts", labelKey: "cloud.voiceVivi" },
    {
      id: "zh_female_tianmeitaozi_uranus_bigtts",
      labelKey: "cloud.voiceTaozi",
    },
    { id: "zh_male_ruyayichen_uranus_bigtts", labelKey: "cloud.voiceYichen" },
  ],
};

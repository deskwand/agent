/**
 * 渲染层的两份清单与主进程**不许漂移**：drift 的症状是界面说假话
 * （“支持流式”/“有这个端点”而实现里没有）。
 *
 * node 环境即可跑 —— 它 import 的是无 React 依赖的 catalog 模块。
 */
import { describe, expect, it } from "vitest";
import { cloudProviderIds, getCloudProvider } from "../../main/tts/cloud";
import { CLOUD_PRESETS } from "../../main/tts/cloud/presets";
import {
  CURATED_VOICES_FOR_UI,
  PRESETS_FOR_UI,
  PROVIDER_IDS_FOR_UI,
} from "../../renderer/components/settings/cloud-voice-catalog";

describe("云端 provider / 预设的一致性", () => {
  it("渲染层的 provider 列表与主进程注册表相等", () => {
    expect([...PROVIDER_IDS_FOR_UI].sort()).toEqual(
      [...cloudProviderIds()].sort(),
    );
  });

  it("预设：id 与 baseUrl 两边一致，且都是 https", () => {
    expect(PRESETS_FOR_UI.map((p) => p.id)).toEqual(
      CLOUD_PRESETS.map((p) => p.id),
    );
    expect(PRESETS_FOR_UI.map((p) => p.baseUrl)).toEqual(
      CLOUD_PRESETS.map((p) => p.baseUrl),
    );
    for (const preset of CLOUD_PRESETS) {
      expect(preset.baseUrl).toMatch(/^https:\/\//);
      expect(typeof preset.verified).toBe("boolean");
    }
  });

  it("策展音色 id 两边一致（音色表曾在两处各存一份，漂移过）", () => {
    for (const id of cloudProviderIds()) {
      const provider = getCloudProvider(id)!;
      const uiVoices =
        CURATED_VOICES_FOR_UI[id as keyof typeof CURATED_VOICES_FOR_UI] ?? [];
      expect(uiVoices.map((v: { id: string }) => v.id)).toEqual(
        provider.curatedVoices.map((v) => v.id),
      );
    }
  });

  it("未实测的预设必须显式标 verified: false（不靠默认值）", () => {
    for (const preset of CLOUD_PRESETS) {
      expect(Object.prototype.hasOwnProperty.call(preset, "verified")).toBe(
        true,
      );
    }
  });
});

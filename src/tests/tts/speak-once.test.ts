import { describe, expect, it, vi } from "vitest";
import { speakCloudOnce } from "../../main/tts/speak-once";
import type { CloudTtsProvider } from "../../main/tts/cloud/provider";
import type { VoiceModeConfig } from "../../shared/voice-mode";

function fakeProvider(over: Partial<CloudTtsProvider> = {}): CloudTtsProvider {
  return {
    id: "openai-compatible",
    labelKey: "x",
    capabilities: {
      sampleRate: 24000,
      format: "pcm_s16le",
      instructions: false,
    },
    credentials: [],
    curatedVoices: [],
    tierModels: () => "tts-1",
    async stream(_req, sink) {
      sink.chunk(new Float32Array([0.5, 0.5]), 24000);
      sink.done();
    },
    ...over,
  };
}

const voiceMode: VoiceModeConfig = {
  silenceMs: 1200,
  fastVoice: true,
  source: "cloud",
  cloud: {
    provider: "openai-compatible",
    baseUrl: "https://example.com/v1",
    voiceId: "alloy",
    models: { balanced: "tts-1" },
    credentials: { "openai-compatible": { apiKey: "sk-1" } },
  },
};

describe("speakCloudOnce", () => {
  it("收集 chunk 成整段 Float32 并带上采样率", async () => {
    const result = await speakCloudOnce(
      { getVoiceMode: () => voiceMode, providerFor: () => fakeProvider() },
      "你好",
      "balanced",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.samples.length).toBe(2);
      expect(result.sampleRate).toBe(24000);
    }
  });

  it("把 provider 声明的档位映射带上（通用端点由配置给模型）", async () => {
    const stream = vi.fn(
      async (_req, sink: Parameters<CloudTtsProvider["stream"]>[1]) => {
        sink.chunk(new Float32Array(1), 24000);
        sink.done();
      },
    );
    await speakCloudOnce(
      {
        getVoiceMode: () => voiceMode,
        providerFor: () => fakeProvider({ stream }),
      },
      "你好",
      "balanced",
    );
    expect(stream.mock.calls[0][0].model).toBe("tts-1");
    expect(stream.mock.calls[0][0].credentials.apiKey).toBe("sk-1");
  });

  it("失败时把 code 带出来（UI 要靠它映射文案）", async () => {
    const failing = fakeProvider({
      async stream(_req, sink) {
        sink.error("quota", "balance not enough");
      },
    });
    const result = await speakCloudOnce(
      { getVoiceMode: () => voiceMode, providerFor: () => failing },
      "你好",
      "balanced",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("quota");
      expect(result.error).toContain("quota");
    }
  });

  it("未配置 → unconfigured", async () => {
    const result = await speakCloudOnce(
      {
        getVoiceMode: () => ({
          silenceMs: 1200,
          fastVoice: true,
          source: "cloud",
          cloud: {},
        }),
        providerFor: () => null,
      },
      "你好",
      "balanced",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unconfigured");
  });

  it("provider 一声不吭 → failed（不能让调用方拿到空音频当成功）", async () => {
    const silent = fakeProvider({ tierModels: () => null });
    const result = await speakCloudOnce(
      {
        getVoiceMode: () => ({
          ...voiceMode,
          cloud: { ...voiceMode.cloud, models: undefined },
        }),
        providerFor: () => silent,
      },
      "你好",
      "balanced",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unconfigured");
  });
});

/**
 * 音色默认值：**消费方解析**，不是要求配置里必须显式写过。
 * 仓库既有模式见 `ipc.ts` 的 `engineVoice()`（`?? ENGINE_VOICE_DEFAULT`）。
 * 缺了它，界面会显示一个默认音色、而合成报「未配置凭据」——一句不实的话。
 */
describe("speakCloudOnce 的音色默认值", () => {
  const curated = [{ id: "zh_female_vv_uranus_bigtts", labelKey: "k" }];
  const withoutVoiceId: VoiceModeConfig = {
    ...voiceMode,
    cloud: { ...voiceMode.cloud, voiceId: undefined },
  };

  it("配置没写音色 + provider 有策展音色 → 用第一个", async () => {
    const stream = vi.fn(
      async (
        _req: Parameters<CloudTtsProvider["stream"]>[0],
        sink: Parameters<CloudTtsProvider["stream"]>[1],
      ) => {
        sink.chunk(new Float32Array(1), 24000);
        sink.done();
      },
    );
    const result = await speakCloudOnce(
      {
        getVoiceMode: () => withoutVoiceId,
        providerFor: () => fakeProvider({ curatedVoices: curated, stream }),
      },
      "你好",
      "balanced",
    );
    expect(result.ok).toBe(true);
    expect(stream.mock.calls[0][0].voiceId).toBe("zh_female_vv_uranus_bigtts");
  });

  it("既没写音色、provider 也没有策展表 → unconfigured，且说明缺的是音色", async () => {
    const result = await speakCloudOnce(
      {
        getVoiceMode: () => withoutVoiceId,
        providerFor: () => fakeProvider({ curatedVoices: [] }),
      },
      "你好",
      "balanced",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("unconfigured");
      expect(result.error).toContain("voice");
    }
  });
});

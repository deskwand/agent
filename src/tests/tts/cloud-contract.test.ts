/**
 * **所有 provider 共用**的契约测试（设计 §7 明确要求一套共用，而不是每家各写各的）。
 *
 * 它只钉「任何适配器都必须成立」的几件事：声明自洽、缺凭据不联网、空文本不联网、
 * 取消后闭嘴。协议细节（帧格式、鉴权头）归各 provider 自己的测试。
 */
import { describe, expect, it } from "vitest";
import {
  cloudProviderIds,
  getCloudProvider,
  runCloudStream,
  type CloudVoiceTier,
  type SpeechOut,
} from "../../main/tts/cloud";

const TIERS: readonly CloudVoiceTier[] = ["fast", "balanced", "best"];

function collector() {
  const events: string[] = [];
  const out: SpeechOut = {
    chunk: (_samples, _rate, seq) => events.push(`chunk:${seq}`),
    done: () => events.push("done"),
    error: (code) => events.push(`error:${code}`),
  };
  return { out, events };
}

const req = (credentials: Record<string, string>) => ({
  text: "自检句",
  voiceId: "any",
  model: "any",
  credentials,
  // 指向一个**不存在的本地端口**：任何真实网络调用都会立刻失败 ——
  // 反过来证明了「缺凭据/空文本」这两条根本没发请求。
  baseUrl: "http://127.0.0.1:1",
});

describe("云端 provider 共用契约", () => {
  for (const id of cloudProviderIds()) {
    describe(id, () => {
      it("声明自洽：id 对得上、labelKey 走 i18n 前缀、只收 pcm_s16le", () => {
        const provider = getCloudProvider(id);
        expect(provider).not.toBeNull();
        expect(provider!.id).toBe(id);
        expect(provider!.labelKey).toMatch(/^settings\./);
        expect(provider!.capabilities.format).toBe("pcm_s16le");
        expect(provider!.capabilities.sampleRate).toBeGreaterThan(0);
        expect(provider!.credentials.length).toBeGreaterThan(0);
        for (const field of provider!.credentials) {
          expect(field.labelKey).toMatch(/^settings\./);
        }
        for (const voice of provider!.curatedVoices) {
          // 主进程不许出现面向用户的字面量（含中文），音色名走 labelKey
          expect(voice.labelKey).toMatch(/^settings\./);
        }
        // 三档都要有结论：要么声明模型，要么明确 null（由配置提供）
        for (const tone of TIERS) {
          const model = provider!.tierModels(tone);
          expect(model === null || typeof model === "string").toBe(true);
        }
      });

      it("缺凭据 → unconfigured，且一个块都不发（不联网）", async () => {
        const { out, events } = collector();
        await runCloudStream(
          getCloudProvider(id)!,
          req({}),
          out,
          new AbortController().signal,
        );
        expect(events).toEqual(["error:unconfigured"]);
      });

      it("空文本 → failed，同样不发请求", async () => {
        const { out, events } = collector();
        await runCloudStream(
          getCloudProvider(id)!,
          { ...req({ apiKey: "sk-x" }), text: "   " },
          out,
          new AbortController().signal,
        );
        expect(events).toEqual(["error:failed"]);
      });

      it("一上来就是 aborted 的 signal → 不发任何事件", async () => {
        const { out, events } = collector();
        const controller = new AbortController();
        controller.abort();
        await runCloudStream(
          getCloudProvider(id)!,
          req({ apiKey: "sk-x" }),
          out,
          controller.signal,
        );
        expect(events).toEqual([]);
      });
    });
  }
});

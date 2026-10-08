/**
 * @module main/tts/cloud/providers/openai-compatible
 *
 * OpenAI 形状的 `/audio/speech`：一个适配器覆盖 OpenAI 自己，以及大量声明兼容的
 * 聚合端点 / 中转 / 本地开源服务（Kokoro-FastAPI 之类）。
 *
 * 两条纪律：
 *  - **白名单**校验 content-type：端点忽略 `response_format` 回 mp3、或 200 回一段
 *    HTML 错误页时，必须报错，不能把那些字节当 s16le 播成噪声；
 *  - 连接**建立不起来**是 `network`，连接**建立后中断**是 `failed`（整次失败，
 *    见设计 §6：「短读或异常关闭 = 整次失败」）。
 */
import { createPcmState, pushPcmBytes } from "../../pcm";
import type {
  CloudCapabilities,
  CloudErrorCode,
  CloudStreamRequest,
  CloudTtsProvider,
  SpeechSink,
} from "../provider";

const CAPS: CloudCapabilities = {
  sampleRate: 24000,
  format: "pcm_s16le",
  instructions: false,
  speed: true, // OpenAI 形状的 `speed`；第三方兼容端点忽略它也无害
};

/** 一次 fetch 的上限：没有它，挂死的请求会把 per-provider 队列的头永远占住。 */
const FETCH_TIMEOUT_MS = 30_000;

/** 只有这些 content-type 才可能是 s16le PCM；其余（含 text/html、application/json）一律拒绝。 */
const PCM_CONTENT_TYPES = [
  "audio/pcm",
  "audio/l16",
  "application/octet-stream",
];

function isPcmContentType(contentType: string): boolean {
  const ct = contentType.toLowerCase().split(";")[0].trim();
  return ct === "" || PCM_CONTENT_TYPES.includes(ct);
}

function mapStatus(status: number): CloudErrorCode {
  if (status === 401 || status === 403) return "auth";
  if (status === 402 || status === 429) return "quota";
  if (status >= 500) return "network";
  return "failed";
}

export const openaiCompatible: CloudTtsProvider = {
  id: "openai-compatible",
  labelKey: "settings.capabilities.voiceMode.cloud.providerOpenaiCompatible",
  capabilities: CAPS,
  credentials: [
    {
      id: "apiKey",
      labelKey: "settings.capabilities.voiceMode.cloud.apiKey",
      secret: true,
      required: true,
    },
  ],
  curatedVoices: [],
  tierModels: () => null,
  async stream(req: CloudStreamRequest, sink: SpeechSink, signal: AbortSignal) {
    const base = (req.baseUrl ?? "").replace(/\/+$/, "");
    const key = req.credentials.apiKey;
    if (!base) return sink.error("unconfigured", "baseUrl");
    if (!key) return sink.error("unconfigured", "apiKey");

    let res: Response;
    try {
      res = await fetch(`${base}/audio/speech`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: req.model,
          input: req.text,
          voice: req.voiceId,
          response_format: "pcm",
          ...(req.speed !== undefined ? { speed: req.speed } : {}),
        }),
        signal: AbortSignal.any([
          signal,
          AbortSignal.timeout(FETCH_TIMEOUT_MS),
        ]),
      });
    } catch (error) {
      // 连接根本没建立起来（含 abort 与超时）：network
      if (signal.aborted) return;
      return sink.error(
        "network",
        error instanceof Error ? error.message : String(error),
      );
    }
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      return sink.error(mapStatus(res.status), detail.slice(0, 300));
    }
    if (!isPcmContentType(res.headers.get("content-type") ?? "")) {
      return sink.error(
        "failed",
        `endpoint returned ${res.headers.get("content-type")}, expected pcm`,
      );
    }

    const state = createPcmState();
    try {
      for await (const bytes of res.body as unknown as AsyncIterable<Uint8Array>) {
        if (signal.aborted) return;
        const samples = pushPcmBytes(state, bytes);
        if (samples) sink.chunk(samples, CAPS.sampleRate);
      }
    } catch (error) {
      // 连接已建立后中断（短读）= 整次失败，不是「网络不可达」
      if (signal.aborted) return;
      return sink.error(
        "failed",
        error instanceof Error ? error.message : String(error),
      );
    }
    sink.done();
  },
};

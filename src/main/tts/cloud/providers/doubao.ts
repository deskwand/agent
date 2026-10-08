/**
 * @module main/tts/cloud/providers/doubao
 *
 * 豆包语音（火山引擎「语音技术」）单向流式 **HTTP Chunked V3** 直连。
 *
 * 协议事实（2026-10 官方文档核实，见设计 §4.3）：
 *  - `POST https://openspeech.bytedance.com/api/v3/tts/unidirectional`
 *  - 鉴权：`X-Api-Key` + `X-Api-Resource-Id`（`seed-tts-2.0`）；**与火山方舟 Key 不通用**
 *  - 请求体：`{ user, req_params: { text, speaker, audio_params: { format, sample_rate } } }`
 *  - 响应：**JSON 对象流**（不是裸 PCM），音频在 `data` 字段里是 base64
 *  - 结束帧：`{ code: 20000000, message: "ok", data: null }`
 *
 * 两处刻意没做（设计 §4.3 的待实测项）：语速字段名未在文档中确认，所以**不发**；
 * 位深/声道未写明，按 s16le 单声道处理。
 */
import { StringDecoder } from "node:string_decoder";
import { createPcmState, pushPcmBytes } from "../../pcm";
import type {
  CloudCapabilities,
  CloudStreamRequest,
  CloudTtsProvider,
  SpeechSink,
} from "../provider";

const CAPS: CloudCapabilities = {
  sampleRate: 24000,
  format: "pcm_s16le",
  // 两件都**如实标不支持**：`stream()` 里目前没有发风格指令，也没发语速
  // （文档里那两个字段名未核实，属设计 §4.3 的待实测项）。
  // 声明 true 而实现不发，`set_voice` 就会向用户回报“已生效”—— 那是撒谎。
  instructions: false,
  speed: false,
};

const DEFAULT_BASE = "https://openspeech.bytedance.com";
const RESOURCE_ID = "seed-tts-2.0";
/** 官方文档里的成功结束码（不是 0）。 */
const DONE_CODE = 20000000;
/**
 * 音色与资源代际不匹配。实测：1.0 代音色（`_mars_`/`_moon_`）+ `seed-tts-2.0`
 * 就是这一颗 —— 后端把它当成"成功帧里的错误"，所以 HTTP 是 200。
 */
const CODE_RESOURCE_VOICE_MISMATCH = 55000000;
/** 一次 fetch 的上限：没有它，挂死的请求会把 per-provider 队列的头永远占住。 */
const FETCH_TIMEOUT_MS = 30_000;

/**
 * 从流式 JSON 里切出完整对象：多个对象连在一条流里，且**可能把一个对象切在两个
 * chunk 中间**。按括号配平 + 字符串/转义感知切，剩下的残片留给下一次。
 */
export function splitJsonFrames(buffer: string): {
  frames: string[];
  rest: string;
} {
  const frames: string[] = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let start = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    const ch = buffer[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      if (depth <= 0) {
        if (start >= 0) frames.push(buffer.slice(start, i + 1));
        depth = 0;
        start = -1;
      }
    }
  }
  return { frames, rest: start >= 0 ? buffer.slice(start) : "" };
}

/**
 * 策展音色：**只放与 `X-Api-Resource-Id: seed-tts-2.0` 同代的 id**（`_uranus_` 家族），
 * 且每条都在 2026-10-08 用真机打过一次。
 *
 * 踩过的坑（别再放回去）：1.0 代音色（`_mars_` / `_moon_` 后缀）配 2.0 资源，
 * 后端回 `55000000 resource ID is mismatched with speaker related resource`
 * —— HTTP 仍是 200，错误藏在 JSON 流里。
 *
 * 官方称上百种音色；列表 API 走另一套 OpenAPI 签名，v1 不做，故只策展几个。
 */
const VOICES = [
  {
    id: "zh_female_vv_uranus_bigtts",
    labelKey: "settings.capabilities.voiceMode.cloud.voiceVivi",
  },
  {
    id: "zh_female_tianmeitaozi_uranus_bigtts",
    labelKey: "settings.capabilities.voiceMode.cloud.voiceTaozi",
  },
  {
    id: "zh_male_ruyayichen_uranus_bigtts",
    labelKey: "settings.capabilities.voiceMode.cloud.voiceYichen",
  },
];

export const doubao: CloudTtsProvider = {
  id: "doubao",
  labelKey: "settings.capabilities.voiceMode.cloud.providerDoubao",
  capabilities: CAPS,
  credentials: [
    {
      id: "apiKey",
      labelKey: "settings.capabilities.voiceMode.cloud.doubaoKey",
      secret: true,
      required: true,
    },
  ],
  curatedVoices: VOICES,
  tierModels: (tone) =>
    tone === "best" ? "seed-tts-2.0-expressive" : "seed-tts-2.0-standard",
  async stream(req: CloudStreamRequest, sink: SpeechSink, signal: AbortSignal) {
    const key = req.credentials.apiKey;
    if (!key) return sink.error("unconfigured", "apiKey");
    const base = (req.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");

    let res: Response;
    try {
      res = await fetch(`${base}/api/v3/tts/unidirectional`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Api-Key": key,
          "X-Api-Resource-Id": RESOURCE_ID,
          "X-Api-Request-Id": crypto.randomUUID(),
        },
        body: JSON.stringify({
          user: { uid: "deskwand" },
          req_params: {
            text: req.text,
            speaker: req.voiceId,
            audio_params: { format: "pcm", sample_rate: CAPS.sampleRate },
          },
        }),
        signal: AbortSignal.any([
          signal,
          AbortSignal.timeout(FETCH_TIMEOUT_MS),
        ]),
      });
    } catch (error) {
      if (signal.aborted) return;
      return sink.error(
        "network",
        error instanceof Error ? error.message : String(error),
      );
    }
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      if (res.status === 401 || res.status === 403) {
        return sink.error("auth", detail.slice(0, 300));
      }
      if (res.status === 429 || res.status === 402) {
        return sink.error("quota", detail.slice(0, 300));
      }
      return sink.error(
        res.status >= 500 ? "network" : "failed",
        detail.slice(0, 300),
      );
    }

    const decoder = new StringDecoder("utf8");
    const pcmState = createPcmState();
    let pending = "";
    /** 到底有没有吐过音频 —— 决定“静默成功”能不能被拦下来。 */
    let emitted = false;
    try {
      for await (const bytes of res.body as unknown as AsyncIterable<Uint8Array>) {
        if (signal.aborted) return;
        pending += decoder.write(Buffer.from(bytes));
        const { frames, rest } = splitJsonFrames(pending);
        pending = rest;
        for (const frame of frames) {
          let parsed: { code?: number; message?: string; data?: string | null };
          try {
            parsed = JSON.parse(frame) as typeof parsed;
          } catch {
            continue; // 半个对象已经由 rest 兜住，这里能失败的是垃圾字节
          }
          if (typeof parsed.data === "string" && parsed.data) {
            const pcm = pushPcmBytes(
              pcmState,
              Buffer.from(parsed.data, "base64"),
            );
            if (pcm) {
              emitted = true;
              sink.chunk(pcm, CAPS.sampleRate);
            }
          }
          if (
            typeof parsed.code === "number" &&
            parsed.code !== 0 &&
            parsed.code !== DONE_CODE
          ) {
            const hint =
              parsed.code === CODE_RESOURCE_VOICE_MISMATCH
                ? ` (this endpoint uses resource ${RESOURCE_ID}; use a matching voice, e.g. one ending in _uranus_bigtts)`
                : "";
            return sink.error(
              "failed",
              `doubao ${parsed.code}: ${parsed.message ?? ""}${hint}`,
            );
          }
        }
      }
    } catch (error) {
      // 连接建立后中断 = 整次失败（短读契约，设计 §6）
      if (signal.aborted) return;
      return sink.error(
        "failed",
        error instanceof Error ? error.message : String(error),
      );
    }
    // 一帧音频都没有（例如 200 回了一段 HTML 错误页）：不能当成功上报，
    // 否则用户看到的是“合成成功、但没有声音”。
    if (!emitted && !signal.aborted) {
      return sink.error("failed", "doubao returned no audio frames");
    }
    sink.done();
  },
};

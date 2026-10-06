/**
 * @module main/engine/engine-bridge
 *
 * 引擎的 HTTP 流 → PCM → **攒够再播** → 现有 `tts.stream` 事件。
 *
 * 为什么需要"攒够再播"：引擎是逐块吐的（80/160/320/640ms 递增），但每块都要花
 * 时间才能生成。若收到第一块就播，播完它时下一块还没到 —— 中间就是一段静音。
 * 实测（M3 Air，Q4_K_M）短句中句第 875ms、长句 2387ms 处才转正（生成 ≥ 已等待）。
 * 所以门限是**已攒下的音频 ≥ 已等待的时间**，达到之前一块都不发给播放器。
 *
 * 代价是首声晚一点点（余量 0 时约 0.9–2.4s），换来的是**一次都不停**。
 * 拼接后的音频与整句合成逐字节相同（引擎按标点分段，块边界就在段落处）。
 *
 * 取消：`signal` abort 直接断开 HTTP 连接，上游会中止合成（实测服务端日志出现
 * `aborted the synthesis`）—— 引擎是串行的，白烧的 GPU 时间会让下一句排队等着。
 */
import type { TtsStreamEvent } from "../../shared/ipc-types";
import {
  getEngineSupervisor,
  type EngineSupervisor,
} from "./engine-supervisor";

export interface EngineStreamOptions {
  text: string;
  voiceId: string;
  streamId: number;
  /**
   * 事件出口。**成功时本函数会自己发 `done`** —— 调用方只负责在
   * `ok === false` 时补一条 `error`，否则会出现两个 `done`。
   */
  send(event: TtsStreamEvent): void;
  signal?: AbortSignal;
}

/**
 * 攒够再播的门限（毫秒）。判据是**已攒下的音频 ≥ 已等待的时间**。
 *
 * 调大 = 更晚开播、更保守；调成负数会让开播更早，风险自负（会断续）。
 */
const STREAM_START_MARGIN_MS = 0;
const SAMPLE_RATE = 24_000;

export async function speakViaEngine(
  opts: EngineStreamOptions,
  deps?: {
    supervisor?: EngineSupervisor;
    fetch?: typeof fetch;
    now?: () => number;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supervisor = deps?.supervisor ?? getEngineSupervisor();
  const doFetch = deps?.fetch ?? fetch;
  const now = deps?.now ?? Date.now;

  const ready = await supervisor.ensureReady();
  if (!ready.ok) return { ok: false, error: ready.error };

  // 时钟自**请求发出**起算，不是首块到达：实测"余量 ≥ 0"的开播点（875 / 872 /
  // 2387ms）就是从发请求到那一刻量的。若从首块起算，第一块到达时 elapsed 恒为 0，
  // 判据永远成立 —— 那等于没有门限，第一块之后就断续。
  const firstAt = now();
  // 请求一开始就续命：只在结束时 touch 的话，刚好卡在 10 分钟边界上的那句会被
  // 空闲回收杀掉（armIdle 到点就 kill，正在合成也照杀）。
  supervisor.touch();

  const res = await doFetch(`http://127.0.0.1:${ready.port}/v1/audio/speech`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      input: opts.text,
      voice: opts.voiceId,
      language: "chinese",
      response_format: "pcm",
    }),
    signal: opts.signal,
  }).catch((error: unknown) => {
    // abort 也走这里：调用方已经丢弃这个流，不该再收到一条 error
    return { ok: false, status: 0, body: null, error } as unknown as Response;
  });
  if (!res.ok || !res.body) {
    if (opts.signal?.aborted) return { ok: false, error: "aborted" };
    return { ok: false, error: `engine http ${res.status || "failed"}` };
  }

  let seq = 0;
  let started = false;
  let heldMs = 0;
  const held: Float32Array[] = [];
  const emit = (samples: Float32Array) => {
    opts.send({
      streamId: opts.streamId,
      type: "chunk",
      seq: seq++,
      samples,
      sampleRate: SAMPLE_RATE,
    });
  };

  // 一个样本两字节，且可能被切在块中间 —— 攒着，别把半样本当样本
  let carry = Buffer.alloc(0);
  try {
    for await (const bytes of res.body as unknown as AsyncIterable<Uint8Array>) {
      const buf = Buffer.concat([carry, Buffer.from(bytes)]);
      const usable = buf.length - (buf.length % 2);
      carry = Buffer.from(buf.subarray(usable));
      if (usable === 0) continue;

      const pcm = new Float32Array(usable / 2);
      for (let i = 0; i < pcm.length; i++)
        pcm[i] = buf.readInt16LE(i * 2) / 32768;

      if (!started) {
        held.push(pcm);
        heldMs += pcm.length / (SAMPLE_RATE / 1000);
        // 攒够了（生成的 ≥ 已等待的）就开播，把攒下的一次性交出去
        if (heldMs - (now() - firstAt) >= STREAM_START_MARGIN_MS) {
          started = true;
          for (const block of held) emit(block);
          held.length = 0;
        }
        continue;
      }
      emit(pcm);
    }
  } catch (error) {
    // 流断在这里。**不发 done、也不发 error**：abort 时调用方已经丢弃了这个流；
    // 网络中途断掉时它自己会按失败处理。把异常抛出去只会变成未处理拒绝。
    if (opts.signal?.aborted) return { ok: false, error: "aborted" };
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  // 极短句：流结束了都没到门限 —— 那就直接给出去，不吞音频
  if (!started) for (const block of held) emit(block);

  opts.send({ streamId: opts.streamId, type: "done" });
  return { ok: true };
}

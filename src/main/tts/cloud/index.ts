/**
 * @module main/tts/cloud/index
 *
 * provider 注册表 + **唯一的下沉出口** `runCloudStream`。
 *
 * 这里做四件事，别处不再各写一遍：seq 单点编号、done/error 只发一次、
 * abort 之后彻底闭嘴、同一 provider 串行 + 超长按句再切。
 */
import type {
  CloudStreamRequest,
  CloudTtsProvider,
  SpeechOut,
} from "./provider";
import { openaiCompatible } from "./providers/openai-compatible";
import { doubao } from "./providers/doubao";

const PROVIDERS: CloudTtsProvider[] = [openaiCompatible, doubao];

export function getCloudProvider(id: string): CloudTtsProvider | null {
  return PROVIDERS.find((p) => p.id === id) ?? null;
}

export function cloudProviderIds(): string[] {
  return PROVIDERS.map((p) => p.id);
}

/**
 * 没显式选音色时用哪个。**默认值在消费方解析**，不要求配置里必须写过 ——
 * 与本机那条路一致（`ipc.ts` 的 `engineVoice()` 就是 `?? ENGINE_VOICE_DEFAULT`）。
 * 缺了它，界面会显示一个默认音色、而合成报「未配置凭据」：一句不实的话。
 *
 * 返回 null = 这个端点没有可选的默认音色（例如通用 OpenAI 端点必须手填）。
 */
export function defaultVoiceId(provider: CloudTtsProvider): string | null {
  return provider.curatedVoices[0]?.id ?? null;
}

/**
 * 超长文本按句再切（**不截断**）。中文句末与英文句末都算；单句仍超限时按长度硬切。
 * 切不动（没有标点且短）就整段返回。
 */
export function splitByLimit(text: string, limit: number): string[] {
  if (limit <= 0 || text.length <= limit) return [text];
  const parts = text
    .split(/(?<=[。！？!?；;.\n])/u)
    .filter((part) => part.trim());
  const out: string[] = [];
  let buf = "";
  for (const part of parts) {
    if (buf && (buf + part).length > limit) {
      out.push(buf);
      buf = "";
    }
    let rest = part;
    while (rest.length > limit) {
      out.push(rest.slice(0, limit));
      rest = rest.slice(limit);
    }
    buf += rest;
  }
  if (buf) out.push(buf);
  return out.length ? out : [text];
}

/** 同一 provider 串行执行（避免撞上游限流）。队列按 provider 常驻。 */
const queues = new Map<string, Promise<unknown>>();
function enqueue<T>(providerId: string, job: () => Promise<T>): Promise<T> {
  const prev = queues.get(providerId) ?? Promise.resolve();
  const next = prev.then(job, job);
  queues.set(
    providerId,
    next.catch(() => undefined),
  );
  return next;
}

export async function runCloudStream(
  provider: CloudTtsProvider,
  req: CloudStreamRequest,
  out: SpeechOut,
  signal: AbortSignal,
): Promise<void> {
  // 空文本不该发出去：本机的 `service.speak` 也拦它，两边行为要一致
  // （而且一次网络请求白花钱）。
  if (!req.text.trim()) {
    out.error("failed", "empty text");
    return;
  }
  let seq = 0;
  let failed = false;
  let doneCurrent = false;

  /** abort 之后**任何**事件都不再发 —— 迟到到达的 chunk 会被 ipc 的上游丢弃，
   *  但独立使用 runner（含将来的库）时这里才是那道闸。 */
  const shut = () => failed || signal.aborted;
  const sink = {
    chunk: (samples: Float32Array, sampleRate: number) => {
      if (shut()) return;
      out.chunk(samples, sampleRate, seq++);
    },
    // 单段结束**不往上层发** done：整次调用结束才发（否则多段只有第一段能出去）
    done: () => {
      doneCurrent = true;
    },
    error: (code: Parameters<SpeechOut["error"]>[0], detail?: string) => {
      if (shut()) return;
      failed = true;
      out.error(code, detail);
    },
  };

  const limit = provider.capabilities.maxCharsPerRequest ?? 0;
  const segments = limit > 0 ? splitByLimit(req.text, limit) : [req.text];
  for (const segment of segments) {
    if (signal.aborted) return;
    doneCurrent = false;
    await enqueue(provider.id, () =>
      provider.stream({ ...req, text: segment }, sink, signal),
    );
    if (failed) return; // 某一段失败 = 整次失败，不再继续后续段
    if (!doneCurrent && !signal.aborted) {
      // 什么都没说就返回了（provider 实现 bug）：别让调用方永远等 done
      sink.error("failed", "provider returned without done/error");
      return;
    }
  }
  if (signal.aborted) return;
  out.done();
}

export type {
  CloudStreamRequest,
  CloudTtsProvider,
  CloudVoiceTier,
  SpeechOut,
} from "./provider";

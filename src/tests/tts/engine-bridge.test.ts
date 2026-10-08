/**
 * engine-bridge 的**直接单测**：这条流此前只有间接覆盖（走 ipc 的集成测试）。
 * 它存在的时机就是 PR1 的 PCM 抽取 —— 改动前先钉住行为，改完必须仍然绿。
 */
import { describe, expect, it, vi } from "vitest";
import { speakViaEngine } from "../../main/engine/engine-bridge";
import type { TtsStreamEvent } from "../../shared/ipc-types";

const supervisor = {
  ensureReady: vi.fn(async () => ({ ok: true as const, port: 9 })),
  touch: vi.fn(),
} as never;

/** 三段 PCM，且**故意切在样本中间**：8 + 5 + 3 = 16 字节 = 8 个 s16le 样本。 */
function chunkedResponse(): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(Buffer.alloc(8, 1)));
      controller.enqueue(new Uint8Array(Buffer.alloc(5, 2)));
      controller.enqueue(new Uint8Array(Buffer.alloc(3, 3)));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/octet-stream" },
  });
}

describe("speakViaEngine 的 PCM 拼接", () => {
  it("切在样本中间的分块拼成正确样本数，最后发 done", async () => {
    const events: TtsStreamEvent[] = [];
    const result = await speakViaEngine(
      {
        text: "x",
        voiceId: "v",
        streamId: 1,
        send: (event) => events.push(event),
      },
      {
        supervisor,
        fetch: (async () => chunkedResponse()) as unknown as typeof fetch,
        now: () => 0,
      },
    );

    expect(result.ok).toBe(true);
    const sampleCounts = events.flatMap((e) =>
      e.type === "chunk" ? [e.samples.length] : [],
    );
    // 不为奇数分块丢字节：5 字节那一段自己出一个样本 + 攒 1 字节
    expect(sampleCounts.reduce((n, x) => n + x, 0)).toBe(8);
    expect(events.at(-1)?.type).toBe("done");
    // seq 连续，且块采样率就是引擎常量
    const seqs = events.flatMap((e) => (e.type === "chunk" ? [e.seq] : []));
    expect(seqs).toEqual(seqs.map((_, i) => i));
    expect(
      events.every((e) => e.type !== "chunk" || e.sampleRate === 24_000),
    ).toBe(true);
  });
});

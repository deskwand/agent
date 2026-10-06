import { describe, expect, it, vi } from "vitest";
import { speakViaEngine } from "../../main/engine/engine-bridge";
import type { EngineSupervisor } from "../../main/engine/engine-supervisor";
import type { TtsStreamEvent } from "../../shared/ipc-types";

const RATE = 24_000;
/** n 毫秒的静音 PCM（内容不重要，长度才是判据）。 */
const pcm = (ms: number) =>
  new Uint8Array(new Int16Array((RATE / 1000) * ms).buffer);

function supervisor(): EngineSupervisor {
  return {
    status: () => "ready",
    ensureReady: vi.fn(async () => ({ ok: true as const, port: 1234 })),
    touch: vi.fn(),
    stop: vi.fn(),
    port: () => 1234,
    reset: vi.fn(),
  };
}

/** 假响应：body 按给定的块与"到达时刻"吐出来（now 由测试的假时钟控制）。 */
function responseWith(chunks: Uint8Array[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return { ok: true, status: 200, body: stream } as unknown as Response;
}

describe("speakViaEngine", () => {
  it("生成追不上的时候一块都不发；追上了把攒下的一次性交出，之后直通", async () => {
    const ticks = [100, 200, 300, 400, 420, 440];
    let i = 0;
    const events: TtsStreamEvent[] = [];
    const result = await speakViaEngine(
      {
        text: "你好",
        voiceId: "vivian",
        streamId: 7,
        send: (e) => events.push(e),
      },
      {
        supervisor: supervisor(),
        fetch: vi.fn(async () =>
          responseWith([pcm(80), pcm(80), pcm(80), pcm(200), pcm(80), pcm(80)]),
        ),
        now: () => ticks[i++],
      },
    );

    expect(result).toEqual({ ok: true });
    const chunks = events.filter((e) => e.type === "chunk");
    // 前三块（80/160/240ms @ 100/200/300ms）都没追上 → 一块都没发
    // 第四块到 400ms 时累计 440ms ≥ 400ms → 一次性把四块交出
    expect(chunks).toHaveLength(6);
    expect(chunks.map((c) => (c as { seq: number }).seq)).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
    expect((chunks[0] as { samples: Float32Array }).samples.length).toBe(
      (RATE / 1000) * 80,
    );
    // 开播那一次交的是"四块一起"：前四块的样本数合计 440ms
    const firstBurst = (["0", "1", "2", "3"] as const).map(
      (n) => (chunks[Number(n)] as { samples: Float32Array }).samples.length,
    );
    expect(firstBurst.reduce((a, b) => a + b, 0)).toBe((RATE / 1000) * 440);
    // 最后一条是 done
    expect(events.at(-1)).toEqual({ streamId: 7, type: "done" });
  });

  it("极短句：整条流结束都没到门限，也不能吞掉音频", async () => {
    const ticks = [10, 20];
    let i = 0;
    const events: TtsStreamEvent[] = [];
    await speakViaEngine(
      {
        text: "嗯",
        voiceId: "vivian",
        streamId: 1,
        send: (e) => events.push(e),
      },
      {
        supervisor: supervisor(),
        // 10ms 音频在 20ms 时到达：永远追不上
        fetch: vi.fn(async () => responseWith([pcm(10), pcm(10)])),
        now: () => ticks[i++],
      },
    );
    const chunks = events.filter((e) => e.type === "chunk");
    expect(chunks).toHaveLength(2);
    expect(events.at(-1)).toEqual({ streamId: 1, type: "done" });
  });

  it("半个样本不丢：奇数字节会被攒着，不当作一个样本", async () => {
    const full = pcm(80);
    const odd = new Uint8Array([...full, 0x11]); // 末尾多一个孤立字节
    const events: TtsStreamEvent[] = [];
    const ticks = [0, 1, 2];
    let i = 0;
    await speakViaEngine(
      {
        text: "x",
        voiceId: "vivian",
        streamId: 2,
        send: (e) => events.push(e),
      },
      {
        supervisor: supervisor(),
        fetch: vi.fn(async () => responseWith([odd, full])),
        now: () => ticks[i++],
      },
    );
    const chunks = events.filter((e) => e.type === "chunk") as {
      samples: Float32Array;
    }[];
    // 第一段取到整数个样本（丢掉孤立尾字节），第二段正常
    expect(chunks[0].samples.length).toBe((RATE / 1000) * 80);
    expect(chunks[1].samples.length).toBe((RATE / 1000) * 80);
  });

  it("abort 之后不再推块，且不返回成功", async () => {
    const controller = new AbortController();
    const events: TtsStreamEvent[] = [];
    const ticks = [0, 1, 2];
    let i = 0;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(pcm(1000)); // 一块就够开播
        // 第二块要等：abort 在这里发生
        controller.signal.addEventListener("abort", () => {
          c.error(new Error("aborted"));
        });
      },
    });
    const fetchFn = vi.fn(async () => {
      controller.abort();
      return { ok: true, status: 200, body: stream } as unknown as Response;
    });

    const result = await speakViaEngine(
      {
        text: "你好",
        voiceId: "vivian",
        streamId: 3,
        send: (e) => events.push(e),
        signal: controller.signal,
      },
      { supervisor: supervisor(), fetch: fetchFn, now: () => ticks[i++] },
    );

    expect(result.ok).toBe(false);
    expect(controller.signal.aborted).toBe(true);
    // 断了之后既没有 done 也没有 error（调用方已经丢弃这个流，由它自己决定）
    expect(events.some((e) => e.type === "done" || e.type === "error")).toBe(
      false,
    );
  });

  it("引擎没起来时返回失败，不推任何事件", async () => {
    const events: TtsStreamEvent[] = [];
    const result = await speakViaEngine(
      {
        text: "你好",
        voiceId: "vivian",
        streamId: 4,
        send: (e) => events.push(e),
      },
      {
        supervisor: {
          ...supervisor(),
          ensureReady: vi.fn(async () => ({
            ok: false as const,
            error: "engine unavailable",
          })),
        },
        fetch: vi.fn(),
        now: () => 0,
      },
    );
    expect(result).toEqual({ ok: false, error: "engine unavailable" });
    expect(events).toHaveLength(0);
  });
});

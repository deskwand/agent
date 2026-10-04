import { describe, expect, it } from "vitest";
import {
  createVadEngine,
  WINDOW_SAMPLES,
  type SherpaVad,
} from "../../main/voice/vad-engine";
import type { VadEdge } from "../../shared/ipc-types";

/** 假包装器：按脚本吐 isDetected，记录收到的 config 与调用次数。 */
function fake(script: boolean[]) {
  const calls = { configs: [] as unknown[], accepts: 0, resets: 0, pops: 0 };
  let segments = 0;
  return {
    calls,
    /** 让段队列里多一段，用来验证它真的被排空。 */
    queueSegment: () => {
      segments += 1;
    },
    createVad: (config: unknown): SherpaVad => {
      calls.configs.push(config);
      // 游标属于**实例**：两个 profile 的实例各有自己的进度。
      let step = 0;
      return {
        acceptWaveform: () => {
          calls.accepts += 1;
        },
        isDetected: () => script[step++] ?? false,
        isEmpty: () => segments === 0,
        pop: () => {
          calls.pops += 1;
          segments -= 1;
        },
        reset: () => {
          calls.resets += 1;
          step = 0;
        },
      };
    },
  };
}

/** 100ms 的一帧，与 mic-capture 的节拍一致。 */
const frame = (n = 1600) => new Int16Array(n).fill(1000);

const engineOf = (
  f: ReturnType<typeof fake>,
  onEdge: (e: VadEdge) => void = () => {},
) => createVadEngine({ modelPath: "/x.onnx", createVad: f.createVad, onEdge });

describe("vad-engine", () => {
  it("攒满窗口才喂模型", () => {
    const f = fake(Array.from({ length: 8 }, () => false));
    const engine = engineOf(f);
    engine.push(frame()); // 1600 采样 = 3 个完整窗口 + 余 64
    expect(f.calls.accepts).toBe(3);
  });

  it("余数跨帧累积", () => {
    const f = fake(Array.from({ length: 8 }, () => false));
    const engine = engineOf(f);
    // 1000 采样 = 1 个完整窗口（512）+ 余 488
    engine.push(frame(1000));
    // 488 + 1000 = 1488 → 2 窗口（1024），余 464。合计 1 + 2 = 3。
    engine.push(frame(1000));
    expect(f.calls.accepts).toBe(3);
  });

  it("只在状态变化时报边沿", () => {
    //        w0     w1     w2     w3     w4
    const f = fake([false, true, true, false, false]);
    const edges: VadEdge[] = [];
    engineOf(f, (e) => edges.push(e)).push(frame(5 * WINDOW_SAMPLES));
    expect(edges).toEqual(["speech-start", "speech-end"]);
  });

  it("喂进去的样本被转成 -1..1 的浮点", () => {
    const f = fake([false]);
    const seen: Float32Array[] = [];
    const engine = createVadEngine({
      modelPath: "/x.onnx",
      createVad: (config) => {
        const v = f.createVad(config);
        return {
          ...v,
          acceptWaveform: (samples: Float32Array) => {
            seen.push(samples);
            v.acceptWaveform(samples);
          },
        };
      },
      onEdge: () => {},
    });
    engine.push(new Int16Array([0x8000, 0, 0x7fff, -0x8000]).slice(0, 4));
    // 不够一个窗口，补满
    engine.push(frame(WINDOW_SAMPLES - 4));
    expect(seen).toHaveLength(1);
    expect(seen[0][0]).toBeCloseTo(-1, 5); // 0x8000 是 Int16 的最小值
    expect(seen[0][1]).toBeCloseTo(0, 5);
    expect(seen[0][2]).toBeCloseTo(0x7fff / 0x8000, 5);
  });

  it("段队列被排空，不随会话增长", () => {
    const f = fake(Array.from({ length: 8 }, () => false));
    const engine = engineOf(f);
    f.queueSegment();
    f.queueSegment();
    engine.push(frame(WINDOW_SAMPLES));
    expect(f.calls.pops).toBe(2);
  });

  it("interactive 的 config 用快起点、低阈值", () => {
    const f = fake([false]);
    engineOf(f).push(frame(WINDOW_SAMPLES));
    expect(f.calls.configs[0]).toMatchObject({
      sileroVad: {
        threshold: 0.5,
        minSpeechDuration: 0.15,
        minSilenceDuration: 0.3,
        windowSize: WINDOW_SAMPLES,
      },
    });
  });

  it("两个 profile 在构造时都建好，切换只换指针", () => {
    const f = fake(Array.from({ length: 8 }, () => false));
    const engine = engineOf(f);
    // 构造完就有两份：构造 = 一次 ONNX 模型加载，不能放在切换点上。
    expect(f.calls.configs).toHaveLength(2);
    expect(f.calls.configs[0]).toMatchObject({
      sileroVad: { threshold: 0.5, minSpeechDuration: 0.15 },
    });
    expect(f.calls.configs[1]).toMatchObject({
      sileroVad: { threshold: 0.6, minSpeechDuration: 0.3 },
    });

    const before = f.calls.accepts;
    engine.setProfile("barge-in");
    // 切换既不构造也不喂模型
    expect(f.calls.configs).toHaveLength(2);
    expect(f.calls.accepts).toBe(before);
  });

  it("说话中切 profile 不吐出伪造的 speech-end", () => {
    // 这是「朗读中用户开口」的真实时序：speaking 已经是 true，切完之后
    // 新实例要重新积累若干窗口才认得出人声。没有 resync 的话这里会发出一个
    // speech-end，而渲染层收到它会直接关掉刚开的轮次。
    const f = fake([true, true, false]);
    const edges: VadEdge[] = [];
    const engine = engineOf(f, (e) => edges.push(e));

    engine.push(frame(WINDOW_SAMPLES)); // 旧实例 w0: true → speech-start
    expect(edges).toEqual(["speech-start"]);

    engine.setProfile("barge-in");

    engine.push(frame(WINDOW_SAMPLES)); // 新实例 w0: true → 被 resync 吞掉
    expect(edges).toEqual(["speech-start"]);
    engine.push(frame(WINDOW_SAMPLES)); // 新实例 w1: true → 无变化
    engine.push(frame(WINDOW_SAMPLES)); // 新实例 w2: false → speech-end
    expect(edges).toEqual(["speech-start", "speech-end"]);
  });

  it("reset 在还在说话时报一句 speech-end，且第一次读数只同步", () => {
    const f = fake([true, false, true]);
    const edges: VadEdge[] = [];
    const engine = engineOf(f, (e) => edges.push(e));
    engine.push(frame(WINDOW_SAMPLES)); // w0: true → speech-start
    expect(edges).toEqual(["speech-start"]);

    engine.reset();
    expect(edges).toEqual(["speech-start", "speech-end"]);

    engine.push(frame(WINDOW_SAMPLES)); // 复位回 w0: true → resync，静默
    expect(edges).toEqual(["speech-start", "speech-end"]);
    engine.push(frame(WINDOW_SAMPLES)); // w1: false → speech-end
    expect(edges).toEqual(["speech-start", "speech-end", "speech-end"]);
  });

  it("切到同一个 profile 是空操作", () => {
    const f = fake([false]);
    const engine = engineOf(f);
    const resets = f.calls.resets;
    engine.setProfile("interactive");
    expect(f.calls.resets).toBe(resets);
  });
});

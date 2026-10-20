import { describe, expect, it, vi } from "vitest";
import {
  createEmotionEngine,
  type EmotionSessionHandle,
} from "../../main/voice/emotion/engine";
import { EMOTION_LABELS } from "../../shared/voice-emotion";

/** 假句柄：会话本体 + 恒等 makeInput（真实现用 ort.Tensor）。 */
function fakeHandle(probs: number[], dims = [1, 9]): EmotionSessionHandle {
  return {
    session: {
      run: vi.fn(async () => ({
        probabilities: { data: Float32Array.from(probs), dims },
      })),
    },
    makeInput: (data) => data,
  };
}

/** 输出帧级特征的假句柄（退回形态：引擎要自己池化 + 头部）。 */
function fakeFeatureHandle(frames: number[][]): EmotionSessionHandle {
  const flat = Float32Array.from(frames.flat());
  return {
    session: {
      run: vi.fn(async () => ({
        features: { data: flat, dims: [1, frames.length, frames[0].length] },
      })),
    },
    makeInput: (data) => data,
  };
}

describe("emotion engine", () => {
  it("概率输出时取最大类", async () => {
    const probs = EMOTION_LABELS.map((label) =>
      label === "sad" ? 0.9 : 0.0125,
    );
    const engine = createEmotionEngine({
      loadSession: async () => fakeHandle(probs),
    });
    const signal = await engine.recognize(new Int16Array(16000), 500);
    // 注意：概率是从 Float32Array 读回来的，0.9 会变成 0.89999998 —— 别用 toEqual。
    expect(signal?.label).toBe("sad");
    expect(signal?.confidence).toBeCloseTo(0.9, 5);
  });

  it("特征输出时自己池化，并用注入的头部算概率", async () => {
    // 两帧 768 维特征，均值 = 第 0 维为 1，其余 0。
    const frame = new Array<number>(768).fill(0);
    frame[0] = 1;
    const weight = new Float32Array(9 * 768);
    weight[0] = 1; // angry 行只吃第 0 维
    const engine = createEmotionEngine({
      loadSession: async () => fakeFeatureHandle([frame, frame]),
      head: { weight, bias: new Float32Array(9) },
    });
    const signal = await engine.recognize(new Int16Array(16000), 500);
    expect(signal?.label).toBe("angry");
  });

  it("超时返回 null，不抛错", async () => {
    const handle: EmotionSessionHandle = {
      session: { run: () => new Promise(() => {}) }, // 永不 resolve
      makeInput: (data) => data,
    };
    const engine = createEmotionEngine({ loadSession: async () => handle });
    await expect(
      engine.recognize(new Int16Array(16000), 20),
    ).resolves.toBeNull();
  });

  it("加载失败返回 null，不抛错", async () => {
    const engine = createEmotionEngine({
      loadSession: async () => {
        throw new Error("model missing");
      },
    });
    await expect(
      engine.recognize(new Int16Array(16000), 500),
    ).resolves.toBeNull();
  });

  it("warmUp 提前加载会话，失败也不抛", async () => {
    const loadSession = vi.fn(async () => {
      throw new Error("not installed");
    });
    const engine = createEmotionEngine({ loadSession });
    await expect(engine.warmUp()).resolves.toBeUndefined();
    expect(loadSession).toHaveBeenCalledTimes(1);
  });

  it("release 调到底层会话，且之后可重新加载", async () => {
    const handle = fakeHandle(EMOTION_LABELS.map(() => 1 / 9));
    const release = vi.fn();
    handle.session.release = release;
    const loadSession = vi.fn(async () => handle);
    const engine = createEmotionEngine({ loadSession });
    await engine.recognize(new Int16Array(16000), 500);
    engine.release();
    expect(release).toHaveBeenCalledTimes(1);
    await engine.recognize(new Int16Array(16000), 500);
    expect(loadSession).toHaveBeenCalledTimes(2);
  });
});

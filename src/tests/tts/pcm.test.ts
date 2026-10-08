import { describe, expect, it } from "vitest";
import { createPcmState, pushPcmBytes } from "../../main/tts/pcm";

const s16 = (...values: number[]) => {
  const b = Buffer.alloc(values.length * 2);
  values.forEach((v, i) => b.writeInt16LE(v, i * 2));
  return b;
};

describe("pushPcmBytes", () => {
  it("整样本：字节 → Float32", () => {
    const got = pushPcmBytes(createPcmState(), s16(0, 32767, -32768));
    expect(Array.from(got ?? [])).toEqual([0, 32767 / 32768, -1]);
  });

  it("半样本边界：3 字节先出一个样本，剩下的攒着，补齐后完整", () => {
    const state = createPcmState();
    // s16(1000, 2000) 的字节是 [0xE8,0x03, 0xD0,0x07]；只喂前 3 字节 = 1000 + 半个 2000
    const first = pushPcmBytes(state, s16(1000, 2000).subarray(0, 3));
    expect(first?.length).toBe(1);
    expect(first?.[0]).toBeCloseTo(1000 / 32768, 6);
    // 补上高位字节 0x07 才拼回 2000；补 0x00 会得到 208 —— 这就是 carry 存在的理由
    const second = pushPcmBytes(state, Buffer.from([0x07]));
    expect(second?.length).toBe(1);
    expect(second?.[0]).toBeCloseTo(2000 / 32768, 6);
    expect(state.carry.length).toBe(0);
  });

  it("空输入：返回 null，carry 不变", () => {
    const state = createPcmState();
    expect(pushPcmBytes(state, Buffer.alloc(0))).toBeNull();
    expect(state.carry.length).toBe(0);
  });

  it("单字节输入：返回 null 但字节进 carry", () => {
    const state = createPcmState();
    expect(pushPcmBytes(state, Buffer.from([0x7f]))).toBeNull();
    expect(state.carry.length).toBe(1);
  });

  it("跨三次调用的奇数分块：样本数守恒、不丢字节", () => {
    const state = createPcmState();
    const all = s16(1, 2, 3, 4, 5); // 10 字节 = 5 个样本
    let total = 0;
    for (const [from, to] of [
      [0, 3],
      [3, 6],
      [6, 10],
    ]) {
      const got = pushPcmBytes(state, all.subarray(from, to));
      if (got) total += got.length;
    }
    expect(total).toBe(5);
    expect(state.carry.length).toBe(0);
  });
});

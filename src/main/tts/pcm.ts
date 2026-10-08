/**
 * @module main/tts/pcm
 *
 * s16le 字节流 → Float32 样本。**采样率与 seq 不在这里**：调用方自己带
 * （本机引擎是 24k 常量、云端由 provider 声明）。
 *
 * 放在 `tts/` 根而不是 `tts/cloud/`：本机大模型那条流（`engine-bridge`）与云端
 * 用的是**同一段逻辑**，两份实现迟早漂移。纯函数、无依赖，将来随库一起搬走。
 *
 * 存在的理由：网络分块会把一个样本切成两半 —— 不攒 carry 就会错位成噪声。
 */
export interface PcmState {
  carry: Buffer;
}

export function createPcmState(): PcmState {
  return { carry: Buffer.alloc(0) };
}

export function pushPcmBytes(
  state: PcmState,
  bytes: Uint8Array,
): Float32Array | null {
  const buf =
    state.carry.length === 0
      ? Buffer.from(bytes)
      : Buffer.concat([state.carry, Buffer.from(bytes)]);
  const usable = buf.length - (buf.length % 2);
  state.carry =
    usable === buf.length ? Buffer.alloc(0) : Buffer.from(buf.subarray(usable));
  if (usable === 0) return null;
  const out = new Float32Array(usable / 2);
  for (let i = 0; i < out.length; i += 1)
    out[i] = buf.readInt16LE(i * 2) / 32768;
  return out;
}

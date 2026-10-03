/**
 * @module main/tts/wav
 *
 * Float32 采样 → 16-bit PCM 单声道 WAV。
 *
 * 只有「给模型的工具」那条路径需要它（产物要落盘成文件）。IPC 路径传的是原始
 * Float32 —— 渲染层的 AudioBuffer 用不上容器格式，多编一次只是白花时间。
 */
import type { SynthesizedAudio } from "./tts-engine";

const HEADER_BYTES = 44;

export function encodeWav(audio: SynthesizedAudio): Uint8Array {
  const { samples, sampleRate } = audio;
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // fmt 块大小
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 单声道
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // 字节率
  view.setUint16(32, 2, true); // 块对齐
  view.setUint16(34, 16, true); // 位深
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < samples.length; i++) {
    // 先夹紧再缩放：|v| > 1 直接乘 32767 会溢出成反向的尖峰
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(HEADER_BYTES + i * 2, Math.round(clamped * 32767), true);
  }
  return new Uint8Array(buffer);
}

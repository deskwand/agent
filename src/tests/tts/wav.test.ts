import { describe, expect, it } from "vitest";
import { encodeWav } from "../../main/tts/wav";

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.slice(start, start + length));

describe("encodeWav", () => {
  it("writes a 16-bit mono PCM header for the given sample rate", () => {
    const wav = encodeWav({ samples: new Float32Array(10), sampleRate: 44100 });
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);

    expect(ascii(wav, 0, 4)).toBe("RIFF");
    expect(ascii(wav, 8, 4)).toBe("WAVE");
    expect(ascii(wav, 36, 4)).toBe("data");
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // 单声道
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(20); // 10 个采样 × 2 字节
    expect(wav.byteLength).toBe(44 + 20);
  });

  it("clamps out-of-range samples instead of wrapping them", () => {
    const wav = encodeWav({
      samples: new Float32Array([1.5, -1.5, 0]),
      sampleRate: 24000,
    });
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);

    expect(view.getInt16(44, true)).toBe(32767); // 不夹紧会溢出成负值
    expect(view.getInt16(46, true)).toBe(-32767);
    expect(view.getInt16(48, true)).toBe(0);
  });
});

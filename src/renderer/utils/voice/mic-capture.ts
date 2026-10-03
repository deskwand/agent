// src/renderer/utils/voice/mic-capture.ts
/**
 * @module renderer/utils/voice/mic-capture
 *
 * 麦克风采集。三件事：要权限、按 16kHz 交出 PCM16、能干净地停。
 *
 * 三个刻意的选择：
 *  1. `new AudioContext({ sampleRate: 16000 })` 让 Chromium 内部的重采样器干活，
 *     不手写降采样（手写盒式抽取会混叠，还多一个模块）。
 *  2. Worklet 源码经 Blob URL 加载，不落成独立文件 —— 否则要给 vite 加 worklet 规则。
 *  3. 每 100ms 交一片，而不是每帧（128 采样）：IPC 消息少 12 倍。
 */
const WORKLET_SOURCE = `
class VoicePcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(${16000 / 10});
    this.offset = 0;
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      for (let i = 0; i < channel.length; i += 1) {
        this.buffer[this.offset] = channel[i];
        this.offset += 1;
        if (this.offset === this.buffer.length) {
          this.port.postMessage(this.buffer.slice());
          this.offset = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("voice-pcm-capture", VoicePcmCapture);
`;

export type MicErrorCode = "VOICE_MIC_DENIED" | "VOICE_MIC_UNAVAILABLE";

export class MicError extends Error {
  constructor(readonly code: MicErrorCode) {
    super(code);
    this.name = "MicError";
  }
}

export interface MicCapture {
  stop: () => void;
}

/** 把 Float32 帧转成 PCM16，并算一个 0..1 的响度给音量条。 */
function toPcm16(frame: Float32Array): { pcm: Int16Array; level: number } {
  const pcm = new Int16Array(frame.length);
  let sum = 0;
  for (let i = 0; i < frame.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, frame[i]));
    pcm[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    sum += clamped * clamped;
  }
  const rms = Math.sqrt(sum / frame.length);
  // -60dBFS 映射到 0，-20dBFS 映射到 1，够音量条用了
  const db = 20 * Math.log10(rms || 1e-9);
  return { pcm, level: Math.max(0, Math.min(1, (db + 60) / 40)) };
}

export async function startMicCapture(
  onSamples: (pcm: Int16Array, level: number) => void,
): Promise<MicCapture> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1 },
    });
  } catch (error) {
    throw new MicError(classifyMicError(error));
  }

  const context = new AudioContext({ sampleRate: 16000 });
  const moduleUrl = URL.createObjectURL(
    new Blob([WORKLET_SOURCE], { type: "application/javascript" }),
  );
  try {
    await context.audioWorklet.addModule(moduleUrl);
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }

  const source = context.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(context, "voice-pcm-capture");
  node.port.onmessage = (event: MessageEvent<Float32Array>) => {
    const { pcm, level } = toPcm16(event.data);
    onSamples(pcm, level);
  };

  // Worklet 必须连到 destination 才会被拉取。直连会回授，所以中间插一个零增益节点。
  const sink = context.createGain();
  sink.gain.value = 0;
  source.connect(node);
  node.connect(sink);
  sink.connect(context.destination);

  return {
    stop: () => {
      node.port.onmessage = null;
      source.disconnect();
      node.disconnect();
      sink.disconnect();
      for (const track of stream.getTracks()) track.stop();
      void context.close();
    },
  };
}

/** 权限被拒与「没有可用设备」要分开：前者能让用户去系统设置改，后者不能。 */
function classifyMicError(error: unknown): MicErrorCode {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "VOICE_MIC_DENIED";
  return "VOICE_MIC_UNAVAILABLE";
}

/**
 * @module main/tts/tts-engine
 *
 * 朗读引擎接口。**它存在的唯一理由是读取层与 IPC 层可测** —— 注入假引擎就能测，
 * 不必为跑单测下载 157MB 模型，更不必真的出声。
 *
 * 理由写错会真出事：后来人看到「为二期预留」而二期还没来，就会删掉它，
 * 然后读取层的测试跟着塌。（语音输入设计 §3.2 的同一课。）
 */
export interface SynthesizedAudio {
  /** 原始采样，不是 WAV：渲染层用 Web Audio，AudioBuffer 本来就要 Float32。 */
  samples: Float32Array;
  sampleRate: number;
}

export interface TtsEngine {
  /** 加载模型。幂等：已加载就直接返回。 */
  load(): Promise<void>;
  /** 合成一句。抛错即失败，由调用方决定重试还是报错。 */
  synthesize(text: string): Promise<SynthesizedAudio>;
  isLoaded(): boolean;
}

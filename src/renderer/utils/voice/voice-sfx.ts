/**
 * @module renderer/utils/voice/voice-sfx
 *
 * 语音模式的进入音与退出音。
 *
 * 两个音都现算（Web Audio 振荡器与噪声缓冲），不带素材文件：没有加载路径、
 * 没有二进制资源。参数就是下面这些常量，来自语音模式音效设计（该设计文档在
 * 开发用的 design-docs/ 下，不随仓库发布）。
 *
 * 响度是这里的常量，跟 TTS 增益无关 —— ChatGPT 标准语音模式的「每轮提示音」
 * 就是因为绑在 TTS 音量上、响度又大才被投诉的。
 *
 * 不做记忆语义：同一个音可以被叫多次，什么时候叫由调用方决定。
 */

export interface VoiceSfx {
  startCue(): void;
  exitCue(): void;
}

export interface VoiceSfxDeps {
  createContext: () => AudioContext;
}

/** 进入音：165Hz + 五度 247.5Hz。 */
const START_PARTIALS: ReadonlyArray<readonly [number, number]> = [
  [165, 1],
  [247.5, 0.34],
];
/** 试听样本把「分音之和」归一化到 0.28，分音和峰约 1.34，所以总增益取 0.21。 */
const START_PEAK = 0.21;
const START_OPEN_SECONDS = 0.32;
const START_DECAY_SECONDS = 0.22;
const START_SECONDS = 0.76;
const START_LOWPASS_FROM = 400;
const START_LOWPASS_TO = 1600;

/** 退出音：带通噪声，低通从 2200Hz 下行到 500Hz。 */
const EXIT_PEAK = 0.24;
const EXIT_ATTACK_SECONDS = 0.1;
const EXIT_DECAY_SECONDS = 0.18;
const EXIT_SECONDS = 0.62;
const EXIT_HIGHPASS = 280;
const EXIT_LOWPASS_FROM = 2200;
const EXIT_LOWPASS_TO = 500;

/** 滤波器 Q 取 0.7（Butterworth）：没有共振峰，听不出「电子味」。 */
const FILTER_Q = 0.7;

/** 打断在响的音：30ms 收掉，50ms 后停源。 */
const CUT_SECONDS = 0.03;
const CUT_RELEASE_SECONDS = 0.05;

interface ActiveCue {
  gain: GainNode;
  sources: AudioScheduledSourceNode[];
  nodes: AudioNode[];
}

export function createVoiceSfx(deps: VoiceSfxDeps): VoiceSfx {
  let active: ActiveCue | null = null;
  let noise: AudioBuffer | null = null;

  /** 把还在响的那条链收掉。已经结束的链在 onended 里被清空，所以不会重复停。 */
  const stopActive = (context: AudioContext) => {
    const cue = active;
    if (!cue) return;
    active = null;
    const now = context.currentTime;
    cue.gain.gain.cancelScheduledValues(now);
    cue.gain.gain.setValueAtTime(cue.gain.gain.value, now);
    cue.gain.gain.linearRampToValueAtTime(0, now + CUT_SECONDS);
    for (const source of cue.sources) source.stop(now + CUT_RELEASE_SECONDS);
  };

  /** 交付一条链：起播、按总长停止、结束后断开所有节点。 */
  const arm = (
    cue: ActiveCue,
    primary: AudioScheduledSourceNode,
    endsAt: number,
  ) => {
    active = cue;
    primary.onended = () => {
      if (active === cue) active = null;
      for (const node of cue.nodes) node.disconnect();
    };
    for (const source of cue.sources) {
      source.start();
      source.stop(endsAt);
    }
  };

  /** 1 秒白噪声，按 context 复用：退出音可以响很多次，不该每次都分配。 */
  const noiseBuffer = (context: AudioContext): AudioBuffer => {
    if (noise) return noise;
    const frames = Math.ceil(context.sampleRate);
    const buffer = context.createBuffer(1, frames, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1;
    noise = buffer;
    return buffer;
  };

  return {
    startCue() {
      const context = deps.createContext();
      stopActive(context);
      const t0 = context.currentTime;
      const endsAt = t0 + START_SECONDS;

      const gain = context.createGain();
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(START_PEAK, t0 + START_OPEN_SECONDS);
      gain.gain.setTargetAtTime(
        0,
        t0 + START_OPEN_SECONDS,
        START_DECAY_SECONDS,
      );

      const lowpass = context.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.Q.value = FILTER_Q;
      lowpass.frequency.setValueAtTime(START_LOWPASS_FROM, t0);
      lowpass.frequency.linearRampToValueAtTime(
        START_LOWPASS_TO,
        t0 + START_OPEN_SECONDS,
      );
      lowpass.connect(gain);
      gain.connect(context.destination);

      const nodes: AudioNode[] = [lowpass, gain];
      const sources: AudioScheduledSourceNode[] = [];
      for (const [frequency, amplitude] of START_PARTIALS) {
        const part = context.createGain();
        part.gain.setValueAtTime(amplitude, t0);
        const oscillator = context.createOscillator();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency, t0);
        oscillator.connect(part);
        part.connect(lowpass);
        nodes.push(part, oscillator);
        sources.push(oscillator);
      }
      arm({ gain, sources, nodes }, sources[0], endsAt);
    },

    exitCue() {
      const context = deps.createContext();
      stopActive(context);
      const t0 = context.currentTime;
      const endsAt = t0 + EXIT_SECONDS;

      const gain = context.createGain();
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(EXIT_PEAK, t0 + EXIT_ATTACK_SECONDS);
      gain.gain.setTargetAtTime(
        0,
        t0 + EXIT_ATTACK_SECONDS,
        EXIT_DECAY_SECONDS,
      );

      const highpass = context.createBiquadFilter();
      highpass.type = "highpass";
      highpass.Q.value = FILTER_Q;
      highpass.frequency.setValueAtTime(EXIT_HIGHPASS, t0);

      const lowpass = context.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.Q.value = FILTER_Q;
      lowpass.frequency.setValueAtTime(EXIT_LOWPASS_FROM, t0);
      lowpass.frequency.linearRampToValueAtTime(EXIT_LOWPASS_TO, endsAt);

      const source = context.createBufferSource();
      source.buffer = noiseBuffer(context);

      source.connect(highpass);
      highpass.connect(lowpass);
      lowpass.connect(gain);
      gain.connect(context.destination);

      arm(
        { gain, sources: [source], nodes: [source, highpass, lowpass, gain] },
        source,
        endsAt,
      );
    },
  };
}

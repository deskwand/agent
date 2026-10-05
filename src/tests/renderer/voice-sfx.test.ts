// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createVoiceSfx } from "../../renderer/utils/voice/voice-sfx";

/** AudioParam 替身：只记录被调过什么。 */
interface FakeParam {
  value: number;
  setValueAtTime: ReturnType<typeof vi.fn>;
  linearRampToValueAtTime: ReturnType<typeof vi.fn>;
  setTargetAtTime: ReturnType<typeof vi.fn>;
  cancelScheduledValues: ReturnType<typeof vi.fn>;
}

function fakeParam(value: number): FakeParam {
  return {
    value,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  };
}

interface FakeNode {
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

interface FakeOscillator extends FakeNode {
  type: string;
  frequency: FakeParam;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  onended: (() => void) | null;
}

interface FakeFilter extends FakeNode {
  type: string;
  frequency: FakeParam;
  Q: FakeParam;
}

/** 极简 AudioContext 替身：只实现音效用到的那几个成员。 */
function fakeContext() {
  const nodes: FakeNode[] = [];
  const oscillators: FakeOscillator[] = [];
  const gains: Array<FakeNode & { gain: FakeParam }> = [];
  const filters: FakeFilter[] = [];
  const bufferSources: Array<
    FakeNode & {
      buffer: unknown;
      start: ReturnType<typeof vi.fn>;
      stop: ReturnType<typeof vi.fn>;
      onended: (() => void) | null;
    }
  > = [];
  const createBuffer = vi.fn(
    (_channels: number, frames: number, rate: number) => ({
      length: frames,
      sampleRate: rate,
      getChannelData: () => new Float32Array(frames),
    }),
  );

  const context = {
    currentTime: 0,
    sampleRate: 16000,
    destination: {},
    createBuffer,
    createOscillator: (): FakeOscillator => {
      const node: FakeOscillator = {
        type: "sine",
        frequency: fakeParam(0),
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null,
      };
      oscillators.push(node);
      nodes.push(node);
      return node;
    },
    createGain: () => {
      const node = {
        gain: fakeParam(1),
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      gains.push(node);
      nodes.push(node);
      return node;
    },
    createBiquadFilter: (): FakeFilter => {
      const node = {
        type: "lowpass",
        frequency: fakeParam(0),
        Q: fakeParam(0),
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      filters.push(node);
      nodes.push(node);
      return node;
    },
    createBufferSource: () => {
      const node = {
        buffer: null as unknown,
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null as (() => void) | null,
      };
      bufferSources.push(node);
      nodes.push(node);
      return node;
    },
  };
  return {
    context,
    nodes,
    oscillators,
    gains,
    filters,
    bufferSources,
    createBuffer,
  };
}

/** 主增益：唯一一个被 setTargetAtTime 收过尾的 gain。 */
function masterGain(gains: Array<FakeNode & { gain: FakeParam }>) {
  const found = gains.find((g) => g.gain.setTargetAtTime.mock.calls.length > 0);
  if (!found) throw new Error("没有找到主增益");
  return found.gain;
}

describe("语音模式音效", () => {
  it("进入音：两个分音、320ms 打开到 0.21、低通 400→1600、1.2s 走完尾巴", () => {
    const ctx = fakeContext();
    const sfx = createVoiceSfx({ createContext: () => ctx.context as never });

    sfx.startCue();

    expect(ctx.oscillators).toHaveLength(2);
    expect(ctx.oscillators[0].frequency.setValueAtTime).toHaveBeenCalledWith(
      165,
      0,
    );
    expect(ctx.oscillators[1].frequency.setValueAtTime).toHaveBeenCalledWith(
      247.5,
      0,
    );
    expect(ctx.oscillators[0].type).toBe("sine");

    const master = masterGain(ctx.gains);
    expect(master.setValueAtTime).toHaveBeenCalledWith(0, 0);
    expect(master.linearRampToValueAtTime).toHaveBeenCalledWith(0.21, 0.32);
    expect(master.setTargetAtTime).toHaveBeenCalledWith(0, 0.32, 0.22);

    const lowpass = ctx.filters[0];
    expect(lowpass.type).toBe("lowpass");
    expect(lowpass.frequency.setValueAtTime).toHaveBeenCalledWith(400, 0);
    expect(lowpass.frequency.linearRampToValueAtTime).toHaveBeenCalledWith(
      1600,
      0.32,
    );

    expect(ctx.oscillators[0].stop).toHaveBeenCalledWith(1.2);
  });

  it("退出音：一个噪声源、280Hz 高通、低通 2200→500、100ms 起音到 0.24", () => {
    const ctx = fakeContext();
    const sfx = createVoiceSfx({ createContext: () => ctx.context as never });

    sfx.exitCue();

    expect(ctx.bufferSources).toHaveLength(1);
    expect(ctx.bufferSources[0].start).toHaveBeenCalled();
    expect(ctx.bufferSources[0].stop).toHaveBeenCalledWith(0.62);

    const [highpass, lowpass] = ctx.filters;
    expect(highpass.type).toBe("highpass");
    expect(highpass.frequency.setValueAtTime).toHaveBeenCalledWith(280, 0);
    expect(lowpass.type).toBe("lowpass");
    expect(lowpass.frequency.linearRampToValueAtTime).toHaveBeenCalledWith(
      500,
      0.62,
    );

    const master = masterGain(ctx.gains);
    expect(master.linearRampToValueAtTime).toHaveBeenCalledWith(0.24, 0.1);
  });

  it("放新音时把旧音收掉，而不是叠着响", () => {
    const ctx = fakeContext();
    const sfx = createVoiceSfx({ createContext: () => ctx.context as never });

    sfx.startCue();
    const first = ctx.oscillators[0];
    const firstMaster = masterGain(ctx.gains);

    sfx.exitCue();

    expect(firstMaster.cancelScheduledValues).toHaveBeenCalled();
    expect(firstMaster.linearRampToValueAtTime).toHaveBeenCalledWith(0, 0.03);
    expect(first.stop).toHaveBeenCalledWith(0.05);
  });

  it("播完后断开所有节点", () => {
    const ctx = fakeContext();
    const sfx = createVoiceSfx({ createContext: () => ctx.context as never });

    sfx.startCue();
    ctx.oscillators[0].onended?.();

    expect(ctx.nodes.length).toBeGreaterThan(0);
    for (const node of ctx.nodes) expect(node.disconnect).toHaveBeenCalled();
  });

  it("噪声缓冲只建一次，退出音重复响不重复分配", () => {
    const ctx = fakeContext();
    const sfx = createVoiceSfx({ createContext: () => ctx.context as never });

    sfx.exitCue();
    sfx.exitCue();

    expect(ctx.createBuffer).toHaveBeenCalledTimes(1);
  });

  it("所有时间都是相对 currentTime 的，不是绝对时刻", () => {
    const ctx = fakeContext();
    ctx.context.currentTime = 12.5;
    const sfx = createVoiceSfx({ createContext: () => ctx.context as never });

    sfx.startCue();

    const master = masterGain(ctx.gains);
    expect(master.setValueAtTime).toHaveBeenCalledWith(0, 12.5);
    expect(master.linearRampToValueAtTime).toHaveBeenCalledWith(0.21, 12.82);
    expect(
      ctx.filters[0].frequency.linearRampToValueAtTime,
    ).toHaveBeenCalledWith(1600, 12.82);
    expect(ctx.oscillators[0].stop).toHaveBeenCalledWith(13.7);
  });

  it("退出音播完也断开所有节点", () => {
    const ctx = fakeContext();
    const sfx = createVoiceSfx({ createContext: () => ctx.context as never });

    sfx.exitCue();
    ctx.bufferSources[0].onended?.();

    for (const node of ctx.nodes) expect(node.disconnect).toHaveBeenCalled();
  });

  it("被打断的旧音同样会断开自己的节点", () => {
    const ctx = fakeContext();
    const sfx = createVoiceSfx({ createContext: () => ctx.context as never });

    sfx.startCue();
    const firstCueNodes = [...ctx.nodes];

    sfx.exitCue();
    ctx.oscillators[0].onended?.();

    for (const node of firstCueNodes)
      expect(node.disconnect).toHaveBeenCalled();
  });
});

import { describe, expect, it } from "vitest";
import {
  LocalTranscriptionEngine,
  TAIL_PAD_SECONDS,
} from "../../main/voice/local-engine";
import {
  SAMPLE_RATE,
  type TranscribeUpdate,
} from "../../main/voice/transcription-engine";

/** 假 sherpa addon：记录收到的配置，按脚本吐结果。 */
function fakeAddon(script: { partials: string[]; endpointsAt: number[] }) {
  const calls = {
    config: null as unknown,
    accepts: 0,
    /** 累计喂进去的样本数 —— 「补了多久静音」只能从它看出来。 */
    acceptedSamples: 0,
    /** 调用顺序。补静音必须在 inputFinished 之前，顺序错了补了也白补。 */
    events: [] as string[],
    resets: 0,
    inputFinished: false,
    recognizers: 0,
    streams: 0,
  };
  let steps = 0;
  const addon = {
    createOnlineRecognizer: (config: unknown) => {
      calls.config = config;
      calls.recognizers += 1;
      return { id: "recognizer" };
    },
    createOnlineStream: () => {
      calls.streams += 1;
      return { id: "stream" };
    },
    acceptWaveformOnline: (
      _stream: unknown,
      wave: { samples: Float32Array },
    ) => {
      calls.accepts += 1;
      calls.acceptedSamples += wave.samples.length;
      calls.events.push(`accept:${wave.samples.length}`);
    },
    // 每次 push 只消化一个 chunk，与真实解码的「喂一块、解一块」一致。
    isOnlineStreamReady: () => steps < calls.accepts,
    decodeOnlineStream: () => {
      steps += 1;
    },
    getOnlineStreamResultAsJson: () =>
      JSON.stringify({
        text:
          script.partials[Math.min(steps, script.partials.length) - 1] ?? "",
      }),
    isEndpoint: () => script.endpointsAt.includes(calls.accepts),
    reset: () => {
      calls.resets += 1;
    },
    inputFinished: () => {
      calls.inputFinished = true;
      calls.events.push("inputFinished");
    },
  };
  return { addon, calls };
}

const push = (
  stream: ReturnType<LocalTranscriptionEngine["createStream"]>,
  n = 1,
) => {
  let last: TranscribeUpdate = { partial: "" };
  for (let i = 0; i < n; i += 1) {
    last = stream.push(new Float32Array(1600));
  }
  return last;
};

describe("LocalTranscriptionEngine", () => {
  it("passes modelType and bpeVocab — omitting either makes sherpa fail with a useless error", () => {
    const { addon, calls } = fakeAddon({ partials: [], endpointsAt: [] });
    new LocalTranscriptionEngine({
      addon,
      modelDir: "/m",
    }).createStream();

    const config = calls.config as {
      modelConfig: {
        modelType?: string;
        bpeVocab?: string;
        transducer?: unknown;
      };
      featConfig: { sampleRate?: number; featureDim?: number };
    };
    expect(config.modelConfig.modelType).toBe("zipformer2");
    expect(config.modelConfig.bpeVocab).toBe("/m/bpe.model");
    expect(config.modelConfig.transducer).toEqual({
      encoder: "/m/encoder.int8.onnx",
      decoder: "/m/decoder.onnx",
      joiner: "/m/joiner.int8.onnx",
    });
    expect(config.featConfig).toEqual({
      sampleRate: SAMPLE_RATE,
      featureDim: 80,
    });
  });

  it("reports the current partial text while decoding", () => {
    const { addon } = fakeAddon({ partials: ["你", "你好"], endpointsAt: [] });
    const stream = new LocalTranscriptionEngine({
      addon,
      modelDir: "/m",
    }).createStream();

    expect(push(stream).partial).toBe("你");
    expect(push(stream).partial).toBe("你好");
  });

  it("emits a segment when the engine signals an endpoint, then resets", () => {
    const { addon, calls } = fakeAddon({
      partials: ["你好"],
      endpointsAt: [1],
    });
    const stream = new LocalTranscriptionEngine({
      addon,
      modelDir: "/m",
    }).createStream();

    const update = push(stream);

    expect(update.segment).toBe("你好");
    expect(update.partial).toBe("");
    expect(calls.resets).toBe(1);
  });

  it("returns the un-committed tail on finish", async () => {
    const { addon, calls } = fakeAddon({
      partials: ["最后一句"],
      endpointsAt: [],
    });
    const stream = new LocalTranscriptionEngine({
      addon,
      modelDir: "/m",
    }).createStream();
    push(stream);

    const result = await stream.finish();

    expect(result.text).toBe("最后一句");
    expect(calls.inputFinished).toBe(true);
  });

  it("finish() 补尾部静音 —— 短句不补就一个字都吐不出来", async () => {
    // 实测「你好」（0.54s）不补时一个字都不出，补 0.6s 才出「你好」。
    // 流式 zipformer 要有右上下文才能定稿最后几个 token，而 inputFinished()
    // 只冲刷特征帧（见 sherpa-onnx 的 online-stream.h 注释）。
    const { addon, calls } = fakeAddon({
      partials: ["你好"],
      endpointsAt: [],
    });
    const stream = new LocalTranscriptionEngine({
      addon,
      modelDir: "/m",
    }).createStream();
    push(stream);
    const before = calls.acceptedSamples;

    await stream.finish();

    expect(calls.acceptedSamples - before).toBe(SAMPLE_RATE * TAIL_PAD_SECONDS);
  });

  it("TAIL_PAD_SECONDS 不低于实测下限 —— 调到 0 会让短句重新变成空", () => {
    // 上面那条读的是同一个常量，所以常量本身是 0 时它会**恒真通过**。
    // 这一条是常量自己的守卫：480ms 档实测需求是 0.6~1.0s。
    // 注意它只挡「被改小到失效」，挡不住「改小到不够」——那是真链路测试的职责。
    expect(TAIL_PAD_SECONDS).toBeGreaterThanOrEqual(1);
  });

  it("补静音在 inputFinished 之前 —— 顺序反了补的就不算输入", async () => {
    const { addon, calls } = fakeAddon({
      partials: ["你好"],
      endpointsAt: [],
    });
    const stream = new LocalTranscriptionEngine({
      addon,
      modelDir: "/m",
    }).createStream();
    push(stream);
    calls.events.length = 0;

    await stream.finish();

    // 只看最后两个事件：前面是正常喂音频产生的 accept
    expect(calls.events.at(-2)).toBe(
      `accept:${SAMPLE_RATE * TAIL_PAD_SECONDS}`,
    );
    expect(calls.events.at(-1)).toBe("inputFinished");
  });

  it("补静音触发的端点不会被 reset —— finish() 不消费端点信号", async () => {
    // 1.5s 的尾部静音会越过 rule2MinTrailingSilence（1.2s），端点会触发。
    // 这是无害的：finish() 不查 isEndpoint、不调 reset，所以文字留在流里。
    // 这条测试锁住那个前提 —— 谁将来往 finish() 里加端点处理，它会红。
    const { addon, calls } = fakeAddon({
      partials: ["你好"],
      endpointsAt: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    });
    const stream = new LocalTranscriptionEngine({
      addon,
      modelDir: "/m",
    }).createStream();
    push(stream);
    calls.resets = 0;

    const result = await stream.finish();

    expect(calls.resets).toBe(0);
    expect(result.text).toBe("你好");
  });

  it("stops feeding audio after abort", () => {
    const { addon, calls } = fakeAddon({
      partials: ["x", "y", "z"],
      endpointsAt: [],
    });
    const stream = new LocalTranscriptionEngine({
      addon,
      modelDir: "/m",
    }).createStream();
    push(stream);
    const before = calls.accepts;

    stream.abort();
    push(stream, 3);

    expect(calls.accepts).toBe(before);
  });

  it("abort() 之后 finish() 不补静音 —— 已丢弃的会话不该再喂任何东西", async () => {
    // 补静音是新增的副作用，所以它必须像 push 一样尊重 closed。
    // 否则一条被 abort 的会话会在收尾时又给引擎塞 1.5 秒音频。
    const { addon, calls } = fakeAddon({ partials: ["x"], endpointsAt: [] });
    const stream = new LocalTranscriptionEngine({
      addon,
      modelDir: "/m",
    }).createStream();
    push(stream);
    stream.abort();
    const before = calls.accepts;

    await stream.finish();

    expect(calls.accepts).toBe(before);
    expect(calls.inputFinished).toBe(false);
  });

  it("只建一次 recognizer，多条会话共用它", () => {
    // `createOnlineRecognizer` 会把上百 MB 的模型读进内存（实测 743ms）。
    // 它曾经被放在 createStream() 里 —— 而每条录音都会 createStream()，
    // 于是每按一次键都重付一次这个代价。引擎实例虽然被缓存了，但它的构造函数
    // 只存 options，缓存它等于没缓存。
    const { addon, calls } = fakeAddon({ partials: [], endpointsAt: [] });
    const engine = new LocalTranscriptionEngine({ addon, modelDir: "/m" });

    engine.createStream();
    engine.createStream();
    engine.createStream();

    expect(calls.recognizers).toBe(1);
    // 每条会话仍然要有自己独立的 stream：状态是跟着 stream 走的
    expect(calls.streams).toBe(3);
  });
});

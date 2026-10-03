import { describe, expect, it } from "vitest";
import { LocalTranscriptionEngine } from "../../main/voice/local-engine";
import {
  SAMPLE_RATE,
  type TranscribeUpdate,
} from "../../main/voice/transcription-engine";

/** 假 sherpa addon：记录收到的配置，按脚本吐结果。 */
function fakeAddon(script: { partials: string[]; endpointsAt: number[] }) {
  const calls = {
    config: null as unknown,
    accepts: 0,
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
    acceptWaveformOnline: () => {
      calls.accepts += 1;
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

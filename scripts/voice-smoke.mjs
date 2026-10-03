#!/usr/bin/env node
/**
 * 语音引擎冒烟测试：从指定目录加载运行时与模型，转写一个 WAV。
 *
 * 用法：
 *   node scripts/voice-smoke.mjs --runtime <runtime根> --model <模型目录> --wav <wav>
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import process from "node:process";

const args = new Map();
for (let i = 2; i < process.argv.length; ) {
  const key = process.argv[i].replace(/^--/, "");
  const next = process.argv[i + 1];
  const takesValue = next !== undefined && !next.startsWith("--");
  args.set(key, takesValue ? next : "1");
  i += takesValue ? 2 : 1;
}

const runtime = args.get("runtime");
const model = args.get("model");
const wav = args.get("wav");
if (!runtime || !model || !wav) {
  console.error("需要 --runtime <runtime根> --model <模型目录> --wav <wav>");
  process.exit(1);
}

const require = createRequire(import.meta.url);
const sherpa = require(`${runtime}/sherpa-onnx-node/sherpa-onnx.js`);
console.log(`引擎 ${sherpa.version}  onnxruntime ${sherpa.onnxruntimeVersion}`);

// BPE 词表的 zipformer2：modelType 与 bpeVocab 缺一不可，
// 少了就报 "Errors in config!"，而报错完全不提示是哪个字段。
const recognizer = new sherpa.OnlineRecognizer({
  featConfig: { sampleRate: 16000, featureDim: 80 },
  modelConfig: {
    transducer: {
      encoder: `${model}/encoder.int8.onnx`,
      decoder: `${model}/decoder.onnx`,
      joiner: `${model}/joiner.int8.onnx`,
    },
    tokens: `${model}/tokens.txt`,
    modelType: "zipformer2",
    bpeVocab: `${model}/bpe.model`,
    numThreads: 4,
    provider: "cpu",
  },
  decodingMethod: "greedy_search",
  enableEndpoint: true,
  rule1MinTrailingSilence: 2.4,
  rule2MinTrailingSilence: 1.2,
  rule3MinUtteranceLength: 20,
});

/** 扫 chunk 读 WAV，不假设 data 在偏移 44。 */
function readWav(path) {
  const buf = readFileSync(path);
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === "data") {
      const pcm = buf.subarray(off + 8, off + 8 + size);
      const n = Math.floor(pcm.length / 2);
      const samples = new Float32Array(n);
      for (let i = 0; i < n; i += 1)
        samples[i] = pcm.readInt16LE(i * 2) / 32768;
      return samples;
    }
    off += 8 + size + (size % 2);
  }
  throw new Error("WAV 里没有 data chunk");
}

const samples = readWav(wav);
const stream = recognizer.createStream();
const step = 1600; // 100ms
const t0 = Date.now();
for (let i = 0; i < samples.length; i += step) {
  stream.acceptWaveform({
    sampleRate: 16000,
    samples: samples.subarray(i, i + step),
  });
  while (recognizer.isReady(stream)) recognizer.decode(stream);
  if (recognizer.isEndpoint(stream)) recognizer.reset(stream);
}
stream.inputFinished();
while (recognizer.isReady(stream)) recognizer.decode(stream);

const seconds = samples.length / 16000;
const elapsed = Date.now() - t0;
console.log("文字：", recognizer.getResult(stream).text.trim() || "（空）");
console.log(
  `音频 ${seconds.toFixed(2)}s  解码 ${elapsed}ms  RTF ${(elapsed / (seconds * 1000)).toFixed(3)}`,
);

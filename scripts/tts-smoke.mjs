#!/usr/bin/env node
/**
 * 朗读引擎冒烟测试：从指定目录加载运行时与模型，合成一句话写成 wav。
 *
 * 为什么需要它：本地引擎是朗读一期**唯一**的通路，没有云端兜底。引擎在某个平台上
 * 加载不起来 = 这个功能在那台机器上完全不存在。所以三个平台各跑一次它是验收硬条件。
 *
 * 用法：
 *   npx electron scripts/tts-smoke.mjs --runtime <runtime根> --model <模型目录> [--text "…"]
 *   node scripts/tts-smoke.mjs …（同上参数）
 *
 * **以 Electron 那次为准。** 生产环境是 Electron；纯 Node 允许 V8 外部缓冲区，
 * 会掩掉一类只在 Electron 出现的失败（详见下面 enableExternalBuffer 处的注释）。
 */
import { createRequire } from "node:module";
import { join } from "node:path";
import process from "node:process";

const args = new Map();
for (let i = 2; i < process.argv.length; ) {
  const key = process.argv[i].replace(/^--/, "");
  const next = process.argv[i + 1];
  const takesValue = next !== undefined && !next.startsWith("--");
  args.set(key, takesValue ? next : "1");
  i += takesValue ? 2 : 1;
}

const runtimeRoot = args.get("runtime");
const modelDir = args.get("model");
if (!runtimeRoot || !modelDir) {
  console.error("usage: --runtime <dir> --model <dir> [--text …] [--out …]");
  process.exit(2);
}
const text = args.get("text") ?? "朗读冒烟测试，共 12 个字。";
const out = args.get("out") ?? "/tmp/tts-smoke.wav";

// 锚点用 process.cwd()：路径本身是绝对的，而 __filename / import.meta.url
// 各在一半运行环境里不存在。
const requireFromRuntime = createRequire(join(process.cwd(), "package.json"));
const sherpa = requireFromRuntime(
  join(runtimeRoot, "sherpa-onnx-node", "sherpa-onnx.js"),
);

const rss0 = process.memoryUsage().rss;
let started = Date.now();

const tts = new sherpa.OfflineTts({
  model: {
    vits: {
      model: join(modelDir, "model.onnx"),
      lexicon: join(modelDir, "lexicon.txt"),
      tokens: join(modelDir, "tokens.txt"),
      dictDir: modelDir,
    },
  },
  // ↓ 与 model 同级。放进 model.vits 里不报错、也不生效，
  //   那时 12 / 3.14 / 2026 会全走 OOV —— 读出来是断的。
  ruleFsts: ["date.fst", "number.fst", "phone.fst"]
    .map((name) => join(modelDir, name))
    .join(","),
  numThreads: 4,
  provider: "cpu",
});

const loadMs = Date.now() - started;
const rssLoaded = process.memoryUsage().rss;

started = Date.now();
const audio = tts.generate({
  text,
  sid: 0,
  speed: 1.0,
  // 与生产同形。默认 true 会让 addon 用 V8 外部缓冲区包住采样，Electron 不允许 ——
  // 同步报 `External buffers are not allowed`，异步报 `TTS settlement failed`。
  enableExternalBuffer: false,
});
const synthMs = Date.now() - started;
const seconds = audio.samples.length / audio.sampleRate;

let peak = 0;
for (const value of audio.samples) peak = Math.max(peak, Math.abs(value));
if (!Number.isFinite(peak) || peak === 0) {
  console.error(
    "FAIL: 输出全是静音或 NaN —— 检查三个 .fst 是否齐全、model.onnx 是否完整",
  );
  process.exit(1);
}

sherpa.writeWave(out, { samples: audio.samples, sampleRate: audio.sampleRate });

console.log(
  JSON.stringify(
    {
      ok: true,
      sampleRate: audio.sampleRate,
      speakers: tts.numSpeakers,
      loadMs,
      synthMs,
      audioSec: +seconds.toFixed(2),
      rtf: +(synthMs / 1000 / seconds).toFixed(3),
      peak: +peak.toFixed(3),
      rssDeltaMB: Math.round((rssLoaded - rss0) / 1048576),
      out,
    },
    null,
    2,
  ),
);

// Electron 下进程不会自己退出；Node 下显式 exit 反而可能截断管道里的 stdout。
if (process.versions.electron) process.exit(0);

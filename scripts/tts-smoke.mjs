#!/usr/bin/env node
/**
 * 朗读引擎冒烟测试：从指定目录加载运行时与模型，合成一句话写成 wav。
 *
 * 为什么需要它：本地引擎是朗读**唯一**的通路，没有云端兜底。引擎在某个平台上
 * 加载不起来 = 这个功能在那台机器上完全不存在。所以三个平台各跑一次它是验收硬条件。
 *
 * 用法：
 *   npx electron scripts/tts-smoke.mjs --variant zh_en --runtime <runtime根> --model <模型目录>
 *   npx electron scripts/tts-smoke.mjs --variant en    --runtime <runtime根> --model <英文模型目录>
 *   npx electron scripts/tts-smoke.mjs --variant both  --runtime <runtime根> \
 *       --model-zh <中文模型目录> --model-en <英文模型目录>
 *   （node 也能跑，参数相同）
 *
 * **以 Electron 那次为准。** 生产环境是 Electron；纯 Node 允许 V8 外部缓冲区，
 * 会掩掉一类只在 Electron 出现的失败（详见 src/main/tts/local-engine.ts 的注释）。
 *
 * **升级 RUNTIME_VERSION 前必须在 macOS 与 Windows 各重跑一次**：
 * `enableExternalBuffer` 靠 addon 透传给原生代码，版本一变可能被静默忽略，症状就是
 * Electron 下合成失败（见上）。老用户不会重装运行时，所以那次自检也不会重跑。
 *
 * **`both` 是两引擎共存的闸门**：中文与英文各一个 OfflineTts 常驻、按句交替调用。
 * addon 没有释放接口，两个引擎是设计的硬前提，所以它必须先跑通（实测基线：中文
 * ~1.6s / 英文 ~2.2s、稳态 ~750MB、无漂移）。
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

const USAGE =
  "usage: --runtime <dir> [--variant zh_en|en|both] --model <dir> | " +
  "--variant both --model-zh <dir> --model-en <dir> [--text …] [--out …]";

const runtimeRoot = args.get("runtime");
const variant = args.get("variant") ?? "zh_en";
if (!["zh_en", "en", "both"].includes(variant)) {
  console.error(`未知 variant: ${variant}\n${USAGE}`);
  process.exit(2);
}
// 单模型模式沿用 --model；both 要两个目录
const zhDir =
  args.get("model-zh") ?? (variant === "both" ? undefined : args.get("model"));
const enDir =
  args.get("model-en") ?? (variant === "both" ? undefined : args.get("model"));
const needsZh = variant !== "en";
const needsEn = variant !== "zh_en";
if (!runtimeRoot || (needsZh && !zhDir) || (needsEn && !enDir)) {
  console.error(USAGE);
  process.exit(2);
}

/** 英文分支刻意带数字：英文模型没有任何 .fst，数字会整段消失，必须端到端跑到。 */
const DEFAULT_TEXT = {
  zh_en: "朗读冒烟测试，共 12 个字。",
  en: "Smoke test for the English voice, with 12 words.",
};
const text =
  args.get("text") ?? DEFAULT_TEXT[variant === "en" ? "en" : "zh_en"];
const out = args.get("out") ?? "/tmp/tts-smoke.wav";

/** 失败提示按 variant 给，不然会把人指去查不存在的 .fst。 */
const SILENT_HINT =
  variant === "en"
    ? "检查英文模型目录（model.onnx / lexicon.txt / tokens.txt）与 enableExternalBuffer 是否为 false"
    : "检查三个 .fst 是否齐全、model.onnx 是否完整";

// 锚点用 process.cwd()：路径本身是绝对的，而 __filename / import.meta.url
// 各在一半运行环境里不存在。
const requireFromRuntime = createRequire(join(process.cwd(), "package.json"));
const sherpa = requireFromRuntime(
  join(runtimeRoot, "sherpa-onnx-node", "sherpa-onnx.js"),
);

const rssMB = () => Math.round(process.memoryUsage().rss / 1048576);
const peakOf = (samples) => {
  let peak = 0;
  for (const value of samples) peak = Math.max(peak, Math.abs(value));
  return peak;
};

/**
 * 与生产同形的配置。英文模型包里没有 dict/ 也没有任何 .fst（实测），
 * 带上它们会加载失败或静默失效。
 */
function configFor(kind, dir) {
  const vits = {
    model: join(dir, "model.onnx"),
    lexicon: join(dir, "lexicon.txt"),
    tokens: join(dir, "tokens.txt"),
  };
  const config = {
    model: { vits },
    numThreads: 4,
    provider: "cpu",
  };
  if (kind !== "en") {
    vits.dictDir = dir;
    // ↓ 与 model 同级。放进 model.vits 里不报错、也不生效，
    //   那时 12 / 3.14 / 2026 会全走 OOV —— 读出来是断的。
    config.ruleFsts = ["date.fst", "number.fst", "phone.fst"]
      .map((name) => join(dir, name))
      .join(",");
  }
  return config;
}

const gen = (tts, value, sid = 0) =>
  tts.generateAsync({
    text: value,
    sid,
    speed: 1.0,
    generationConfig: new sherpa.GenerationConfig({ sid, speed: 1.0 }),
    // 必须与生产同形：生产走的就是 generateAsync（同步版会让主进程事件循环停摆），
    // 而两条路的失败方式不同 —— 只测同步就漏得掉生产那一种。
    // enableExternalBuffer 同理：Electron 的 V8 不允许外部缓冲区。
    onProgress: () => {},
    enableExternalBuffer: false,
  });

function exitWith(code) {
  // Electron 下进程不会自己退出；Node 下显式 exit 反而可能截断管道里的 stdout。
  if (process.versions.electron) process.exit(code);
  if (code !== 0) process.exit(code);
}

async function runSingle() {
  const dir = variant === "en" ? enDir : zhDir;
  // 本脚本直接调引擎，**不经过**服务层的数字转写（src/main/tts/english-numbers.ts）。
  // 英文包没有 .fst，所以原文里的数字在这里必然走 OOV —— 别把它当成引擎坏了。
  if (variant === "en" && /\d/.test(text)) {
    console.error(
      "提示: 英文分支不经过数字转写。上面若出现 Ignore OOV，说明传进来的文本数字未被转写；" +
        "应用里走的是转写后的文本，端到端验证请对照 design-docs/manual-verification/。",
    );
  }
  const rss0 = process.memoryUsage().rss;
  let started = Date.now();

  const tts = new sherpa.OfflineTts(
    configFor(variant === "en" ? "en" : "zh_en", dir),
  );
  const loadMs = Date.now() - started;
  const rssLoaded = process.memoryUsage().rss;

  started = Date.now();
  const audio = await gen(tts, text);
  const synthMs = Date.now() - started;
  const seconds = audio.samples.length / audio.sampleRate;

  const peak = peakOf(audio.samples);
  if (!Number.isFinite(peak) || peak === 0) {
    console.error(`FAIL: 输出全是静音或 NaN —— ${SILENT_HINT}`);
    process.exit(1);
  }

  sherpa.writeWave(out, {
    samples: audio.samples,
    sampleRate: audio.sampleRate,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        variant,
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
}

/** 两引擎共存闸门：构造两个，然后 zh → en → zh → en … 交替 12 次。 */
async function runBoth() {
  const rss0 = rssMB();
  let started = Date.now();
  const zh = new sherpa.OfflineTts(configFor("zh_en", zhDir));
  const zhConstructMs = Date.now() - started;
  started = Date.now();
  const en = new sherpa.OfflineTts(configFor("en", enDir));
  const enConstructMs = Date.now() - started;

  const steps = [];
  let ok = true;
  for (let i = 0; i < 12; i++) {
    const useZh = i % 2 === 0;
    const tts = useZh ? zh : en;
    const value = DEFAULT_TEXT[useZh ? "zh_en" : "en"];
    const startedAt = Date.now();
    try {
      const audio = await gen(tts, value);
      const peak = peakOf(audio.samples);
      if (!(peak > 0)) ok = false;
      steps.push({
        i: i + 1,
        engine: useZh ? "zh" : "en",
        ms: Date.now() - startedAt,
        audioSec: +(audio.samples.length / audio.sampleRate).toFixed(2),
        peak: +peak.toFixed(3),
        rssMB: rssMB(),
      });
    } catch (error) {
      ok = false;
      steps.push({
        i: i + 1,
        engine: useZh ? "zh" : "en",
        error: String(error?.message ?? error),
      });
    }
  }

  const bothRssMB = rssMB();
  console.log(
    JSON.stringify(
      {
        ok,
        variant: "both",
        zhConstructMs,
        enConstructMs,
        rssStartMB: rss0,
        rssBothMB: bothRssMB,
        maxMs: Math.max(...steps.map((s) => s.ms ?? 0)),
        steps,
      },
      null,
      2,
    ),
  );
  exitWith(ok ? 0 : 1);
}

if (variant === "both") await runBoth();
else await runSingle();
exitWith(0);

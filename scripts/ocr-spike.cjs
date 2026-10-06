/**
 * 阶段① spike：证明 ppu-paddle-ocr 能在真实 Electron 主进程里跑起来。
 *
 * 一次性脚本，不进产品代码。用法（在仓库根目录）：
 *   node_modules/.bin/electron scripts/ocr-spike.cjs <任意含文字的图片>
 *
 * 它同时测两件事：
 *   1. 用库自带的 v6 tiny 预设跑通（证明环境可行）
 *   2. 用我们自己的 v6 small 三个文件跑通（证明显式路径这条路可行）
 */
const { app } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const SPIKE_DIR = "/tmp/ocr-spike";
const MODELS = path.join(SPIKE_DIR, "models");
const DICT = path.join(MODELS, "ppocrv6_dict.txt");

/** 从 PaddleOCR 的 inference.yml 里抽 PostProcess.character_dict。 */
function extractDict(ymlPath, outPath) {
  const lines = fs.readFileSync(ymlPath, "utf8").split("\n");
  const start = lines.findIndex((line) => line.trim() === "character_dict:");
  if (start < 0) throw new Error("character_dict not found");
  const chars = [];
  for (const line of lines.slice(start + 1)) {
    const match = /^ {2}- (.*)$/.exec(line);
    if (!match) break;
    let value = match[1];
    if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1).replace(/''/g, "'");
    }
    chars.push(value);
  }
  // 上游要求字典文件以换行结尾
  fs.writeFileSync(outPath, chars.join("\n") + "\n");
  return chars.length;
}

/** 主线程阻塞测量：心跳间隔被拉长的最大值。 */
function heartbeat() {
  let last = Date.now();
  let maxGapMs = 0;
  const timer = setInterval(() => {
    const now = Date.now();
    maxGapMs = Math.max(maxGapMs, now - last - 10);
    last = now;
  }, 10);
  return {
    stop: () => {
      clearInterval(timer);
      return maxGapMs;
    },
  };
}

async function main() {
  const image = process.argv[process.argv.length - 1];
  if (!image || !fs.existsSync(image)) {
    throw new Error("用法: electron scripts/ocr-spike.cjs <图片路径>");
  }
  const dictCount = extractDict(path.join(MODELS, "rec.yml"), DICT);
  console.log(`dict entries: ${dictCount}`);

  const t0 = Date.now();
  const mod = await import(
    pathToFileURL(path.join(SPIKE_DIR, "node_modules/ppu-paddle-ocr/index.js"))
      .href
  );
  const tImportMs = Date.now() - t0;

  const results = {};
  for (const [label, modelOptions] of [
    [
      "v6-small(explicit)",
      {
        detection: path.join(MODELS, "det.onnx"),
        recognition: path.join(MODELS, "rec.onnx"),
        charactersDictionary: DICT,
      },
    ],
    ["v6-tiny(preset)", undefined],
  ]) {
    const service = new mod.PaddleOcrService({
      ...(modelOptions ? { model: modelOptions } : {}),
      detection: { maxSideLength: 960 },
    });
    const tInit0 = Date.now();
    await service.initialize();
    const tInitMs = Date.now() - tInit0;

    const hb = heartbeat();
    const rssBefore = process.memoryUsage().rss;
    const tRec0 = Date.now();
    const result = await service.recognize(image);
    const tRecognizeMs = Date.now() - tRec0;
    const maxGapMs = hb.stop();
    const rssDeltaMb = Math.round(
      (process.memoryUsage().rss - rssBefore) / 1048576,
    );

    results[label] = {
      resultKeys: Object.keys(result),
      text: typeof result.text === "string" ? result.text.slice(0, 200) : null,
      linesLength: Array.isArray(result.lines) ? result.lines.length : null,
      sampleLine: Array.isArray(result.lines) ? result.lines[0] : null,
      tInitMs,
      tRecognizeMs,
      maxGapMs,
      rssDeltaMb,
    };
    await service.destroy();
  }

  console.log(JSON.stringify({ tImportMs, ...results }, null, 2));

  const cacheDir = path.join(app.getPath("home"), ".cache", "ppu-paddle-ocr");
  console.log("cache dir written:", fs.existsSync(cacheDir), cacheDir);
}

app
  .whenReady()
  .then(main)
  .then(() => app.exit(0))
  .catch((error) => {
    console.error("SPIKE FAILED:", error);
    app.exit(1);
  });

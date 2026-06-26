#!/usr/bin/env node
/**
 * image-ocr v2 — tesseract.js 本地 OCR
 *
 * 语言包（~30MB）首次使用时从 S3 自动下载到 ~/.deskwand/skills/image-ocr/models/
 * 之后离线可用。
 *
 * 用法:
 *   node ocr.js <image-path>                  # 中英混合识别
 *   node ocr.js <image-path> --lang=eng       # 仅英文
 *   node ocr.js <image-path> --json           # JSON 输出（含置信度）
 */

const path = require("path");
const fs = require("fs");
const os = require("os");
const https = require("https");
const { pipeline } = require("stream/promises");

// ─── 自动安装 tesseract.js（首次运行 / 包体积优化） ─────
// tesseract.js-core (WASM 引擎, ~43MB) 不再预装到安装包中。
// 首次 OCR 使用时自动 npm install 到用户本地缓存。
function ensureTesseract() {
  const CACHE_ROOT = path.join(os.homedir(), ".deskwand", "skill-deps", "image-ocr");
  const cacheNodeModules = path.join(CACHE_ROOT, "node_modules");

  try {
    return require("tesseract.js");
  } catch {
    // 模块缺失，自动安装
  }

  if (!fs.existsSync(cacheNodeModules)) {
    const { execSync } = require("child_process");
    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
    const pkgJson = path.join(CACHE_ROOT, "package.json");
    if (!fs.existsSync(pkgJson)) {
      fs.mkdirSync(CACHE_ROOT, { recursive: true });
      fs.writeFileSync(pkgJson, JSON.stringify({ private: true }));
    }
    process.stderr.write("[image-ocr] 首次使用，安装 OCR 引擎 (~43MB) ...\n");
    try {
      execSync(`${npmCmd} install tesseract.js`, {
        cwd: CACHE_ROOT,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 120000,
      });
      process.stderr.write("[image-ocr] 安装完成，开始识别 ...\n");
    } catch (e) {
      process.stderr.write(`[image-ocr] 安装失败: ${e.message}\n`);
      process.stderr.write("[image-ocr] 请检查网络连接后重试，或手动执行:\n");
      process.stderr.write(`[image-ocr]   cd "${CACHE_ROOT}" && npm install tesseract.js\n`);
      process.exit(2);
    }
  }

  // 将缓存目录加入 Node 模块搜索路径
  require.main.paths.unshift(cacheNodeModules);
  return require("tesseract.js");
}

const tesseract = ensureTesseract();
const { createWorker } = tesseract;
// ─── 自动安装结束 ────────────────────────────────────────

// ─── 配置 ───────────────────────────────────────────────
const MODELS = {
  chi_sim: "chi_sim.traineddata.gz",
  eng: "eng.traineddata.gz",
};

// S3 下载地址
const DOWNLOAD_BASE =
  "https://file.deskwand.com/skills/image-ocr/models";

// 本地缓存目录
const CACHE_DIR = path.join(os.homedir(), ".deskwand", "skills", "image-ocr", "models");

// 语言列表 → 文件名列表
const LANG_TO_FILES = {
  chi_sim: ["chi_sim.traineddata.gz"],
  eng: ["eng.traineddata.gz"],
  "chi_sim+eng": ["chi_sim.traineddata.gz", "eng.traineddata.gz"],
};

// ─── 下载 ───────────────────────────────────────────────
function httpGet(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { timeout: 30000 }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          https.get(res.headers.location, (r2) => {
            const chunks = [];
            r2.on("data", (c) => chunks.push(c));
            r2.on("end", () => resolve(Buffer.concat(chunks)));
            r2.on("error", reject);
          }).on("error", reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${url}`));
          return;
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      })
      .on("error", reject);
  });
}

async function ensureModels(models) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  for (const f of models) {
    const dest = path.join(CACHE_DIR, f);
    if (fs.existsSync(dest)) continue;

    const url = `${DOWNLOAD_BASE}/${f}`;
    process.stderr.write(`[image-ocr] 首次使用，下载语言包: ${f} ... `);
    try {
      const data = await httpGet(url);
      fs.writeFileSync(dest, data);
      process.stderr.write(`完成 (${(data.length / 1024 / 1024).toFixed(1)}MB)\n`);
    } catch (e) {
      process.stderr.write(`失败: ${e.message}\n`);
      process.stderr.write("[image-ocr] 语言包下载失败，请检查网络或 S3 配置\n");
      process.exit(2);
    }
  }
}

// ─── 主逻辑 ─────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);

  const imagePath = args.find((a) => !a.startsWith("--"));
  const jsonOut = args.includes("--json");
  const langArg = args.find((a) => a.startsWith("--lang="));
  const lang = langArg ? langArg.split("=")[1] : "chi_sim+eng";

  if (!imagePath) {
    process.stderr.write("用法: node ocr.js <image-path> [--lang chi_sim+eng] [--json]\n");
    process.exit(1);
  }

  if (!fs.existsSync(imagePath)) {
    process.stderr.write(`文件不存在: ${imagePath}\n`);
    process.exit(1);
  }

  // 自动下载缺失的语言包
  const needed = LANG_TO_FILES[lang];
  if (!needed) {
    process.stderr.write(`不支持的语言: ${lang}. 可选: chi_sim, eng, chi_sim+eng\n`);
    process.exit(1);
  }
  await ensureModels(needed);

  const worker = await createWorker(lang, 1, {
    langPath: CACHE_DIR,
    cachePath: CACHE_DIR,
  });

  const {
    data: { text, confidence },
  } = await worker.recognize(imagePath);
  await worker.terminate();

  // 去除中文字符间多余空格
  const cleaned = text.replace(
    /(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/g,
    ""
  );

  if (jsonOut) {
    process.stdout.write(JSON.stringify({ text: cleaned.trim(), confidence }) + "\n");
  } else {
    process.stdout.write(cleaned.trim() + "\n");
  }
}

main().catch((e) => {
  process.stderr.write(e.message + "\n");
  process.exit(1);
});

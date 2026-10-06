#!/usr/bin/env node
/**
 * 从 PaddleOCR 的 inference.yml 里抽 PostProcess.character_dict，写成字典文件。
 *
 * 为什么不用第三方镜像里的 dict：官方仓库的 inference.yml 自带这份字典，与模型同版本，
 * 少一个外部依赖。
 *
 * 两半分开：`extractCharacterDict` 是纯函数（可单测，fixture 不必是五位数），
 * 命令行壳子只负责读文件、查条数、写文件。
 *
 * 用法：node scripts/extract-ppocr-dict.mjs <inference.yml> <输出路径>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** 低于这个条数就当作解析失败：真字典是五位数，这不是可调参数。 */
const MIN_ENTRIES = 1000;

/** 从 yml 文本里取出字符表。找不到 character_dict 就抛。 */
export function extractCharacterDict(ymlText) {
  const lines = ymlText.split("\n");
  const start = lines.findIndex((line) => line.trim() === "character_dict:");
  if (start < 0) throw new Error("没找到 character_dict");

  const chars = [];
  for (const line of lines.slice(start + 1)) {
    // 缩进不写死：上游是 2 空格， prettier 格式化后是 4 空格，两种都要能读。
    // 遇到第一个非列表项就停（例如 `  use_space_char: true`）。
    const match = /^\s+- (.*)$/.exec(line);
    if (!match) break;
    let value = match[1];
    // YAML 单引号标量：外层引号去掉，内部的 '' 还原成一个 '
    if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1).replace(/''/g, "'");
    }
    chars.push(value);
  }
  return chars;
}

function main() {
  const [ymlPath, outPath] = process.argv.slice(2);
  if (!ymlPath || !outPath) {
    console.error("用法: extract-ppocr-dict.mjs <inference.yml> <输出路径>");
    process.exit(2);
  }

  const chars = extractCharacterDict(readFileSync(ymlPath, "utf8"));
  if (chars.length < MIN_ENTRIES) {
    console.error(`错误: 字典只有 ${chars.length} 项，疑似解析失败`);
    process.exit(1);
  }

  // 字典文件必须以换行结尾（ppu-paddle-ocr README 明确要求）
  writeFileSync(outPath, chars.join("\n") + "\n");
  console.log(`抽取 ${chars.length} 项 → ${outPath}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();

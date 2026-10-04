/**
 * @module main/tts/route
 *
 * 按文本选引擎。**纯函数，不认识模型**——模型是否装好用 service 那一层判。
 *
 * 判定式（设计 §4.1）：设 L = 片段里所有 Unicode 字母（\p{L}）。
 *   L ⊆ [A-Za-z] 且 |L| ≥ 2  →  "en"
 *   否则                      →  "zh"
 *
 * 为什么不能写成"拉丁字母数 ≥ 2"：那样 `运行 npm install 安装依赖`（10 个拉丁字母）
 * 会被判成英文，而英文模型读不了中文，整句中文会被丢掉——比口音更糟。
 *
 * 为什么用 \p{L}：这样假名、谚文、西里尔、希腊字母落到中文引擎。它们同样读不好
 * （中文引擎也会 OOV），但"误判成英文"是更差的失败。
 */
import type { TtsModelKey } from "../../shared/ipc-types";

/** 路由只会在朗读的两个模型里选：高速音色不参与路由（语音模式用 prefer 点它）。 */
const LATIN_LETTER = /^[A-Za-z]$/;

export function pickEngine(text: string): Extract<TtsModelKey, "zh" | "en"> {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length < 2) return "zh";
  return letters.every((ch) => LATIN_LETTER.test(ch)) ? "en" : "zh";
}

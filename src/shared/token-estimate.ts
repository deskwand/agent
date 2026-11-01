/**
 * 文本 token 的粗略估算。**估算，不是计量**：只用于分类占比，
 * 任何主数字仍然来自 provider 回报的精确用量。
 *
 * 放在 `shared/` 的原因：两侧都要用。渲染层用它把消息按块分到各个分类；
 * 主进程用它量系统提示词 / 工具声明 / 技能段落 —— 那三样文本只在 SDK 手里，
 * 渲染层看不到。两份实现会算出两个不一致的占比，所以只有这一份。
 */

/** CJK 区段：部首/统一表意、韩文音节、兼容表意、全角标点。 */
const CJK_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x2e80, 0x9fff],
  [0xac00, 0xd7af],
  [0xf900, 0xfaff],
  [0xff00, 0xffef],
];

function isCjk(code: number): boolean {
  return CJK_RANGES.some(([from, to]) => code >= from && code <= to);
}

/**
 * 粗估文本 token：CJK 约 1 token/字，ASCII 约 4 字符/token，其余 1 token/字符。
 *
 * 刻意逐 UTF-16 单元遍历而不是 `[...text]`：上下文动辄百万字符，
 * 展开成单字符数组本身就比估算更贵。
 */
export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let ascii = 0;
  let other = 0;
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) {
      ascii += 1;
      continue;
    }
    const code = text.codePointAt(i) ?? unit;
    if (code > 0xffff) i += 1; // 代理对：跳过低位，整对算 1 个字符
    if (isCjk(code)) cjk += 1;
    else other += 1;
  }
  return Math.ceil(cjk + ascii / 4 + other);
}

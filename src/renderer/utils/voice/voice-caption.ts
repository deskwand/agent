/**
 * @module renderer/utils/voice/voice-caption
 *
 * 语音浮层文字区的两个纯函数。浮层用纯文本显示回答（`whitespace-pre-wrap`），
 * 不做 markdown 渲染 —— 理由与取舍见
 * `design-docs/2026-10-06-voice-caption-text-design.md` §2.4。
 *
 * 抽成纯函数是为了能单测：`VoiceModeOverlay` 一挂载就开麦、起朗读，
 * 组件测试必须把整条语音链路 mock 掉。
 */

/** 滚动区离底多少像素以内算「贴底」。 */
const BOTTOM_EPSILON_PX = 24;

/**
 * 去掉 markdown 标记，只动**配对**的记号。
 *
 * 保守是刻意的：模型会在同一段里同时写正文和代码，而这里不做语法分析，只能靠
 * 局部判据区分。三处都是实测踩过的坑：
 * - 围栏里的内容一个字符都不动（`# 注释`、`__init__` 都在这里）
 * - `**` 只在「左边界干净」时才算强调，否则幂运算与 glob 路径里的双星号会被吃掉
 * - `__` 的内容是纯标识符时不动，否则 `__init__` 变 `init`
 */
export function stripVoiceMarkers(text: string): string {
  const out: string[] = [];
  let inFence = false;
  for (const line of text.split("\n")) {
    // 围栏行本身删掉，其余原样透传 —— 未闭合的围栏（模型还在写）一直透传到结尾。
    if (/^[ \t]*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    out.push(inFence ? line : stripInlineMarkers(line));
  }
  return out.join("\n");
}

/** 单行内的标记。围栏之外才走这里。 */
function stripInlineMarkers(line: string): string {
  return (
    line
      // 行首标题号与引用号
      .replace(/^[ \t]*#{1,6}[ \t]+/, "")
      .replace(/^[ \t]*>[ \t]?/, "")
      // 强调：开标记前面不能是词字符或斜杠（挡幂运算与 glob），闭标记后面不能
      // 紧跟词字符（中文字符不算词字符，所以「这是**重点**内容」照常生效）
      .replace(/(^|[^\w/])\*\*(?=\S)([^*\n]*?[^\s*])\*\*(?!\w)/g, "$1$2")
      // 双下划线：内容是纯标识符就不动（挡 `__init__`、`__dict__`）
      .replace(/__([^_\n]+)__/g, (match, inner: string) =>
        /^\w+$/.test(inner) ? match : inner,
      )
      .replace(/~~([^~\n]+)~~/g, "$1")
      // 行内代码
      .replace(/`([^`\n]+)`/g, "$1")
  );
}

/**
 * 滚动区是否贴着底部。用来决定要不要跟随新文字：
 * 用户上翻过（离底超过阈值）就不再跟随，免得把正在读的人拽走。
 */
export function isNearBottom(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  threshold = BOTTOM_EPSILON_PX,
): boolean {
  return scrollHeight - scrollTop - clientHeight <= threshold;
}

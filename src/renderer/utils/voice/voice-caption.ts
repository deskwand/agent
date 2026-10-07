/**
 * @module renderer/utils/voice/voice-caption
 *
 * 语音浮层文字区的两个纯函数：`voiceCaptionLine` 决定显示什么，
 * `stripVoiceMarkers` 负责去掉 markdown 标记（浮层用纯文本显示回答，
 * 不做 markdown 渲染 —— 理由与取舍见
 * `design-docs/2026-10-06-voice-caption-text-design.md` §2.4）。
 *
 * 抽成纯函数是为了能单测：`VoiceModeOverlay` 一挂载就开麦、起朗读，
 * 组件测试必须把整条语音链路 mock 掉。
 */

import type { VoiceModeView } from "../../hooks/useVoiceMode";

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
 * 浮层那一行显示什么。**规则只在这里定义**：全屏浮层与后台小球共用它，
 * 「两个视图是同一个会话的两种呈现」才不会两边改跑偏。
 *
 * `spoken` 是**正在念的那个合成单元**（`speech.onSentence` 给的）——
 * **不是一句**：朗读层首句单发，之后每 `GROUP_SENTENCES`（4）句并成一次请求
 * （`useStreamingSpeech` 的 `addSentence`），`onSentence` 只在单元开始播时触发一次。
 * 所以这一行可能是一串几句连在一起、在整段播放期间不动的文字，最长可到一两百字。
 * 这是拿音色一致换来的（每句一次请求时约 14% 的边界会跳音区），不要在字幕层
 * 用时长去猜句界——猜出来的边界只会和声音对不上。
 *
 * 念完不立刻清，留到下一轮开始：听的人还能回看一眼最后说了什么；清空在
 * `useVoiceMode` 的 `onQuestion`。
 *
 * 回落到 `answer` 不是兜底而是必须：整轮无可朗读文本时（纯代码块回答）
 * `onSentence` 一次都不触发，没这条回落那一行会整轮空着。
 *
 * 去标记只走回答侧：转写是用户自己说的话，原样显示。
 */
export function voiceCaptionLine(
  view: Pick<VoiceModeView, "state" | "transcript" | "answer" | "spoken">,
): string {
  if (view.state === "capturing") return view.transcript;
  const spoken = stripVoiceMarkers(view.spoken);
  if (spoken.trim() !== "") return spoken;
  const answer = stripVoiceMarkers(view.answer);
  if (answer.trim() !== "") return answer;
  return view.transcript;
}

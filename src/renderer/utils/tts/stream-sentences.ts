/**
 * @module renderer/utils/tts/stream-sentences
 *
 * 把模型**还在生成的**累积文本切成"可以拿去合成的完整句"。
 *
 * 与 speech-text.ts 的分工：那个从渲染好的 DOM 抽句子（要高亮，只能在渲染层）；
 * 这个只吃纯文本、不看 DOM，所以能在流式过程中用。
 *
 * 为什么按字符位置而不是句子序号记账：剔除代码块会让文本长度变化，
 * 序号会错位；而「剔除后的文本」对同一份前缀是单调扩展的，位置才稳。
 */
import { HARD_END, splitSentences } from "./speech-text";

export interface SentenceStream {
  /** 喂入**累积全文**，返回这次新切出的完整句。 */
  push(fullText: string): string[];
  /** 生成结束：把没写完的尾巴也交出来。幂等。 */
  flush(): string[];
}

/** 去掉围栏代码块、行内代码标记、强调标记与行首标题号。 */
function cleanMarkdown(text: string): string {
  return (
    text
      // 围栏代码块：未闭合时吃到结尾，闭合后整块消失
      .replace(/```[\s\S]*?(?:```|$)/g, "")
      // 行首标题号
      .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
      // 强调标记与行内代码标记
      .replace(/[*_`~]/g, "")
  );
}

export function createSentenceStream(): SentenceStream {
  let consumed = 0;
  let lastClean = "";

  const cut = (fullText: string, final: boolean): string[] => {
    const clean = cleanMarkdown(fullText);
    lastClean = clean;
    const slices = splitSentences(clean);
    const out: string[] = [];
    for (let i = 0; i < slices.length; i += 1) {
      const slice = slices[i];
      if (slice.end <= consumed) continue;
      const isLast = i === slices.length - 1;
      const trimmed = slice.text.trim();
      // 尾句没写完就先留着；除非它已经以句末标点收尾
      if (isLast && !final && !HARD_END.has(trimmed.slice(-1))) break;
      if (trimmed.length > 0) out.push(trimmed);
      consumed = slice.end;
    }
    return out;
  };

  return {
    push(fullText) {
      return cut(fullText, false);
    },
    flush() {
      return cut(lastClean, true);
    },
  };
}

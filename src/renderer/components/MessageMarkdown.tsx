import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import rehypeKatex from "rehype-katex";

// Hoisted to module scope to avoid re-creating arrays on every render
const REMARK_PLUGINS = [
  remarkMath,
  [remarkGfm, { singleTilde: false }],
] as const;
// Sanitize user-authored HTML before KaTeX expands math nodes. Running
// rehypeSanitize after rehypeKatex strips the generated KaTeX markup/classes.
const REHYPE_PLUGINS = [
  rehypeSanitize,
  [rehypeKatex, { throwOnError: false, strict: false }],
] as const;

export interface MessageMarkdownProps {
  normalizedText: string;
  components?: Record<string, unknown>;
  /**
   * 用户气泡开启：单个换行渲染成硬换行（等价 remark-breaks），口述枚举
   * （`…不变。2. 音量…`）也补行首换行。助手正文不开 —— 沿用 CommonMark。
   */
  breaks?: boolean;
}

export const MessageMarkdown = memo(function MessageMarkdown({
  normalizedText,
  components,
  breaks,
}: MessageMarkdownProps) {
  const remarkPlugins = useMemo(
    () => (breaks ? [...REMARK_PLUGINS, remarkUserLines] : REMARK_PLUGINS),
    [breaks],
  );
  return (
    <div className="prose-chat max-w-full text-foreground">
      <ReactMarkdown
        remarkPlugins={
          remarkPlugins as unknown as Parameters<
            typeof ReactMarkdown
          >[0]["remarkPlugins"]
        }
        rehypePlugins={
          REHYPE_PLUGINS as unknown as Parameters<
            typeof ReactMarkdown
          >[0]["rehypePlugins"]
        }
        components={components}
      >
        {normalizedText}
      </ReactMarkdown>
    </div>
  );
});

type MdastNode = { type: string; value?: string; children?: MdastNode[] };

/**
 * 单个换行 → 硬换行，等价 remark-breaks（二十行，不引依赖）。
 *
 * 为什么必须开：markdown 默认「一个换行 = 一个空格」，用户 Shift+Enter 打的换行
 * 会被拼回一段 —— 那正是本次要修的症状。代码块（`type: "code"`）只有 `value`
 * 没有 `children`，天然不动。
 */
export function remarkUserLines() {
  return (tree: MdastNode): void => {
    rewrite(tree);
  };
}

/** 口述枚举的行内标记；`(?!\d)` 挡掉 `1.5 倍` 这种小数。 */
const INLINE_ENUM =
  /(?<=[。，；;：:！!？?）)]|[ \t])(\d{1,2})[.、)](?!\d)[ \t]?/g;

function rewrite(node: MdastNode): void {
  if (!node.children) return;
  const next: MdastNode[] = [];
  for (const child of node.children) {
    if (child.type === "text" && typeof child.value === "string") {
      next.push(...splitText(child.value));
      continue;
    }
    // `code` / `inlineCode` 只有 value 没有 children，天然免疫
    rewrite(child);
    next.push(child);
  }
  node.children = next;
}

function splitText(value: string): MdastNode[] {
  const cuts = new Set(enumerationCuts(value));
  const out: MdastNode[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer) out.push({ type: "text", value: buffer });
    buffer = "";
  };
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "\n") {
      flush();
      out.push({ type: "break" });
      continue;
    }
    if (cuts.has(index)) {
      flush();
      out.push({ type: "break" });
    }
    buffer += char;
  }
  flush();
  return out;
}

/**
 * 合格枚举的切点位置。
 *
 * 只认「从 1 开始、连续递增、至少两项」的那一串：`第 1、2、3 点` 与 `见 9. 七 和 10.
 * 八` 这类正文不动。段落开头（前面只有空白）的标记也不切 —— 那是 chip 后面紧跟
 * `1.` 的情形，切了会把 chip 单独留在第一行。
 */
function enumerationCuts(value: string): number[] {
  const markers: Array<{ index: number; num: number }> = [];
  const pattern = new RegExp(INLINE_ENUM.source, "g");
  for (const match of value.matchAll(pattern)) {
    if (match.index === undefined) continue;
    if (value.slice(0, match.index).trim() === "") continue;
    markers.push({ index: match.index, num: Number(match[1]) });
  }

  const cuts: number[] = [];
  let run: Array<{ index: number; num: number }> = [];
  const keepRun = () => {
    if (run.length >= 2 && run[0].num === 1) {
      for (const marker of run) cuts.push(marker.index);
    }
    run = [];
  };
  for (const marker of markers) {
    const prev = run[run.length - 1];
    if (prev && marker.num !== prev.num + 1) keepRun();
    run.push(marker);
  }
  keepRun();
  return cuts;
}

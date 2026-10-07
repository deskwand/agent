/**
 * @module renderer/utils/tts/speech-text
 *
 * 把**已经渲染出来的**消息 DOM 变成「要读的句子」。
 *
 * 为什么不碰 markdown 管线：高亮必须落在真实 DOM 节点上，而 DOM 只在渲染层；
 * 放主进程再回传索引等于把同一份信息维护两遍。这里只读 DOM，不改 markdown。
 *
 * 纯函数（除了读 DOM），所以能直接用 jsdom 测。
 */

export interface SentenceSlice {
  text: string;
  /** 在入参字符串里的偏移，半开区间 [start, end)。 */
  start: number;
  end: number;
}

export type SpeechTarget =
  | {
      kind: "range";
      startNode: Text;
      startOffset: number;
      endNode: Text;
      endOffset: number;
    }
  | { kind: "block"; element: Element };

export interface SpeechSegment {
  text: string;
  target: SpeechTarget;
}

/** 句末标点。分号算句末 —— 长列表读起来更顺，也更容易跟读。 */
export const HARD_END = new Set(["。", "！", "？", "；", "!", "?", ";", "…"]);

/**
 * 常见缩写：句点后面即使跟空白也不切。
 *
 * 为什么必须有：`e.g.` 有两个句点，第一个后面是字母不切，**第二个后面是空白** ——
 * 没有这张表就会切出「Use e.g.」+「this one.」（实测）。
 * 清单短是故意的：长了没人维护，而漏切的代价只是句子长一点。
 */
const ABBREVIATIONS = [
  "e.g.",
  "i.e.",
  "etc.",
  "vs.",
  "Mr.",
  "Mrs.",
  "Dr.",
  "Fig.",
  "No.",
];

/** 这些元素整体跳过：念出来没有意义。 */
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "SVG", "CANVAS"]);

/** 块级边界：句子不跨块，这样高亮不会横跨两个段落。 */
const BLOCK_TAGS = new Set([
  "P",
  "DIV",
  "LI",
  "UL",
  "OL",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "BLOCKQUOTE",
  "SECTION",
  "ARTICLE",
  "TR",
  "TBODY",
  "THEAD",
]);

/**
 * 切句。四处保护都是实测会遇到的：
 * - 小数与版本号（`3.14`、`v1.0`）：句点后不是空白，不切
 * - 英文缩写（`e.g.` / `etc.`）：查 ABBREVIATIONS 表（它的**第二个**句点后面是空白）
 * - 连续标点（`？！`、`……`）：一起归给前句
 * - 跳过元素（KaTeX）会在缓冲区里留下双空格：口播文本合并空白，但**范围用原始的**
 */
export function splitSentences(text: string): SentenceSlice[] {
  const out: SentenceSlice[] = [];
  let start = 0;

  const push = (endExclusive: number) => {
    const raw = text.slice(start, endExclusive);
    const trimmed = raw.trim();
    if (trimmed) {
      const leading = raw.length - raw.trimStart().length;
      out.push({
        // 口播文本合并空白；start / end 仍指向原始字符串，高亮不会偏
        text: trimmed.replace(/\s+/g, " "),
        start: start + leading,
        end: start + leading + trimmed.length,
      });
    }
    start = endExclusive;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (HARD_END.has(ch)) {
      let j = i + 1;
      while (j < text.length && HARD_END.has(text[j])) j++;
      i = j - 1;
      push(j);
    } else if (ch === ".") {
      const prev = text[i - 1] ?? "";
      const next = text[i + 1] ?? "";
      const atEnd = next === "" || /\s/.test(next);
      const tail = text.slice(Math.max(0, i - 6), i + 1).toLowerCase();
      const isAbbreviation = ABBREVIATIONS.some((a) => tail.endsWith(a));
      if (atEnd && !/\d/.test(prev) && !isAbbreviation) push(i + 1);
    } else if (ch === "\n") {
      push(i);
    }
  }
  push(text.length);
  return out;
}

interface Span {
  node: Text;
  start: number;
  end: number;
}

/** 在一段连续文本里，把 [start, end) 映射回 DOM 文本节点。 */
function toRangeTarget(
  spans: Span[],
  start: number,
  end: number,
): SpeechTarget | null {
  const first = spans.find((s) => start >= s.start && start < s.end);
  const last = [...spans].reverse().find((s) => end > s.start && end <= s.end);
  if (!first || !last) return null;
  return {
    kind: "range",
    startNode: first.node,
    startOffset: start - first.start,
    endNode: last.node,
    endOffset: end - last.start,
  };
}

export function extractSpeechSegments(root: HTMLElement): SpeechSegment[] {
  const segments: SpeechSegment[] = [];
  let buffer = "";
  let spans: Span[] = [];

  const flush = () => {
    if (!buffer) return;
    for (const slice of splitSentences(buffer)) {
      const target = toRangeTarget(spans, slice.start, slice.end);
      // 映射不上就退回整段高亮（§2.5 的兜底），而不是丢掉这句话
      segments.push({
        text: slice.text,
        target: target ?? { kind: "block", element: root },
      });
    }
    buffer = "";
    spans = [];
  };

  const appendText = (node: Text) => {
    spans.push({
      node,
      start: buffer.length,
      end: buffer.length + (node.textContent?.length ?? 0),
    });
    buffer += node.textContent ?? "";
  };

  const emitBlock = (text: string, element: Element) => {
    flush();
    if (text.trim())
      segments.push({ text: text.trim(), target: { kind: "block", element } });
  };

  const emitTable = (table: HTMLTableElement) => {
    flush();
    const headerCells = Array.from(table.querySelectorAll("thead th"));
    const headers = headerCells.map((c) => c.textContent?.trim() ?? "");
    const rows = Array.from(table.querySelectorAll("tbody tr"));
    segments.push({
      text: `表格，${rows.length} 行 ${headers.length} 列`,
      target: { kind: "block", element: table },
    });
    for (const row of rows) {
      const cells = Array.from(row.querySelectorAll("td"));
      const parts = cells.map((cell, index) => {
        const value = cell.textContent?.trim() ?? "";
        return `${headers[index] ?? `第 ${index + 1} 列`}：${value || "空"}`;
      });
      segments.push({
        text: parts.join("，"),
        target: { kind: "block", element: row },
      });
    }
  };

  const walk = (element: Element) => {
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        appendText(child as Text);
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;

      const el = child as Element;
      if (SKIP_TAGS.has(el.tagName)) continue;
      // KaTeX 生成的标记念出来是符号串，跳过
      if (el.classList.contains("katex")) continue;
      if (el.tagName === "PRE") {
        const lines = (el.textContent ?? "")
          .trim()
          .split("\n")
          .filter(Boolean).length;
        // 空代码块不报 —— 「代码块，共 0 行」听着像故障
        if (lines > 0) emitBlock(`代码块，共 ${lines} 行`, el);
        continue;
      }
      if (el.tagName === "TABLE") {
        emitTable(el as HTMLTableElement);
        continue;
      }
      if (el.tagName === "IMG") {
        const alt = el.getAttribute("alt") ?? "";
        if (alt.trim()) emitBlock(alt, el);
        continue;
      }

      const isBlock = BLOCK_TAGS.has(el.tagName);
      if (isBlock) flush();
      walk(el);
      if (isBlock) flush();
    }
  };

  walk(root);
  flush();
  return segments;
}

/**
 * 把多段文字拼成一次合成用的文本。**规则只在这里定义**：英文句子之间补空格，
 * 中文不补（中文补空格会在合成里多出停顿）。
 */
export function joinSpeechTexts(parts: readonly string[]): string {
  return parts.reduce((acc, next) =>
    /[A-Za-z0-9]$/.test(acc) && /^[A-Za-z0-9]/.test(next)
      ? `${acc} ${next}`
      : acc + next,
  );
}

/** 整条消息的高亮目标：range 两端相接；block 类型退回第一条（跨块合并意义不大）。 */
export function spanSpeechTargets(
  targets: readonly SpeechTarget[],
): SpeechTarget | undefined {
  const first = targets[0];
  const last = targets[targets.length - 1];
  if (first?.kind === "range" && last?.kind === "range") {
    return {
      kind: "range",
      startNode: first.startNode,
      startOffset: first.startOffset,
      endNode: last.endNode,
      endOffset: last.endOffset,
    };
  }
  return first;
}

/**
 * 宿主合成的上下文块（浏览器元素拾取）不是用户敲的字，不进任何展示路径。
 * 抽成函数是为了能单测：`MessageCard` 里 `lastTextBlockIndex`、`getCopyContent`、
 * `buildToolDisplayBlocks` 全都从 `visibleBlocks` 派生，过滤点错一个位置就会
 * 导致 XML 出现在气泡里、或者用户自己那句话反而不显示。
 */
import type { ContentBlock } from "../types";

export function stripSyntheticBlocks(blocks: ContentBlock[]): ContentBlock[] {
  return blocks.filter(
    (block) => !(block.type === "text" && block.synthetic === true),
  );
}

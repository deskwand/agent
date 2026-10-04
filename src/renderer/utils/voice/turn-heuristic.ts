/**
 * @module renderer/utils/voice/turn-heuristic
 *
 * 「这句说完了吗」——用 ASR partial 的句末标点判定。
 *
 * 它取代了固定静音阈值当判据：那个旋钮在"停顿被切"（阈值太小）与"响应太慢"
 * （阈值太大）之间只能二选一，两个症状同时出现就说明它没有正确位置。
 *
 * 成立的前提是标点随 partial 增量吐出 —— 由 `partial-punctuation.manual.test.ts`
 * 验证。若标点只在 endpoint 才出现，这个模块作废，改用语义轮次模型。
 *
 * **不代替硬上限**：判"没说完"时会一直等，硬上限（`silenceMs`）负责收尾。
 */

/**
 * 句末：这些出现即认为这一轮结束了。
 *
 * **只有真正的句末标点**。分号、逗号、冒号故意不在列：它们本身就是"还有下文"
 * 的信号，拿它们当句末就是把用户从半句话里切掉 —— 也就是要治的那个症状。
 * 省略号同理：它连 `FINAL` 都不需要进，因为 `…` 与 `.` 都不在里面。
 */
const FINAL = /[。！？!?]$/;

export function isTurnComplete(partial: string): boolean {
  const text = partial.trim();
  if (text.length === 0) return false;
  return FINAL.test(text);
}

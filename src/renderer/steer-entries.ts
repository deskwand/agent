import type { SteerRecord } from "./types";

/** 消息流条目（visibleTurnEntries 的元素），含 message.timestamp 用于时序合并。 */
export type MessageTimelineEntry = { message: { timestamp: number } };

/**
 * 将引导记录按时间戳合并进消息流时间轴（时序一致渲染）。
 * steerRecords 独立于 messages store，不进 LLM 历史；此处仅做 UI 层合并。
 * ts 相同时 message 在前、记录在后（Array.sort 稳定）。
 */
export function mergeSteerEntries<E extends MessageTimelineEntry>(
  entries: E[],
  records: SteerRecord[],
): Array<E | SteerRecord> {
  return [...entries, ...records].sort((left, right) => {
    const leftTs = "message" in left ? left.message.timestamp : left.ts;
    const rightTs = "message" in right ? right.message.timestamp : right.ts;
    return leftTs - rightTs;
  });
}

/**
 * 消费「跳到某张卡片」的请求（概览的后台任务行 → 对话区）。
 * 一次性语义：回调执行后立刻清空，避免重挂载时重复跳转。
 */
import { useEffect } from "react";
import { useAppStore } from "../store";

export function usePendingFocusToolCall(
  onFocus: (toolCallId: string) => void,
  enabled = true,
): void {
  const pendingToolCallId = useAppStore((s) => s.pendingFocusToolCallId);
  const clearPendingFocusToolCall = useAppStore(
    (s) => s.clearPendingFocusToolCall,
  );

  useEffect(() => {
    if (!enabled || !pendingToolCallId) return;
    onFocus(pendingToolCallId);
    clearPendingFocusToolCall();
  }, [enabled, pendingToolCallId, onFocus, clearPendingFocusToolCall]);
}

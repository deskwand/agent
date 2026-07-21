// MessageNavRail — 消息快速导航轨道
// 左侧刻度标记组，Apple Dock 渐进放大 + 悬停预览 + 点击跳转
// tick 视觉位置沿用均匀分布（保持稳定），但点击跳转通过 querySelector
// 定位到实际消息 DOM 元素，不受消息长度差异影响。

import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";
import type { Message, ContentBlock } from "../types";

// ── 类型 ──

export type PreviewResult =
  | { kind: "text"; value: string }
  | { kind: "thinking"; value: string }
  | { kind: "tool"; value: string }
  | { kind: "empty" };

export interface RailTickEntry {
  messageId: string;
  userPreview: string;
  assistantPreview: string | null;
}

export interface TickStyle {
  w: number;
  op: number;
  primary: boolean;
}

// ── 工具函数 ──

export function getTurnPreviewText(
  message: Message,
  maxLen = 100,
): PreviewResult {
  if (!Array.isArray(message.content)) return { kind: "empty" };

  const blocks = message.content;
  const isString = (v: unknown): v is string => typeof v === "string";

  // 1) 最后的 text 块
  const textBlocks = blocks.filter(
    (b): b is ContentBlock & { type: "text"; text: string } =>
      b.type === "text" && isString((b as { text?: unknown }).text),
  );
  if (textBlocks.length > 0) {
    const t = textBlocks[textBlocks.length - 1].text.trim();
    if (t)
      return {
        kind: "text",
        value: t.length > maxLen ? t.slice(0, maxLen) + "…" : t,
      };
  }

  // 2) 最后的 thinking 块
  const thinkBlocks = blocks.filter(
    (b): b is ContentBlock & { type: "thinking"; thinking: string } =>
      b.type === "thinking" && isString((b as { thinking?: unknown }).thinking),
  );
  if (thinkBlocks.length > 0) {
    const t = thinkBlocks[thinkBlocks.length - 1].thinking.trim();
    if (t)
      return {
        kind: "thinking",
        value: t.length > maxLen ? t.slice(0, maxLen) + "…" : t,
      };
  }

  // 3) 最后的 tool_use 块
  const toolBlocks = blocks.filter(
    (b): b is ContentBlock & { type: "tool_use"; name: string } =>
      b.type === "tool_use" && isString((b as { name?: unknown }).name),
  );
  if (toolBlocks.length > 0)
    return { kind: "tool", value: toolBlocks[toolBlocks.length - 1].name };

  return { kind: "empty" };
}

/**
 * 计算 tick 的固定 Y 偏移数组。
 * n 个 tick 以 gap 间距紧凑排列，整体垂直居中。
 * 当 rail 高度不足以放下全部 tick 时，压缩间距至最小 4px。
 */
export function getTickOffsets(
  railHeight: number,
  n: number,
  gap = 10,
): number[] {
  if (n === 0 || railHeight === 0) return [];
  if (n === 1) return [railHeight / 2];
  const needed = (n - 1) * gap;
  if (needed + 8 <= railHeight) {
    const top = (railHeight - needed) / 2;
    return Array.from({ length: n }, (_, i) => top + i * gap);
  }
  const compressed = Math.max(4, (railHeight - 8) / (n - 1));
  return Array.from({ length: n }, (_, i) => 4 + i * compressed);
}

/**
 * 根据鼠标 Y 坐标为每个 tick 计算 Dock 风格的宽度/透明度。
 * 距离越近越大越亮，maxDist 之外的 tick 保持最小值。
 */
export function getTickStyles(
  mouseY: number | null,
  offsets: number[],
  maxDist = 96,
  minW = 8,
  maxW = 28,
  minOp = 0.6,
  maxOp = 0.95,
): TickStyle[] {
  if (mouseY === null || offsets.length === 0) {
    return offsets.map(() => ({ w: minW, op: minOp, primary: false }));
  }
  let closestIdx = 0;
  let closestDist = Infinity;
  const styles: TickStyle[] = offsets.map((ty, i) => {
    const dist = Math.abs(mouseY - ty);
    if (dist < closestDist) {
      closestDist = dist;
      closestIdx = i;
    }
    const t = Math.max(0, 1 - dist / maxDist);
    return {
      w: minW + (maxW - minW) * t,
      op: minOp + (maxOp - minOp) * t,
      primary: false,
    };
  });
  if (styles[closestIdx]) {
    styles[closestIdx] = { ...styles[closestIdx], primary: true };
  }
  return styles;
}

// ── 常量 ──

const TICK_GAP = 10;
const HOT_ZONE_WIDTH = 64;
const HALF_ZONE = HOT_ZONE_WIDTH / 2;
const MAX_DIST = 96;
const MIN_W = 5;
const MAX_W = 28;
const MIN_OP = 0.3;
const MAX_OP = 0.95;

// ── TickMark ──

interface TickMarkProps {
  y: number;
  userPreview: string;
  assistantPreview: string | null;
  isActive: boolean;
  width: number;
  opacity: number;
  isPrimary: boolean;
  onClick: () => void;
}

const TickMark = memo(function TickMark({
  y,
  userPreview,
  assistantPreview,
  isActive,
  width,
  opacity,
  isPrimary,
  onClick,
}: TickMarkProps) {
  const bg =
    isActive || isPrimary
      ? "var(--color-text-primary)"
      : "var(--color-text-secondary)";

  const cardTop = y - (assistantPreview ? 28 : 14);

  return (
    <>
      {isPrimary && userPreview && (
        <div
          className="absolute z-30 bg-surface rounded-lg px-2.5 py-1.5 shadow-elevated text-xs w-[280px] max-h-[7.5rem] overflow-hidden pointer-events-none"
          style={{ left: HALF_ZONE + 26, top: cardTop }}
        >
          <div className="text-text-secondary whitespace-normal leading-relaxed">
            {userPreview}
          </div>
          {assistantPreview && (
            <div className="text-text-primary whitespace-normal leading-relaxed">
              {assistantPreview}
            </div>
          )}
        </div>
      )}

      <div
        role="button"
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className="absolute cursor-pointer rounded-full z-20"
        style={{
          left: HALF_ZONE,
          top: y,
          width,
          height: 3,
          backgroundColor: bg,
          opacity,
          transition:
            "width 120ms ease-out, opacity 120ms ease-out, background-color 120ms ease-out",
        }}
      />
    </>
  );
});

// ── MessageNavRail ──

interface MessageNavRailProps {
  ticks: RailTickEntry[];
  scrollContainerRef: React.RefObject<HTMLElement>;
}

export const MessageNavRail = memo(function MessageNavRail({
  ticks,
  scrollContainerRef,
}: MessageNavRailProps) {
  const railRef = useRef<HTMLDivElement>(null);
  const [railHeight, setRailHeight] = useState(0);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [mouseY, setMouseY] = useState<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    const update = () => setRailHeight(el.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  const n = ticks.length;

  const tickOffsets = useMemo(
    () => getTickOffsets(railHeight, n, TICK_GAP),
    [n, railHeight],
  );

  const tickStyles = useMemo(
    () =>
      getTickStyles(
        mouseY,
        tickOffsets,
        MAX_DIST,
        MIN_W,
        MAX_W,
        MIN_OP,
        MAX_OP,
      ),
    [mouseY, tickOffsets],
  );

  const primaryIdx = tickStyles.findIndex((s) => s.primary);

  const nRef = useRef(n);
  nRef.current = n;

  const updateActive = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || nRef.current === 0) return;
    const maxScroll = container.scrollHeight - container.clientHeight;
    const ratio = maxScroll > 0 ? container.scrollTop / maxScroll : 0;
    setActiveIndex(Math.round(ratio * (nRef.current - 1)));
  }, [scrollContainerRef]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    updateActive();
    const onScroll = () => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        updateActive();
      });
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", onScroll);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [updateActive]);

  const handleSelect = useCallback(
    (index: number) => {
      const container = scrollContainerRef.current;
      if (!container || n <= 1) return;
      const tick = ticks[index];
      if (!tick) return;
      container
        .querySelector(`[data-message-id="${tick.messageId}"]`)
        ?.scrollIntoView({ block: "start", behavior: "smooth" });
    },
    [scrollContainerRef, n, ticks],
  );

  if (n === 0) return null;

  return (
    <div
      ref={railRef}
      className="absolute top-0 bottom-0 z-10"
      style={{ left: -HALF_ZONE, width: HOT_ZONE_WIDTH }}
      aria-hidden="true"
      onMouseMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        setMouseY(e.clientY - rect.top);
      }}
      onMouseLeave={() => {
        setMouseY(null);
      }}
      onClick={() => {
        if (primaryIdx !== null) handleSelect(primaryIdx);
      }}
    >
      <div className="relative h-full">
        {ticks.map((tick, i) => (
          <TickMark
            key={tick.messageId}
            y={tickOffsets[i] ?? 0}
            width={tickStyles[i]?.w ?? MIN_W}
            opacity={tickStyles[i]?.op ?? MIN_OP}
            isPrimary={tickStyles[i]?.primary ?? false}
            userPreview={tick.userPreview}
            assistantPreview={tick.assistantPreview}
            isActive={activeIndex === i}
            onClick={() => handleSelect(i)}
          />
        ))}
      </div>
    </div>
  );
});

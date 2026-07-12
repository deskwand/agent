// MessageNavRail — 消息快速导航轨道
// 左侧刻度标记组，Apple Dock 渐进放大 + 悬停预览 + 点击跳转
// Tradeoff: tick 按 scroll 比例等距分布，不跟踪消息 DOM 实际位置。
// 优势是位置稳定；劣势是消息长度差异大时不对齐物理位置。v1 接受此 tradeoff。

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

// ── 工具函数 ──

export function getTurnPreviewText(message: Message, maxLen = 100): PreviewResult {
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
    if (t) return { kind: "text", value: t.length > maxLen ? t.slice(0, maxLen) + "…" : t };
  }

  // 2) 最后的 thinking 块
  const thinkBlocks = blocks.filter(
    (b): b is ContentBlock & { type: "thinking"; thinking: string } =>
      b.type === "thinking" && isString((b as { thinking?: unknown }).thinking),
  );
  if (thinkBlocks.length > 0) {
    const t = thinkBlocks[thinkBlocks.length - 1].thinking.trim();
    if (t) return { kind: "thinking", value: t.length > maxLen ? t.slice(0, maxLen) + "…" : t };
  }

  // 3) 最后的 tool_use 块
  const toolBlocks = blocks.filter(
    (b): b is ContentBlock & { type: "tool_use"; name: string } =>
      b.type === "tool_use" && isString((b as { name?: unknown }).name),
  );
  if (toolBlocks.length > 0) return { kind: "tool", value: toolBlocks[toolBlocks.length - 1].name };

  return { kind: "empty" };
}

// ── 常量 ──

const TICK_GAP = 10;
const HOT_ZONE_WIDTH = 48;
const MAX_DIST = 72;
const MIN_W = 6;
const MAX_W = 20;
const MIN_OP = 0.5;
const MAX_OP = 0.9;

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

  const cardTop = y - (assistantPreview ? 20 : 10);

  return (
    <>
      {isPrimary && userPreview && (
        <div
          className="absolute z-30 bg-surface/90 backdrop-blur-sm rounded-lg px-2.5 py-1.5 shadow-elevated text-xs w-[280px] max-h-[7.5rem] overflow-hidden pointer-events-none"
          style={{ left: 26, top: cardTop }}
        >
          <div className="text-text-secondary truncate">{userPreview}</div>
          {assistantPreview && (
            <div className="text-text-primary truncate">{assistantPreview}</div>
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
        className="absolute left-0 cursor-pointer rounded-full z-20"
        style={{
          top: y,
          width,
          height: 2,
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
  scrollContainerRef: React.RefObject<HTMLElement | null>;
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

  const tickOffsets = useMemo(() => {
    if (n === 0 || railHeight === 0) return [] as number[];
    if (n === 1) return [railHeight / 2];
    const needed = (n - 1) * TICK_GAP;
    if (needed + 8 <= railHeight) {
      const top = (railHeight - needed) / 2;
      return Array.from({ length: n }, (_, i) => top + i * TICK_GAP);
    }
    const compressed = Math.max(4, (railHeight - 8) / (n - 1));
    return Array.from({ length: n }, (_, i) => 4 + i * compressed);
  }, [n, railHeight]);

  const tickStyles = useMemo(() => {
    if (mouseY === null || tickOffsets.length === 0) {
      return tickOffsets.map(() => ({ w: MIN_W, op: MIN_OP, primary: false }));
    }
    let closestIdx = 0;
    let closestDist = Infinity;
    const styles = tickOffsets.map((ty, i) => {
      const dist = Math.abs(mouseY - ty);
      if (dist < closestDist) {
        closestDist = dist;
        closestIdx = i;
      }
      const t = Math.max(0, 1 - dist / MAX_DIST);
      return {
        w: MIN_W + (MAX_W - MIN_W) * t,
        op: MIN_OP + (MAX_OP - MIN_OP) * t,
        primary: false,
      };
    });
    if (styles[closestIdx]) {
      styles[closestIdx] = { ...styles[closestIdx], primary: true };
    }
    return styles;
  }, [mouseY, tickOffsets]);

  const primaryIdx = tickStyles.findIndex((s) => s.primary);

  const updateActive = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || n === 0) return;
    const maxScroll = container.scrollHeight - container.clientHeight;
    const ratio = maxScroll > 0 ? container.scrollTop / maxScroll : 0;
    setActiveIndex(Math.round(ratio * (n - 1)));
  }, [scrollContainerRef, n]);

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
      const ratio = index / (n - 1);
      const target = ratio * (container.scrollHeight - container.clientHeight);
      container.scrollTo({ top: target, behavior: "smooth" });
    },
    [scrollContainerRef, n],
  );

  if (n === 0) return null;

  return (
    <div
      ref={railRef}
      className="absolute left-0 top-0 bottom-0 z-10"
      aria-hidden="true"
    >
      <div
        className="absolute top-0 bottom-0 pointer-events-auto"
        style={{ left: -HOT_ZONE_WIDTH / 2, width: HOT_ZONE_WIDTH }}
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
      />

      <div className="absolute left-0 top-0 bottom-0 pointer-events-auto">
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

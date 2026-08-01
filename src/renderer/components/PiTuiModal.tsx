import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Convert from "ansi-to-html";
import { normalizeKeyEvent } from "../utils/key-normalizer";
import type { ServerEvent } from "../types";

const ansiConvert = new Convert({
  fg: "#d6d8e0",
  bg: "#0c0e12",
  newline: true,
  escapeXML: true, // 防注入：ansi-to-html 默认不转义文本中的 HTML
});

// 以下正则必须匹配 ANSI 控制字符；no-control-regex 对 RegExp 字面量与
// 字符串构造均报错，故显式豁免（ANSI 解析场景必需）。
// eslint-disable-next-line no-control-regex
const OSC_SEQ = new RegExp("\\x1b\\][^\\x07]*\\x07", "g"); // OSC（标题等）
// eslint-disable-next-line no-control-regex
const CSI_STRIP_SEQ = new RegExp("\\x1b\\[[0-9;?]*[A-HJ-Za-ln-z]", "g"); // 非 SGR 的 CSI（光标/清屏/同步标记）
// eslint-disable-next-line no-control-regex
const CARRIAGE_RETURN = /\r/g;

/** 剥离残余控制序列（保留 SGR 颜色供 ansi-to-html 上色）。 */
export function sanitizeAnsiChunk(chunk: string): string {
  return chunk
    .replace(OSC_SEQ, "")
    .replace(CSI_STRIP_SEQ, "")
    .replace(CARRIAGE_RETURN, "");
}

/** 等宽字符列数估算：12px 字体下 1 字符 ≈ 7.2px。 */
export function estimateColumns(widthPx: number): number {
  return Math.max(10, Math.floor(widthPx / 7.2));
}

export function estimateRows(heightPx: number): number {
  return Math.max(3, Math.floor(heightPx / 18));
}

interface TuiModalState {
  width: number;
  height: number;
  title?: string;
}

/**
 * Pi TUI Modal：居中显示扩展 custom()/widget 组件的 ANSI 渲染，
 * DOM 键盘事件归一化为终端序列回传主进程。
 */
export function PiTuiModal() {
  const { t } = useTranslation();
  const [modal, setModal] = useState<TuiModalState | null>(null);
  const [ansiText, setAnsiText] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pendingFrameRef = useRef<string | null>(null);

  // 帧批量刷新（16ms 节流，与主进程帧率一致）：替换语义，非追加
  useEffect(() => {
    if (!modal) return;
    const timer = setInterval(() => {
      if (pendingFrameRef.current !== null) {
        setAnsiText(sanitizeAnsiChunk(pendingFrameRef.current));
        pendingFrameRef.current = null;
      }
    }, 16);
    return () => clearInterval(timer);
  }, [modal]);

  useEffect(() => {
    return window.electronAPI.on((event: ServerEvent) => {
      if (event.type === "pi.tui.open") {
        setModal({
          width: event.payload.width,
          height: event.payload.height,
          title: event.payload.title,
        });
        setAnsiText("");
        pendingFrameRef.current = null;
      }
      if (event.type === "pi.tui.close") {
        setModal(null);
        setAnsiText("");
        pendingFrameRef.current = null;
      }
      if (event.type === "pi.tui.frame") {
        // 非 Modal 打开期间的帧（泄漏动画组件）直接丢弃
        if (modalRef.current) {
          pendingFrameRef.current = event.payload.chunk;
        }
      }
    });
  }, []);

  // 供事件回调读取当前 modal 状态（避免闭包过期）
  const modalRef = useRef(modal);
  modalRef.current = modal;

  const reportSize = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const cols = estimateColumns(el.clientWidth);
    const rows = estimateRows(el.clientHeight);
    window.electronAPI.piTui.resize(cols, rows);
  }, []);

  // 打开后与尺寸变化时上报 Modal 尺寸
  useEffect(() => {
    if (!modal) return;
    reportSize();
    const observer = new ResizeObserver(() => reportSize());
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [modal, reportSize]);

  if (!modal) return null;

  const onKeyDown = (event: React.KeyboardEvent) => {
    const seq = normalizeKeyEvent(event);
    if (seq) {
      event.preventDefault();
      window.electronAPI.piTui.input(seq);
    }
  };

  const html = ansiConvert.toHtml(ansiText);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="flex w-[min(720px,90vw)] flex-col overflow-hidden rounded-xl border border-border bg-[#0c0e12] shadow-2xl">
        <div className="flex items-center justify-between border-b border-border/50 px-4 py-2">
          <span className="text-xs text-muted-foreground">
            {modal.title ?? t("piExtensions.modalTitle")}
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">
            {modal.width}×{modal.height}
          </span>
        </div>
        <div
          ref={containerRef}
          tabIndex={0}
          className="h-[420px] overflow-hidden p-3 font-mono text-[12px] leading-[18px] text-[#d6d8e0] outline-none"
          onKeyDown={onKeyDown}
          onClick={(e) => e.currentTarget.focus()}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  );
}

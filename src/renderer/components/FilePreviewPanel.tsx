import { useState, useEffect, useCallback, useMemo, memo, useRef } from "react";
import { X, ExternalLink, FileCode, Loader2, Video } from "lucide-react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import rehypeKatex from "rehype-katex";
import hljs from "highlight.js";
import { List } from "react-window";
import type { ReadFileResult } from "../utils/file-preview";
import { getLangFromExt } from "../utils/file-preview";
import { getVideoPlaybackKind } from "../../shared/video-file";
import { useAppStore } from "../store";
import { VideoPlayer } from "./VideoPlayer";

// Re-export for external consumers
export type { ReadFileResult };

// Hoisted plugins (same pattern as MessageMarkdown)
const REMARK_PLUGINS = [
  remarkMath,
  [remarkGfm, { singleTilde: false }],
] as const;
const REHYPE_PLUGINS = [
  rehypeSanitize,
  [rehypeKatex, { throwOnError: false, strict: false }],
] as const;

// Sanitize highlight.js output — only allow highlight span tags
const sanitizeHighlight = (html: string): string =>
  html.replace(
    /<(?!\/?span(?:\s+class="hljs-[^"]*")?\s*\/?>)[^>]*>/g,
    (match) => match.replace(/</g, "&lt;").replace(/>/g, "&gt;"),
  );

// ── Virtual row renderer for react-window ────────────────────────
function CodeRow({
  index,
  style,
  lines,
  highlightedLines,
}: {
  index: number;
  style: React.CSSProperties;
  lines: string[];
  highlightedLines: (string | null)[];
}) {
  const html = highlightedLines[index];

  return (
    <div style={style} className="flex text-xs leading-5">
      <div className="text-right pr-3 select-none w-10 shrink-0 text-text-muted">
        {index + 1}
      </div>
      <div className="flex-1 overflow-hidden whitespace-pre">
        {html ? (
          <code dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <code>{lines[index]}</code>
        )}
      </div>
    </div>
  );
}

// ── Code preview sub-component ──────────────────────────────────
const CodePreview = memo(function CodePreview({
  content,
  ext,
}: {
  content: string;
  ext: string;
}) {
  const lang = getLangFromExt(ext);
  const containerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(400);

  const lines = useMemo(() => content.split("\n"), [content]);

  // Per-line highlight using full-text context (preserves cross-line syntax)
  const highlightedLines = useMemo(() => {
    try {
      let fullHtml: string;
      if (lang !== "plaintext" && hljs.getLanguage(lang)) {
        fullHtml = hljs.highlight(content, { language: lang }).value;
      } else {
        fullHtml = hljs.highlightAuto(content).value;
      }

      // Split highlighted HTML by line, reopening/closing spans per line
      const rawLines = fullHtml.split("\n");
      const result: (string | null)[] = [];
      const openTagClasses: string[] = [];

      for (const raw of rawLines) {
        const opens = (raw.match(/<span class="([^"]*)">/g) || []).map(
          (m) => m.match(/class="([^"]*)"/)![1],
        );
        const closeCount = (raw.match(/<\/span>/g) || []).length;

        let line = "";
        for (const cls of openTagClasses) {
          line += `<span class="${cls}">`;
        }
        line += raw;

        for (const cls of opens) openTagClasses.push(cls);
        for (let i = 0; i < closeCount; i++) {
          if (openTagClasses.length > 0) openTagClasses.pop();
        }
        for (let i = 0; i < openTagClasses.length; i++) {
          line += "</span>";
        }

        result.push(sanitizeHighlight(line));
      }
      return result;
    } catch {
      return lines.map(() => null);
    }
  }, [content, lines, lang]);

  // Measure container height
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setHeight(el.getBoundingClientRect().height);
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setHeight(entry.contentRect.height);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="flex-1 min-h-0 overflow-hidden">
      {height > 0 && (
        <List
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          rowComponent={({ index, style }: any) => (
            <CodeRow
              index={index}
              style={style}
              lines={lines}
              highlightedLines={highlightedLines}
            />
          )}
          rowCount={lines.length}
          rowHeight={20}
          rowProps={{} as Record<string, unknown>}
          style={{ height }}
        />
      )}
    </div>
  );
});

// ── Panel component ─────────────────────────────────────────────
// 无 props：标签、激活标签都由 store 决定；本组件只在 preview 模式下挂载。
export function FilePreviewPanel({ visible = true }: { visible?: boolean }) {
  const { t } = useTranslation();
  const previewTabs = useAppStore((s) => s.previewTabs);
  const activePreviewTab = useAppStore((s) => s.activePreviewTab);
  const openPreview = useAppStore((s) => s.openPreview);
  const closePreviewTab = useAppStore((s) => s.closePreviewTab);

  const tab =
    previewTabs.find((item) => item.path === activePreviewTab) ?? null;
  const filePath = tab?.path ?? "";
  const fileName = tab?.name ?? "";
  const [read, setRead] = useState<{
    path: string;
    result: ReadFileResult | null;
    loading: boolean;
  } | null>(null);
  const videoKind = getVideoPlaybackKind(fileName);
  const isVideo = videoKind !== "none";

  // 错误文案用当前语言，但不把 t 放进依赖：useTranslation 的 t 在某些用法下
  // 每次渲染都是新函数，进依赖会让「读文件」这个副作用反复重启。
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    if (!filePath) return;
    if (isVideo) {
      setRead({ path: filePath, result: null, loading: false });
      return;
    }
    let cancelled = false;
    setRead({ path: filePath, result: null, loading: true });

    (async () => {
      let next: ReadFileResult | null = null;
      try {
        if (window.electronAPI?.readFile) {
          next = await window.electronAPI.readFile(filePath);
        }
      } catch {
        next = {
          type: "error",
          message: tRef.current("filePreview.loadFailed"),
        };
      }
      if (!cancelled) {
        setRead({ path: filePath, result: next, loading: false });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [filePath, isVideo]);

  // 读出值与当前标签绑定：切标签后旧文件的读取结果立即失效，
  // 不会先拿上一个文件的内容闪一帧。
  const result = read?.path === filePath ? read.result : null;
  const loading = read?.path === filePath ? read.loading : !isVideo;

  const handleOpenExternal = useCallback(async () => {
    if (window.electronAPI?.openPath) {
      await window.electronAPI.openPath(filePath);
    }
  }, [filePath]);

  if (!tab) return null;

  const i = fileName.lastIndexOf(".");
  const ext = i > 0 ? fileName.slice(i).toLowerCase() : "";
  const isMarkdown = [".md", ".mdx", ".markdown"].includes(ext);

  return (
    <div className="flex h-full w-full min-w-0 flex-1 flex-col overflow-hidden border-l border-border bg-background">
      {/* Tab strip */}
      <div className="flex h-9 shrink-0 items-stretch gap-0.5 overflow-x-auto border-b border-border-muted bg-background px-2">
        {previewTabs.map((item) => {
          const isActive = item.path === activePreviewTab;
          // 标签只需按扩展名区分视频，避免为了选图标去读每个标签的文件。
          const TabIcon =
            getVideoPlaybackKind(item.name) !== "none" ? Video : FileCode;
          return (
            <div
              key={item.path}
              data-testid="preview-tab"
              data-active={String(isActive)}
              className={`group flex min-w-0 max-w-[180px] shrink-0 items-center gap-1 self-center rounded-lg pl-2 pr-1 py-1 transition-colors ${
                isActive
                  ? "bg-background-secondary text-text-primary"
                  : "text-text-secondary hover:bg-surface-hover"
              }`}
            >
              <TabIcon className="h-3.5 w-3.5 shrink-0" />
              <button
                type="button"
                onClick={() => openPreview(item)}
                title={item.path}
                className="min-w-0 flex-1 truncate text-left text-xs"
              >
                {item.name}
              </button>
              <button
                type="button"
                data-testid="preview-tab-close"
                aria-label={t("common.close")}
                onClick={() => closePreviewTab(item.path)}
                className={`shrink-0 rounded-md p-0.5 transition-colors hover:bg-surface-hover focus-visible:opacity-100 ${
                  isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                }`}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Path row */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border-muted px-3 py-1.5">
        <span
          className="min-w-0 flex-1 truncate text-xs text-text-muted"
          title={filePath}
        >
          {filePath}
        </span>
        <button
          type="button"
          onClick={handleOpenExternal}
          className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {t("filePreview.openExternal")}
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col overflow-hidden bg-background/70 p-4 min-h-0">
        {isVideo ? (
          <VideoPlayer
            filePath={filePath}
            fileName={fileName}
            showOpenExternal={false}
            autoPlay={tab.autoPlay ?? false}
            visible={visible}
          />
        ) : loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-text-muted mr-2" />
            <span className="text-sm text-text-muted">
              {t("filePreview.loading")}
            </span>
          </div>
        ) : !result ? null : result.type === "error" ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2">
            <span className="text-sm text-text-muted">{result.message}</span>
          </div>
        ) : result.type === "image" ? (
          <div className="flex-1 overflow-y-auto flex items-center justify-center min-h-[200px]">
            <img
              src={result.content}
              alt={fileName}
              className="max-w-full max-h-full object-contain rounded-lg"
            />
          </div>
        ) : isMarkdown ? (
          <div className="flex-1 overflow-y-auto">
            <div className="prose-chat text-text-primary">
              <ReactMarkdown
                remarkPlugins={
                  REMARK_PLUGINS as unknown as Parameters<
                    typeof ReactMarkdown
                  >[0]["remarkPlugins"]
                }
                rehypePlugins={
                  REHYPE_PLUGINS as unknown as Parameters<
                    typeof ReactMarkdown
                  >[0]["rehypePlugins"]
                }
              >
                {result.content}
              </ReactMarkdown>
            </div>
          </div>
        ) : (
          <CodePreview content={result.content} ext={ext} />
        )}
      </div>
    </div>
  );
}

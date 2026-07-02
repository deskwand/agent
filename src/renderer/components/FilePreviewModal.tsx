import { useState, useEffect, useCallback, useMemo, memo, useRef } from "react";
import { X, ExternalLink, FileCode, Image, Loader2 } from "lucide-react";
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

interface FilePreviewModalProps {
  isOpen: boolean;
  filePath: string;
  fileName: string;
  onClose: () => void;
}

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

// ── Modal component ─────────────────────────────────────────────
export function FilePreviewModal({
  isOpen,
  filePath,
  fileName,
  onClose,
}: FilePreviewModalProps) {
  const { t } = useTranslation();
  const [result, setResult] = useState<ReadFileResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    setResult(null);

    (async () => {
      try {
        if (window.electronAPI?.readFile) {
          const res = await window.electronAPI.readFile(filePath);
          if (!cancelled) setResult(res);
        }
      } catch {
        if (!cancelled)
          setResult({ type: "error", message: t("filePreview.loadFailed") });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, filePath, t]);

  const handleOpenExternal = useCallback(async () => {
    if (window.electronAPI?.openPath) {
      await window.electronAPI.openPath(filePath);
    }
  }, [filePath]);

  if (!isOpen) return null;

  const i = fileName.lastIndexOf(".");
  const ext = i > 0 ? fileName.slice(i).toLowerCase() : "";
  const isMarkdown = [".md", ".mdx", ".markdown"].includes(ext);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="mx-4 flex max-h-[88vh] w-full max-w-[960px] flex-col overflow-hidden rounded-6xl border border-border-subtle bg-background shadow-elevated">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-muted bg-background/88 px-6 py-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border-subtle bg-background-secondary/88 text-accent shrink-0">
              {result?.type === "image" ? (
                <Image className="h-5 w-5" />
              ) : (
                <FileCode className="h-5 w-5" />
              )}
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-text-primary truncate">
                {fileName}
              </h2>
              <p className="text-xs text-text-muted truncate">{filePath}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 transition-colors hover:bg-surface-hover shrink-0"
          >
            <X className="h-5 w-5 text-text-secondary" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 flex flex-col overflow-hidden bg-background/70 p-6">
          {loading ? (
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
                className="max-w-full max-h-[70vh] object-contain rounded-lg"
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

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-border-muted bg-background/88 px-6 py-3 shrink-0">
          <button
            type="button"
            onClick={handleOpenExternal}
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            {t("filePreview.openExternal")}
          </button>
        </div>
      </div>
    </div>
  );
}

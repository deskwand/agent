// Dispatches a single ContentBlock to the appropriate sub-renderer
import {
  Suspense,
  lazy,
  isValidElement,
  cloneElement,
  memo,
  useMemo,
  useCallback,
} from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store";
import { PanelErrorBoundary } from "../PanelErrorBoundary";
import {
  splitTextByFileMentions,
  splitChildrenByFileMentions,
  getFileLinkButtonClassName,
} from "../../utils/file-link";
import { resolvePathAgainstWorkspace } from "../../../shared/workspace-path";
import {
  normalizeLocalFileMarkdownLinks,
  resolveLocalFilePathFromHref,
} from "../../utils/markdown-local-link";
import { normalizeLatexDelimiters } from "../../utils/latex-delimiters";
import type {
  ToolUseContent,
  ToolResultContent,
  FileAttachmentContent,
  ImageContent,
} from "../../types";
import { FileText } from "lucide-react";
import { CodeBlock } from "./CodeBlock";
import { ThinkingBlock } from "./ThinkingBlock";
import { UserTextWithTokens } from "./UserTextWithTokens";
import { ToolUseBlock } from "./ToolUseBlock";
import { ToolResultBlock } from "./ToolResultBlock";
import type { ImageSource } from "../ImageLightbox";
import { openFilePathInBrowser } from "../../utils/open-in-browser";
import { extOf, resolveOpenAction } from "../../utils/open-file-by-ext";
import { openOfficePreview } from "../../utils/office-preview-runner";
import type { ContentBlockViewProps } from "./types";

const MessageMarkdown = lazy(() =>
  import("../MessageMarkdown").then((module) => ({
    default: module.MessageMarkdown,
  })),
);

// Cowork citation guidance can emit ~[Title](url)~ markers.
// Render them as regular links instead of strikethrough links.
function normalizeCitationMarkdownLinks(markdown: string): string {
  return markdown.replace(/~\[(.+?)\]\(([^)\s]+)\)~/g, "[$1]($2)");
}

/** Determine whether a code fence should render as inline <code> or <CodeBlock>. */
export function getCodeRenderMode(
  className: string | undefined,
  children: unknown,
): { isInline: boolean; codeContent: string; language: string | undefined } {
  const codeContent =
    typeof children === "string" ? children : String(children ?? "");
  const match = /language-([\w+#.-]+)/.exec(className || "");
  // Inline only when: no language specifier AND single-line (no \n)
  const isInline = !match && !codeContent.includes("\n");
  return { isInline, codeContent, language: match?.[1] };
}

export const ContentBlockView = memo(function ContentBlockView({
  block,
  isUser,
  isStreaming,
  allBlocks,
  message,
}: ContentBlockViewProps) {
  const { t } = useTranslation();
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const workingDir = useAppStore((s) => s.workingDir);
  const setGlobalNotice = useAppStore((s) => s.setGlobalNotice);
  const activeSession = activeSessionId
    ? sessions.find((s) => s.id === activeSessionId)
    : null;
  const currentWorkingDir = activeSession?.cwd || workingDir;

  const openLightbox = useAppStore((s) => s.openLightbox);
  const openPreview = useAppStore((s) => s.openPreview);

  const resolveFilePath = (value: string) =>
    resolvePathAgainstWorkspace(value, currentWorkingDir);

  // 该文件原本有两处一模一样的"在文件夹中显示"实现；抽成一个局部函数供两处复用
  // （路由兜底 + chip 上那个独立按钮）。
  const revealInFolder = useCallback(
    async (resolvedPath: string) => {
      if (
        typeof window === "undefined" ||
        !window.electronAPI?.showItemInFolder
      ) {
        return;
      }
      try {
        const revealed = await window.electronAPI.showItemInFolder(
          resolvedPath,
          currentWorkingDir ?? undefined,
        );
        if (!revealed) {
          setGlobalNotice({
            id: `message-card-reveal-failed-${Date.now()}`,
            type: "warning",
            message: t("context.revealFailed"),
          });
        }
      } catch (error) {
        setGlobalNotice({
          id: `message-card-reveal-failed-${Date.now()}`,
          type: "warning",
          message:
            error instanceof Error && error.message
              ? error.message
              : t("context.revealFailed"),
        });
      }
    },
    [currentWorkingDir, setGlobalNotice, t],
  );

  const handleFilePathClick = useCallback(
    async (value: string) => {
      const resolvedPath = resolveFilePath(value);
      const action = resolveOpenAction(extOf(value));
      if (action === "browser") {
        openFilePathInBrowser(resolvedPath);
        return;
      }
      if (action === "preview") {
        const fileName = value.split(/[/\\]/).pop() || value;
        openPreview({ path: resolvedPath, name: fileName });
        return;
      }
      if (action === "office") {
        void openOfficePreview(resolvedPath, {
          onSuccess: (outPath) => openFilePathInBrowser(outPath),
          // 本入口的既有兜底是"在文件夹中显示"，保持不动。
          onFailure: () => void revealInFolder(resolvedPath),
        });
        return;
      }
      await revealInFolder(resolvedPath);
    },
    [openPreview, resolveFilePath, revealInFolder],
  );

  const renderFileButton = (value: string, key?: string) => (
    <button
      key={key}
      type="button"
      onClick={() => handleFilePathClick(value)}
      className={getFileLinkButtonClassName()}
      title={resolveFilePath(value)}
    >
      {value}
    </button>
  );

  const renderFileMentionParts = (
    parts: ReturnType<typeof splitChildrenByFileMentions>,
    keyPrefix: string,
  ) =>
    parts.map((part, partIndex) => {
      // react-markdown keys element children as `<tagName>-<n>` (see
      // hast-util-to-jsx-runtime passKeys). Generated keys must live in a
      // different namespace, otherwise a preserved nested-element key (e.g.
      // `strong-0` from `**a **b** c**`) collides with a generated sibling key.
      const key = `file-mention-${keyPrefix}-${partIndex}`;
      if (part.type === "file") {
        return renderFileButton(part.value, key);
      }
      if (part.type === "text") {
        return <span key={key}>{part.value}</span>;
      }
      if (isValidElement(part.value)) {
        return part.value.key ? part.value : cloneElement(part.value, { key });
      }
      return <span key={key}>{String(part.value)}</span>;
    });

  const renderChildrenWithFileLinks = (
    children: unknown,
    keyPrefix: string,
  ) => {
    const normalized = Array.isArray(children) ? children : [children];
    const parts = splitChildrenByFileMentions(normalized);
    return renderFileMentionParts(parts, keyPrefix);
  };

  const markdownComponents = useMemo(
    () => ({
      a({ children, href }: { children?: React.ReactNode; href?: string }) {
        const localFilePath = resolveLocalFilePathFromHref(
          href,
          currentWorkingDir,
        );
        if (localFilePath) {
          const action = resolveOpenAction(extOf(localFilePath));
          const openLocalFile = () => {
            if (action === "browser") {
              openFilePathInBrowser(localFilePath);
              return;
            }
            if (action === "preview") {
              const fileName =
                localFilePath.split(/[/\\]/).pop() || localFilePath;
              openPreview({ path: localFilePath, name: fileName });
              return;
            }
            if (action === "office") {
              void openOfficePreview(localFilePath, {
                onSuccess: (outPath) => openFilePathInBrowser(outPath),
                onFailure: () => void revealInFolder(localFilePath),
              });
              return;
            }
            void revealInFolder(localFilePath);
          };
          // 四种分流共用同一个按钮外壳：原先四个几乎相同的 <button> 只差 onClick，
          // 合并后少掉 ~40 行重复，也让分流集中在一处。
          return (
            <button
              type="button"
              onClick={openLocalFile}
              className={getFileLinkButtonClassName()}
              title={localFilePath}
            >
              {children}
            </button>
          );
        }

        const safeHref =
          href && /^(?:https?:|mailto:|#)/i.test(href) ? href : undefined;
        return (
          <a
            href={safeHref}
            rel="noreferrer"
            onClick={(event) => {
              event.preventDefault();
              if (safeHref && typeof window !== "undefined") {
                if (/^https?:\/\//i.test(safeHref)) {
                  const store = useAppStore.getState();
                  if (store.rightPanelMode !== "browser") {
                    store.toggleBrowserPanel();
                  }
                  void window.electronAPI?.browser
                    .navigate(safeHref)
                    ?.catch((err: unknown) => {
                      console.error(
                        "[ContentBlockView] browser.navigate failed:",
                        err,
                      );
                    });
                } else if (window.electronAPI?.openExternal) {
                  void window.electronAPI.openExternal(safeHref);
                }
              }
            }}
            className="text-accent hover:text-accent-hover"
          >
            {children}
          </a>
        );
      },
      blockquote({ children }: { children?: React.ReactNode }) {
        return (
          <blockquote className="border-l-2 border-accent/40 pl-4 text-text-muted">
            {children}
          </blockquote>
        );
      },
      code({
        className,
        children,
        ...props
      }: {
        className?: string;
        children?: React.ReactNode;
      }) {
        const { isInline, codeContent, language } = getCodeRenderMode(
          className,
          children,
        );

        if (isInline) {
          const parts = splitTextByFileMentions(codeContent);
          if (parts.length === 1 && parts[0]?.type === "file") {
            return renderFileButton(parts[0].value);
          }
          return (
            <code
              className="px-1.5 py-0.5 rounded bg-surface-muted text-accent font-mono text-xs"
              {...props}
            >
              {codeContent}
            </code>
          );
        }

        return (
          <CodeBlock language={language || ""}>
            {codeContent.replace(/^\n+|\n+$/g, "")}
          </CodeBlock>
        );
      },
      p({ children }: { children?: React.ReactNode }) {
        return (
          <p className="text-left">
            {renderChildrenWithFileLinks(children, "p")}
          </p>
        );
      },
      li({ children }: { children?: React.ReactNode }) {
        return (
          <li className="text-left">
            {renderChildrenWithFileLinks(children, "li")}
          </li>
        );
      },
      table({ children }: { children?: React.ReactNode }) {
        return (
          <div className="overflow-x-hidden my-3 max-w-full">
            <table className="min-w-full border-collapse">{children}</table>
          </div>
        );
      },
      th({
        children,
        style,
      }: {
        children?: React.ReactNode;
        style?: React.CSSProperties;
      }) {
        return (
          <th
            className="border border-border px-3 py-2 font-semibold text-text-primary bg-surface-muted"
            style={style}
          >
            {children}
          </th>
        );
      },
      td({
        children,
        style,
      }: {
        children?: React.ReactNode;
        style?: React.CSSProperties;
      }) {
        return (
          <td
            className="border border-border px-3 py-2 text-text-primary"
            style={style}
          >
            {children}
          </td>
        );
      },
      input({ checked, ...props }: { checked?: boolean }) {
        return (
          <input
            type="checkbox"
            checked={checked}
            readOnly
            className="mr-2 accent-accent"
            {...props}
          />
        );
      },
      strong({ children }: { children?: React.ReactNode }) {
        return (
          <strong>{renderChildrenWithFileLinks(children, "strong")}</strong>
        );
      },
      em({ children }: { children?: React.ReactNode }) {
        return <em>{renderChildrenWithFileLinks(children, "em")}</em>;
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentWorkingDir, setGlobalNotice, t],
  );

  const content = (() => {
    switch (block.type) {
      case "text": {
        const textBlock = block as { type: "text"; text: string };
        const text = textBlock.text || "";
        const normalizedText = normalizeCitationMarkdownLinks(
          normalizeLocalFileMarkdownLinks(normalizeLatexDelimiters(text)),
        );

        if (!text) {
          return (
            <span className={`text-text-muted italic ${isUser ? "" : "pl-1"}`}>
              {t("messageCard.emptyText")}
            </span>
          );
        }

        // Simple text display for user messages, Markdown for assistant
        if (isUser) {
          return (
            <p className="message-user-text text-text-primary whitespace-pre-wrap break-words text-left">
              <UserTextWithTokens
                text={text}
                resolveFilePath={resolveFilePath}
                onFileClick={handleFilePathClick}
              />
              {isStreaming && <span className="eff-cursor" />}
            </p>
          );
        }

        return (
          <PanelErrorBoundary
            name="MessageMarkdown"
            fallback={
              <div className="prose-chat max-w-full pl-1 text-text-primary whitespace-pre-wrap break-words">
                {normalizedText}
              </div>
            }
          >
            <Suspense
              fallback={
                <div className="prose-chat max-w-full pl-1 text-text-primary whitespace-pre-wrap break-words">
                  {normalizedText}
                </div>
              }
            >
              {/* Assistant reply shares the tool-call group icon's left edge. */}
              <div className="pl-1">
                <MessageMarkdown
                  normalizedText={normalizedText}
                  components={markdownComponents}
                />
              </div>
            </Suspense>
          </PanelErrorBoundary>
        );
      }

      case "image": {
        const imageBlock = block as {
          type: "image";
          source: { type: "base64"; media_type: string; data: string };
        };
        if (!imageBlock.source?.media_type || !imageBlock.source?.data) {
          return null;
        }
        const ALLOWED_IMAGE_TYPES = new Set([
          "image/jpeg",
          "image/png",
          "image/gif",
          "image/webp",
        ]);
        if (!ALLOWED_IMAGE_TYPES.has(imageBlock.source.media_type)) {
          return null;
        }
        const { source } = imageBlock;
        const imageSrc = `data:${source.media_type};base64,${source.data}`;

        const handleImageClick = () => {
          if (!allBlocks) return;
          const allImages: ImageSource[] = allBlocks
            .filter(
              (b): b is ImageContent =>
                b.type === "image" &&
                b.source?.media_type != null &&
                b.source?.data != null &&
                ALLOWED_IMAGE_TYPES.has(b.source.media_type),
            )
            .map((b) => ({
              src: `data:${b.source.media_type};base64,${b.source.data}`,
            }));
          if (allImages.length === 0) return;
          const clickedIdx = allImages.findIndex((img) => img.src === imageSrc);
          openLightbox(
            allImages,
            clickedIdx >= 0 ? clickedIdx : 0,
            false,
            "message",
          );
        };

        return (
          <div className={`${isUser ? "inline-block" : ""}`}>
            <img
              src={imageSrc}
              alt={t("messageCard.pastedContentAlt")}
              className="h-auto max-h-[240px] w-auto max-w-[240px] rounded-lg border border-border cursor-pointer hover:opacity-90 transition-opacity"
              onClick={handleImageClick}
            />
          </div>
        );
      }

      case "file_attachment": {
        const fileBlock = block as FileAttachmentContent;
        const attachmentPath = fileBlock.relativePath
          ? `${currentWorkingDir}/${fileBlock.relativePath}`
          : undefined;
        const iDot = fileBlock.filename.lastIndexOf(".");
        const attExt =
          iDot > 0 ? fileBlock.filename.slice(iDot).toLowerCase() : "";
        // 与其它三个入口用同一个判定，避免这里把 office 排在 preview 之前而与
        // resolveOpenAction 的顺序（browser → preview → office）分叉。
        const attachmentAction =
          attachmentPath && attExt ? resolveOpenAction(attExt) : "fallback";
        const isInteractive = Boolean(
          attachmentPath && attachmentAction !== "fallback",
        );

        return (
          <div
            className={`flex max-w-full min-w-0 items-center gap-2 px-3 py-2 rounded-lg bg-surface-muted border border-border overflow-hidden ${isInteractive ? "cursor-pointer hover:bg-surface-hover transition-colors" : ""}`}
            onClick={() => {
              if (!attachmentPath || !isInteractive) return;
              if (attachmentAction === "browser") {
                openFilePathInBrowser(attachmentPath);
                return;
              }
              if (attachmentAction === "preview") {
                openPreview({ path: attachmentPath, name: fileBlock.filename });
                return;
              }
              void openOfficePreview(attachmentPath, {
                onSuccess: (outPath) => openFilePathInBrowser(outPath),
                onFailure: () => void revealInFolder(attachmentPath),
              });
            }}
          >
            <FileText className="w-4 h-4 text-accent flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-text-primary truncate">
                {fileBlock.filename}
              </p>
            </div>
          </div>
        );
      }

      case "tool_use":
        return (
          <ToolUseBlock
            block={block as ToolUseContent}
            allBlocks={allBlocks}
            message={message}
          />
        );

      case "tool_result":
        return (
          <ToolResultBlock
            block={block as ToolResultContent}
            allBlocks={allBlocks}
            message={message}
          />
        );

      case "thinking":
        return (
          <ThinkingBlock
            block={block as { type: "thinking"; thinking: string }}
          />
        );

      default:
        return null;
    }
  })();

  return <>{content}</>;
});

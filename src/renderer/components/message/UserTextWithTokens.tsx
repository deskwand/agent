// 用户气泡正文：走与助手正文同一套 markdown 渲染，外加两类行内引用 token。
//
// 与助手正文的差别只有三处（design-docs/2026-10-30-user-message-markdown-plan.md §0）：
//   1. 单换行算换行（MessageMarkdown 的 breaks）；
//   2. 行首 `/skill:` `/cmd` 由哨兵载荷换成 ReferenceToken，与首句同行；
//   3. 文件提及仍用 ReferenceToken（下划线 + 可点），不换成助手的链接按钮。
// 不跑助手侧的三种归一化：那是给模型输出擦屁股的，不改写用户原话。
import {
  Suspense,
  cloneElement,
  createElement,
  isValidElement,
  lazy,
  useMemo,
} from "react";
import type { CSSProperties, ReactNode } from "react";
import { useAppStore } from "../../store";
import { splitChildrenByFileMentions } from "../../utils/file-link";
import {
  USER_TOKEN_SENTINEL,
  parseUserTokenValue,
  toUserMarkdown,
} from "../../utils/reference-tokens";
import { ReferenceToken } from "../ReferenceToken";
import { PanelErrorBoundary } from "../PanelErrorBoundary";
import { CodeBlock } from "./CodeBlock";

const MessageMarkdown = lazy(() =>
  import("../MessageMarkdown").then((module) => ({
    default: module.MessageMarkdown,
  })),
);

/** 这些标签里的文字都可能带路径，必须各自过一遍识别（对齐旧的整段扫描）。 */
const MENTION_TAGS = [
  "p",
  "li",
  "strong",
  "em",
  "del",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "td",
  "th",
] as const;

export interface UserTextWithTokensProps {
  text: string;
  /** 把原文路径解析成可读的完整路径，仅用于 tooltip */
  resolveFilePath: (value: string) => string;
  onFileClick: (value: string) => void;
}

export function UserTextWithTokens({
  text,
  resolveFilePath,
  onFileClick,
}: UserTextWithTokensProps) {
  const commandLabels = useAppStore((s) => s.commandLabels);
  const markdown = useMemo(
    () => toUserMarkdown(text, commandLabels),
    [text, commandLabels],
  );

  const components = useMemo(() => {
    const renderFileMentions = (children: unknown, keyPrefix: string) => {
      const list = Array.isArray(children) ? children : [children];
      return splitChildrenByFileMentions(list).map((part, index) => {
        const key = `user-file-mention-${keyPrefix}-${index}`;
        if (part.type === "file") {
          return (
            <ReferenceToken
              key={key}
              kind="file"
              label={part.value}
              tooltip={resolveFilePath(part.value)}
              onClick={() => onFileClick(part.value)}
            />
          );
        }
        if (part.type === "text") {
          return <span key={key}>{part.value}</span>;
        }
        if (isValidElement(part.value)) {
          return part.value.key
            ? part.value
            : cloneElement(part.value, { key });
        }
        return <span key={key}>{String(part.value ?? "")}</span>;
      });
    };

    const tags = Object.fromEntries(
      MENTION_TAGS.map((tag) => [
        tag,
        ({
          children,
          style,
        }: {
          children?: ReactNode;
          style?: CSSProperties;
        }) =>
          createElement(
            tag,
            style ? { style } : null,
            renderFileMentions(children, tag),
          ),
      ]),
    );

    return {
      ...tags,
      // 与助手正文同一个引用条：`.prose-chat` 没有 blockquote 样式，不写就只剩缩进
      blockquote({ children }: { children?: ReactNode }) {
        return (
          <blockquote className="border-l-2 border-primary/40 pl-4 text-muted-foreground">
            {renderFileMentions(children, "blockquote")}
          </blockquote>
        );
      },
      code({
        className,
        children,
      }: {
        className?: string;
        children?: unknown;
      }) {
        const content =
          typeof children === "string" ? children : String(children ?? "");
        const token = parseUserTokenValue(content);
        // 哨兵载荷解析不出东西时整块吞掉：绝不把私用区字符吐给用户
        if (!token && content.startsWith(USER_TOKEN_SENTINEL)) return null;
        if (token) {
          return (
            <ReferenceToken
              kind={token.kind}
              label={token.label}
              tooltip={token.kind === "command" ? token.raw : undefined}
            />
          );
        }
        const language = /language-([\w+#.-]+)/.exec(className || "")?.[1];
        if (!language && !content.includes("\n")) {
          return (
            <code className="px-1.5 py-0.5 rounded bg-muted text-primary-text font-mono text-xs">
              {content}
            </code>
          );
        }
        return (
          <CodeBlock language={language || ""}>
            {content.replace(/^\n+|\n+$/g, "")}
          </CodeBlock>
        );
      },
      a({ children, href }: { children?: ReactNode; href?: string }) {
        // 裸相对路径（`docs/a.md`）也要能用；`javascript:` / `data:` / `file:` 与
        // 协议相对地址（`//host`）一律抹掉 href —— 前者危险，后者不是本地文件。
        const external = href ? /^(?:https?|mailto):/i.test(href) : false;
        const hasScheme = href ? /^[a-z][a-z0-9+.-]*:/i.test(href) : false;
        const protocolRelative = href?.startsWith("//") ?? false;
        const safeHref =
          href && (external || (!hasScheme && !protocolRelative))
            ? href
            : undefined;
        return (
          <a
            href={safeHref}
            className="text-primary-text hover:text-primary-text"
            onClick={(event) => {
              event.preventDefault();
              if (!safeHref) return;
              if (/^(?:https?|mailto):/i.test(safeHref)) {
                void window.electronAPI?.openExternal(safeHref);
                return;
              }
              // 相对/绝对路径：走与文件提及同一个打开路由
              if (safeHref.startsWith("#")) return;
              // 消息里的 href 可能是百分号编码（`my%20file.md`），解码后再解析
              try {
                onFileClick(decodeURIComponent(safeHref));
              } catch {
                onFileClick(safeHref);
              }
            }}
          >
            {children}
          </a>
        );
      },
      // 用户粘贴的 `![](https://…)` 不该让渲染层发远程请求（助手侧同样没有图片渲染）
      img({ alt, src }: { alt?: string; src?: string }) {
        return (
          <span className="text-muted-foreground" title={src}>
            {alt || src || ""}
          </span>
        );
      },
    };
  }, [onFileClick, resolveFilePath]);

  return (
    <div className="message-user-text text-foreground text-left">
      <PanelErrorBoundary
        name="UserMessageMarkdown"
        fallback={
          <span className="whitespace-pre-wrap break-words">{text}</span>
        }
      >
        <Suspense
          fallback={
            <span className="whitespace-pre-wrap break-words">{text}</span>
          }
        >
          <MessageMarkdown
            normalizedText={markdown}
            components={components}
            breaks
          />
        </Suspense>
      </PanelErrorBoundary>
    </div>
  );
}
